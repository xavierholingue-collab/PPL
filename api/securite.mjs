// @ts-check
/**
 * Session de l'organisateur, mot de passe, limitation des essais, origine.
 *
 * LA SESSION EST UN JETON SIGNÉ, porté par un cookie HttpOnly, SameSite=Strict.
 * Le serveur ne garde rien en mémoire : le jeton dit « organisateur jusqu'à
 * telle date », et la signature HMAC prouve que c'est lui qui l'a émis. Un
 * jeton modifié, tronqué ou expiré est traité exactement comme une absence
 * de session — jamais comme une erreur qui donnerait un indice.
 *
 * LA CLÉ DE SIGNATURE DÉPEND DU MOT DE PASSE : changer MOT_DE_PASSE (ou
 * SECRET_SESSION) invalide toutes les sessions d'un coup. C'est le geste de
 * révocation, puisqu'un jeton sans état ne se retire pas un par un.
 *
 * En https, le cookie porte le préfixe __Host- : le navigateur refuse alors
 * qu'un autre sous-domaine de y-factor.fr pose un cookie du même nom.
 */
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/** @param {boolean} securise */
export const nomCookie = (securise) => (securise ? '__Host-ppl_session' : 'ppl_session');

/**
 * Clé de signature des sessions, tirée du secret ET du mot de passe.
 * @param {string} secret @param {string} motDePasse
 */
export function cleSession(secret, motDePasse) {
  const empreinte = createHash('sha256').update(motDePasse, 'utf8').digest('hex');
  return createHmac('sha256', secret).update(`ppl/session/v1|${empreinte}`).digest();
}

/** @param {Buffer | string} b */
const b64url = (b) => Buffer.from(b).toString('base64url');

/**
 * @param {Buffer | string} secret clé de cleSession()
 * @param {number} dureeSecondes
 * @param {number} [maintenant] secondes depuis l'époque, pour les tests
 */
export function emettreJeton(secret, dureeSecondes, maintenant = Math.floor(Date.now() / 1000)) {
  const corps = b64url(JSON.stringify({ v: 1, r: 'organisateur', iat: maintenant, exp: maintenant + dureeSecondes }));
  const signature = b64url(createHmac('sha256', secret).update(corps).digest());
  return `${corps}.${signature}`;
}

/**
 * @param {string | undefined} jeton
 * @param {Buffer | string} secret clé de cleSession()
 * @param {number} [maintenant]
 * @returns {boolean} vrai seulement pour un jeton intact, émis par nous, non expiré
 */
export function jetonValide(jeton, secret, maintenant = Math.floor(Date.now() / 1000)) {
  if (typeof jeton !== 'string' || jeton.length > 512) return false;
  const morceaux = jeton.split('.');
  if (morceaux.length !== 2) return false;
  const [corps, signature] = morceaux;
  const attendue = createHmac('sha256', secret).update(corps).digest();
  let recue;
  try { recue = Buffer.from(signature, 'base64url'); } catch { return false; }
  if (recue.length !== attendue.length || !timingSafeEqual(recue, attendue)) return false;
  try {
    const p = JSON.parse(Buffer.from(corps, 'base64url').toString('utf8'));
    return p.v === 1 && p.r === 'organisateur'
      && Number.isInteger(p.exp) && Number.isInteger(p.iat)
      && p.iat <= maintenant + 60 && p.exp > maintenant;
  } catch {
    return false;
  }
}

/**
 * Comparaison en temps constant : on compare les empreintes, de longueur
 * fixe, pour ne rien laisser deviner de la longueur du mot de passe.
 * @param {unknown} saisi
 * @param {string} attendu
 */
export function motDePasseCorrect(saisi, attendu) {
  if (typeof saisi !== 'string' || saisi.length > 200) return false;
  const a = createHash('sha256').update(saisi, 'utf8').digest();
  const b = createHash('sha256').update(attendu, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** @param {string | undefined} entete */
export function lireCookies(entete) {
  /** @type {Record<string, string>} */
  const cookies = {};
  if (!entete) return cookies;
  for (const morceau of entete.split(';')) {
    const i = morceau.indexOf('=');
    if (i < 1) continue;
    const nom = morceau.slice(0, i).trim();
    const valeur = morceau.slice(i + 1).trim();
    if (nom && !(nom in cookies)) cookies[nom] = valeur;
  }
  return cookies;
}

/**
 * @param {string} valeur
 * @param {{ securise: boolean, maxAge: number }} options
 */
export function cookieSession(valeur, { securise, maxAge }) {
  return [
    `${nomCookie(securise)}=${valeur}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`,
    ...(securise ? ['Secure'] : []),
  ].join('; ');
}

/**
 * Dix essais de mot de passe ratés par quart d'heure et par adresse.
 * La table est bornée : une avalanche d'adresses ne fait pas grossir la
 * mémoire sans fin, elle vide d'abord les entrées expirées.
 */
export class Limiteur {
  /** @param {{ essais?: number, fenetreMs?: number, taille?: number }} [o] */
  constructor({ essais = 10, fenetreMs = 15 * 60 * 1000, taille = 10_000 } = {}) {
    this.essais = essais;
    this.fenetreMs = fenetreMs;
    this.taille = taille;
    /** @type {Map<string, { n: number, fin: number }>} */
    this.table = new Map();
  }

  /** @param {string} cle @param {number} [maintenant] */
  bloque(cle, maintenant = Date.now()) {
    const e = this.table.get(cle);
    if (!e || e.fin <= maintenant) return 0;
    return e.n >= this.essais ? e.fin - maintenant : 0;
  }

  /** @param {string} cle @param {number} [maintenant] */
  echec(cle, maintenant = Date.now()) {
    if (this.table.size >= this.taille) this.purger(maintenant);
    if (this.table.size >= this.taille) return; // saturée même après purge : on n'enregistre plus
    const e = this.table.get(cle);
    if (!e || e.fin <= maintenant) this.table.set(cle, { n: 1, fin: maintenant + this.fenetreMs });
    else e.n += 1;
  }

  /** @param {string} cle */
  reussite(cle) { this.table.delete(cle); }

  /** @param {number} maintenant */
  purger(maintenant) {
    for (const [cle, e] of this.table) if (e.fin <= maintenant) this.table.delete(cle);
  }
}

/**
 * Une requête qui modifie quelque chose doit venir du site lui-même.
 *
 * C'EST CE CONTRÔLE QUI PROTÈGE, pas SameSite seul : pour le navigateur,
 * lisia., app. et api.y-factor.fr sont du « même site » que ppl.y-factor.fr,
 * et SameSite=Strict ne les arrête pas. L'origine, elle, est exacte.
 * Un navigateur envoie toujours Origin
 * sur un POST, PUT, PATCH ou DELETE : s'il est présent, il doit être le nôtre.
 * Sans Origin, Sec-Fetch-Site tranche quand il existe. Un client sans
 * navigateur (contrôles, curl) n'envoie ni l'un ni l'autre, et n'a pas de
 * cookie de victime à détourner.
 *
 * @param {import('node:http').IncomingHttpHeaders} entetes
 * @param {string} origineAttendue vide en local : seule l'origine de l'hôte appelé est admise
 */
export function origineAdmise(entetes, origineAttendue) {
  const origine = entetes.origin;
  if (typeof origine === 'string') {
    if (origineAttendue) return origine === origineAttendue;
    const hote = entetes.host;
    return typeof hote === 'string' && (origine === `http://${hote}` || origine === `https://${hote}`);
  }
  const site = entetes['sec-fetch-site'];
  return site === undefined || site === 'same-origin' || site === 'none';
}
