// @ts-check
/**
 * API de PPL — Ping Pong Loisir.
 *
 * Un serveur HTTP de Node, sans framework, et une seule dépendance : pg.
 * Même pile que Biblio sur le même serveur : Caddy devant, PostgreSQL 18
 * derrière, et l'API n'écoute que sur 127.0.0.1.
 *
 * Lecture libre (classement, soirées) ; toute écriture demande la session
 * de l'organisateur. C'est l'API qui décide, jamais l'écran : masquer un
 * bouton ne protège rien.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { lireConfig } from './config.mjs';
import {
  nomCookie, cleSession, emettreJeton, jetonValide, motDePasseCorrect, lireCookies, cookieSession,
  Limiteur, origineAdmise,
} from './securite.mjs';
import {
  validerDate, validerNouveauJoueur, validerModificationJoueur, validerSoiree,
} from './validation.mjs';
import {
  saisonCourante, bornesSaison, listeSoirees, classement, listeJoueurs, creerJoueur,
  modifierJoueur, soireeParDate, enregistrerSoiree, effacerResultats,
} from './donnees.mjs';
import { versCsv, versOds, preparerTableau } from './export.mjs';

const TAILLE_MAX_CORPS = 64 * 1024;

/** @type {import('./config.mjs').Config} */
let config;
try {
  config = lireConfig();
} catch (e) {
  console.error(`PPL refuse de démarrer — ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}

// Le commit déployé, déposé dans le paquet par le script de livraison.
let version = 'locale';
try {
  version = readFileSync(new URL('./.version', import.meta.url), 'utf8').trim().slice(0, 80) || version;
} catch { /* pas de fichier : poste de développement */ }

// Des délais partout : sous charge, une requête qui attend une connexion
// ou une instruction qui traîne échouent proprement au lieu de s'empiler.
const pool = new pg.Pool({
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
  application_name: 'ppl-api',
});
pool.on('error', (e) => console.error('pg :', e.message));

// Clé de signature des sessions : liée au mot de passe (voir securite.mjs).
const CLE_SESSION = cleSession(config.secret, config.motDePasse);
const COOKIE = nomCookie(config.cookieSecurise);

const limiteur = new Limiteur();

// ------------------------------------------------------------------ outils

class ErreurHttp extends Error {
  /** @param {number} statut @param {string} message */
  constructor(statut, message) { super(message); this.statut = statut; }
}

/**
 * @param {http.ServerResponse} res
 * @param {number} statut
 * @param {unknown} [corps]
 * @param {Record<string, string | string[]>} [entetes]
 */
function repondre(res, statut, corps, entetes = {}) {
  const base = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...entetes,
  };
  if (corps === undefined) {
    res.writeHead(statut, base);
    res.end();
    return;
  }
  const texte = JSON.stringify(corps);
  res.writeHead(statut, { ...base, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(texte) });
  res.end(texte);
}

/** @param {http.IncomingMessage} req @returns {Promise<unknown>} */
function lireCorps(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] ?? '';
    if (!/^application\/json(\s*;|$)/i.test(type)) {
      reject(new ErreurHttp(415, 'contenu JSON attendu'));
      req.resume();
      return;
    }
    const annonce = Number(req.headers['content-length'] ?? 0);
    if (annonce > TAILLE_MAX_CORPS) {
      reject(new ErreurHttp(413, 'requête trop volumineuse'));
      req.resume();
      return;
    }
    /** @type {Buffer[]} */
    const morceaux = [];
    let taille = 0;
    req.on('data', (/** @type {Buffer} */ m) => {
      taille += m.length;
      if (taille > TAILLE_MAX_CORPS) {
        reject(new ErreurHttp(413, 'requête trop volumineuse'));
        req.destroy();
        return;
      }
      morceaux.push(m);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(morceaux).toString('utf8') || 'null'));
      } catch {
        reject(new ErreurHttp(400, 'JSON illisible'));
      }
    });
    req.on('error', reject);
  });
}

/** @param {http.IncomingMessage} req */
function estOrganisateur(req) {
  const jeton = lireCookies(req.headers.cookie)[COOKIE];
  return jetonValide(jeton, CLE_SESSION);
}

/**
 * L'adresse du visiteur, pour limiter les essais de mot de passe.
 * Derrière Caddy, c'est la DERNIÈRE valeur de X-Forwarded-For : celle que
 * Caddy a posée lui-même. Les précédentes viennent du client et se falsifient.
 * @param {http.IncomingMessage} req
 */
function adresse(req) {
  if (config.derriereProxy) {
    const xff = req.headers['x-forwarded-for'];
    const valeur = Array.isArray(xff) ? xff[xff.length - 1] : xff;
    const derniere = valeur?.split(',').pop()?.trim();
    if (derniere) return derniere;
  }
  return req.socket.remoteAddress ?? 'inconnue';
}

async function saisonOuErreur() {
  const saison = await saisonCourante(pool);
  if (!saison) throw new ErreurHttp(503, 'aucune saison en base : la base n’a pas été amorcée');
  return saison;
}

/** @param {string} texte */
function dateOuErreur(texte) {
  const d = validerDate(texte);
  if (!d.ok) throw new ErreurHttp(400, d.erreur);
  return d.valeur;
}

// ------------------------------------------------------------------ routes

/**
 * @typedef {{
 *   req: http.IncomingMessage, res: http.ServerResponse,
 *   params: string[], url: URL, corps: unknown
 * }} Contexte
 * @typedef {(c: Contexte) => Promise<void>} Gestionnaire
 */

/** @type {{ methode: string, motif: RegExp, gestion: Gestionnaire, organisateur?: boolean, corps?: boolean }[]} */
const ROUTES = [
  {
    methode: 'GET', motif: /^\/api\/sante$/,
    gestion: async ({ res }) => {
      await pool.query('select 1');
      repondre(res, 200, { statut: 'ok' });
    },
  },
  {
    methode: 'GET', motif: /^\/api\/session$/,
    gestion: async ({ req, res }) => {
      const saison = await saisonCourante(pool);
      repondre(res, 200, {
        organisateur: estOrganisateur(req),
        environnement: config.environnement,
        saison: saison?.libelle ?? null,
        version,
      });
    },
  },
  {
    methode: 'POST', motif: /^\/api\/connexion$/, corps: true,
    gestion: async ({ req, res, corps }) => {
      const qui = adresse(req);
      const attente = limiteur.bloque(qui);
      if (attente > 0) {
        repondre(res, 429, { erreur: `trop d’essais, réessayez dans ${Math.ceil(attente / 60000)} min` },
          { 'Retry-After': String(Math.ceil(attente / 1000)) });
        return;
      }
      const saisi = corps && typeof corps === 'object' ? /** @type {Record<string, unknown>} */ (corps).mot_de_passe : undefined;
      if (!motDePasseCorrect(saisi, config.motDePasse)) {
        limiteur.echec(qui);
        repondre(res, 401, { erreur: 'mot de passe incorrect' });
        return;
      }
      limiteur.reussite(qui);
      const duree = config.dureeSessionJours * 86400;
      repondre(res, 204, undefined, {
        'Set-Cookie': cookieSession(emettreJeton(CLE_SESSION, duree), { securise: config.cookieSecurise, maxAge: duree }),
      });
    },
  },
  {
    methode: 'POST', motif: /^\/api\/deconnexion$/,
    gestion: async ({ res }) => {
      repondre(res, 204, undefined, { 'Set-Cookie': cookieSession('', { securise: config.cookieSecurise, maxAge: 0 }) });
    },
  },
  {
    methode: 'GET', motif: /^\/api\/saison$/,
    gestion: async ({ res }) => {
      const saison = await saisonOuErreur();
      repondre(res, 200, { saison: saison.libelle, soirees: await listeSoirees(pool, saison.id) });
    },
  },
  {
    methode: 'GET', motif: /^\/api\/classement$/,
    gestion: async ({ res }) => {
      const saison = await saisonOuErreur();
      const [lignes, soirees] = await Promise.all([classement(pool, saison.id), listeSoirees(pool, saison.id)]);
      const derniere = soirees
        .filter((s) => s.nb_joueurs > 0 && s.compte)
        .map((s) => s.date)
        .pop() ?? null;
      repondre(res, 200, { saison: saison.libelle, derniereSoiree: derniere, joueurs: lignes });
    },
  },
  {
    methode: 'GET', motif: /^\/api\/joueurs$/,
    gestion: async ({ res }) => repondre(res, 200, { joueurs: await listeJoueurs(pool) }),
  },
  {
    methode: 'POST', motif: /^\/api\/joueurs$/, organisateur: true, corps: true,
    gestion: async ({ res, corps }) => {
      const v = validerNouveauJoueur(corps);
      if (!v.ok) throw new ErreurHttp(400, v.erreur);
      try {
        repondre(res, 201, await creerJoueur(pool, v.valeur.nom));
      } catch (e) {
        if (/** @type {{ code?: string }} */ (e).code === '23505') throw new ErreurHttp(409, 'un joueur porte déjà ce nom');
        throw e;
      }
    },
  },
  {
    methode: 'PATCH', motif: /^\/api\/joueurs\/(\d{1,9})$/, organisateur: true, corps: true,
    gestion: async ({ res, params, corps }) => {
      const v = validerModificationJoueur(corps);
      if (!v.ok) throw new ErreurHttp(400, v.erreur);
      try {
        const j = await modifierJoueur(pool, Number(params[0]), v.valeur);
        if (!j) throw new ErreurHttp(404, 'joueur introuvable');
        repondre(res, 200, j);
      } catch (e) {
        if (/** @type {{ code?: string }} */ (e).code === '23505') throw new ErreurHttp(409, 'un joueur porte déjà ce nom');
        throw e;
      }
    },
  },
  {
    methode: 'GET', motif: /^\/api\/soirees\/(\d{4}-\d{2}-\d{2})$/,
    gestion: async ({ res, params }) => {
      const date = dateOuErreur(params[0]);
      const saison = await saisonOuErreur();
      const soiree = await soireeParDate(pool, saison.id, date);
      if (!soiree) throw new ErreurHttp(404, 'pas de soirée à cette date');
      repondre(res, 200, soiree);
    },
  },
  {
    methode: 'PUT', motif: /^\/api\/soirees\/(\d{4}-\d{2}-\d{2})$/, organisateur: true, corps: true,
    gestion: async ({ res, params, corps }) => {
      const date = dateOuErreur(params[0]);
      const saison = await saisonOuErreur();
      const { debut, fin } = bornesSaison(saison.libelle);
      if (date < debut || date > fin) throw new ErreurHttp(400, `la saison ${saison.libelle} va du ${debut} au ${fin}`);
      const v = validerSoiree(corps);
      if (!v.ok) throw new ErreurHttp(400, v.erreur);
      try {
        repondre(res, 200, await enregistrerSoiree(pool, saison, date, v.valeur));
      } catch (e) {
        if (/** @type {{ code?: string }} */ (e).code === '23503') throw new ErreurHttp(400, 'un des joueurs n’existe pas');
        throw e;
      }
    },
  },
  {
    methode: 'DELETE', motif: /^\/api\/soirees\/(\d{4}-\d{2}-\d{2})\/resultats$/, organisateur: true,
    gestion: async ({ res, params }) => {
      const date = dateOuErreur(params[0]);
      const saison = await saisonOuErreur();
      if (!(await effacerResultats(pool, saison.id, date))) throw new ErreurHttp(404, 'pas de soirée à cette date');
      repondre(res, 204);
    },
  },
  {
    methode: 'GET', motif: /^\/api\/export\.(ods|csv)$/,
    gestion: async ({ res, params }) => {
      const saison = await saisonOuErreur();
      const [lignes, soirees] = await Promise.all([classement(pool, saison.id), listeSoirees(pool, saison.id)]);
      const tableau = preparerTableau(saison.libelle, soirees, lignes);
      const nom = `PPL-classement-${saison.libelle.replace('/', '-')}`;
      if (params[0] === 'csv') {
        const csv = versCsv(tableau);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${nom}.csv"`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        });
        res.end(csv);
      } else {
        const ods = versOds(tableau);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.oasis.opendocument.spreadsheet',
          'Content-Disposition': `attachment; filename="${nom}.ods"`,
          'Content-Length': ods.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        });
        res.end(ods);
      }
    },
  },
];

const METHODES_ECRITURE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** @param {http.IncomingMessage} req @param {http.ServerResponse} res */
async function traiter(req, res) {
  const debut = Date.now();
  const methode = req.method ?? 'GET';
  let chemin = '?';
  try {
    // L'ADRESSE EST LUE DANS LE try, et refusée si elle ne commence pas par
    // un seul « / ». Une adresse comme « //%5B/../api/sante » passe le filtre
    // de Caddy (qui compare le chemin nettoyé) mais fait lever new URL :
    // hors du try, cette exception arrêtait le processus. Relevé par la
    // relecture du 17/10/2026, vérifié sur l'API réelle.
    const brut = req.url ?? '/';
    if (!brut.startsWith('/') || brut.startsWith('//')) throw new ErreurHttp(400, 'adresse invalide');
    const url = new URL(brut, 'http://ppl.local');
    chemin = url.pathname;
    const candidates = ROUTES.filter((r) => r.motif.test(url.pathname));
    if (candidates.length === 0) throw new ErreurHttp(404, 'adresse inconnue');
    const route = candidates.find((r) => r.methode === methode);
    if (!route) {
      repondre(res, 405, { erreur: 'méthode non admise' }, { Allow: candidates.map((r) => r.methode).join(', ') });
      return;
    }
    if (METHODES_ECRITURE.has(methode) && !origineAdmise(req.headers, config.origine)) {
      throw new ErreurHttp(403, 'requête venue d’un autre site');
    }
    if (route.organisateur && !estOrganisateur(req)) throw new ErreurHttp(401, 'réservé à l’organisateur : connectez-vous');
    const corps = route.corps ? await lireCorps(req) : undefined;
    const params = /** @type {RegExpExecArray} */ (route.motif.exec(url.pathname)).slice(1);
    await route.gestion({ req, res, params, url, corps });
  } catch (e) {
    if (e instanceof ErreurHttp) {
      if (!res.headersSent) repondre(res, e.statut, { erreur: e.message });
    } else {
      console.error(`${methode} ${chemin} :`, e);
      if (!res.headersSent) repondre(res, 500, { erreur: 'erreur interne' });
    }
  } finally {
    // Ni adresse IP ni contenu : la méthode, le chemin, le statut, la durée.
    console.log(`${methode} ${chemin} ${res.statusCode} ${Date.now() - debut}ms`);
  }
}

// Filet de dernier recours : aucune erreur imprévue d'une requête ne doit
// arrêter le service pour tout le monde.
const serveur = http.createServer((req, res) => {
  traiter(req, res).catch((e) => {
    console.error('erreur imprévue :', e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  });
});
serveur.requestTimeout = 15_000;
serveur.headersTimeout = 10_000;
process.on('unhandledRejection', (e) => console.error('promesse rejetée sans traitement :', e));

// La base doit porter le schéma : sinon on refuse de démarrer, bruyamment,
// plutôt que de répondre 500 à chaque requête.
try {
  await pool.query('select 1 from saisons limit 1');
} catch (e) {
  console.error(`PPL refuse de démarrer — base injoignable ou schéma absent : ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}

serveur.listen(config.port, config.hote, () => {
  console.log(`PPL ${version} — ${config.environnement} — écoute sur ${config.hote}:${config.port}`);
});

/** @param {string} signal */
function arreter(signal) {
  console.log(`${signal} reçu, arrêt`);
  serveur.close(() => { void pool.end().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => arreter('SIGTERM'));
process.on('SIGINT', () => arreter('SIGINT'));
