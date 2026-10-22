// @ts-check
/**
 * Contrôles de l'API, contre une pile EN MARCHE (locale, CI ou serveur).
 *
 *   BASE=http://127.0.0.1:3020 MOT_DE_PASSE=… node --test api/test-api.mjs
 *
 * Par défaut, AUCUNE ÉCRITURE : on vérifie ce qui est ouvert, ce qui est
 * fermé, et que les saisies mal formées sont refusées — refusées avant
 * d'atteindre la base. On peut donc lancer ces contrôles contre le serveur
 * réel sans toucher aux points du club.
 *
 * ECRITURES=1 ajoute le parcours complet (joueur, soirée, classement,
 * effacement) : réservé à une base locale ou de contrôle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

const BASE = (process.env.BASE ?? 'http://127.0.0.1:3020').replace(/\/+$/, '');
const MOT_DE_PASSE = process.env.MOT_DE_PASSE ?? '';
const ECRITURES = process.env.ECRITURES === '1';
const ORIGINE = new URL(BASE).origin;

/**
 * @param {string} chemin
 * @param {{ methode?: string, corps?: unknown, cookie?: string, entetes?: Record<string, string> }} [o]
 */
async function appel(chemin, { methode = 'GET', corps, cookie, entetes = {} } = {}) {
  /** @type {Record<string, string>} */
  const h = { Origin: ORIGINE, ...entetes };
  if (corps !== undefined) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(`${BASE}${chemin}`, {
    method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps), redirect: 'manual',
  });
  const texte = await r.text();
  let json = null;
  try { json = texte ? JSON.parse(texte) : null; } catch { /* pas du JSON */ }
  return { statut: r.status, json, texte, entetes: r.headers };
}

let cookie = '';
async function connexion() {
  if (cookie) return cookie;
  assert.ok(MOT_DE_PASSE, 'MOT_DE_PASSE requis pour les contrôles connectés');
  const r = await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: MOT_DE_PASSE } });
  assert.equal(r.statut, 204, 'connexion');
  const sc = r.entetes.get('set-cookie') ?? '';
  cookie = sc.split(';')[0];
  return cookie;
}

// ---------------------------------------------------------------- ouvert à tous

test('santé et session anonyme', async () => {
  const s = await appel('/api/sante');
  assert.equal(s.statut, 200);
  assert.equal(s.json.statut, 'ok');
  const sess = await appel('/api/session');
  assert.equal(sess.statut, 200);
  assert.equal(sess.json.organisateur, false);
  assert.ok(['local', 'maquette', 'production'].includes(sess.json.environnement));
  assert.equal(sess.entetes.get('cache-control'), 'no-store');
  assert.equal(sess.entetes.get('x-content-type-options'), 'nosniff');
});

test('le classement et le calendrier se lisent sans session', async () => {
  const c = await appel('/api/classement');
  assert.equal(c.statut, 200);
  assert.ok(Array.isArray(c.json.joueurs));
  for (const j of c.json.joueurs) {
    assert.equal(typeof j.nom, 'string');
    assert.ok(Number.isInteger(j.annee.total));
  }
  // Rang sportif : un rang n'est jamais supérieur au nombre de mieux classés + 1.
  const s1 = c.json.joueurs.filter((/** @type {any} */ j) => j.s1.rang !== null);
  for (const j of s1) {
    const mieux = s1.filter((/** @type {any} */ x) => x.s1.total > j.s1.total).length;
    assert.equal(j.s1.rang, mieux + 1, `rang de ${j.nom}`);
  }
  const s = await appel('/api/saison');
  assert.equal(s.statut, 200);
  assert.ok(s.json.soirees.length > 0);
});

test('export tableur : .ods et .csv', async () => {
  const ods = await fetch(`${BASE}/api/export.ods`);
  assert.equal(ods.status, 200);
  assert.equal(ods.headers.get('content-type'), 'application/vnd.oasis.opendocument.spreadsheet');
  const octets = Buffer.from(await ods.arrayBuffer());
  assert.equal(octets.subarray(0, 4).toString('hex'), '504b0304', 'archive ZIP');
  assert.equal(octets.subarray(30, 38).toString(), 'mimetype');
  // Lu en octets : le décodage texte de fetch retire le BOM qu'on veut voir.
  const csv = Buffer.from(await (await fetch(`${BASE}/api/export.csv`)).arrayBuffer());
  assert.equal(csv.subarray(0, 3).toString('hex'), 'efbbbf', 'BOM UTF-8 pour le tableur');
  assert.ok(csv.subarray(3).toString('utf8').startsWith('Joueur;'));
});

/**
 * Requête brute : fetch normalise les adresses, or c'est justement une
 * adresse NON normalisée qu'il faut envoyer.
 * @param {string} chemin
 * @returns {Promise<number>}
 */
function requeteBrute(chemin) {
  const u = new URL(BASE);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const r = mod.request({ host: u.hostname, port: u.port, path: chemin, method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on('error', reject);
    r.end();
  });
}

test('une adresse malformée est refusée, et le service tient', async () => {
  // Relevé par la relecture du 17/10/2026 : cette adresse arrêtait le processus.
  for (const chemin of ['//%5B/../api/sante', '//x/api/sante', '/api/../api/sante']) {
    const statut = await requeteBrute(chemin);
    assert.ok([200, 400, 404].includes(statut), `${chemin} : ${statut}`);
  }
  const s = await appel('/api/sante');
  assert.equal(s.statut, 200, 'le service répond toujours');
});

// ---------------------------------------------------------------- fermé sans session

test('toute écriture est refusée sans session', async () => {
  const essais = [
    ['PUT', '/api/soirees/2026-10-21', { format: 'libre', resultats: [] }],
    ['DELETE', '/api/soirees/2026-10-21/resultats', undefined],
    ['POST', '/api/joueurs', { nom: 'Intrus' }],
    ['PATCH', '/api/joueurs/1', { nom: 'Intrus' }],
  ];
  for (const [methode, chemin, corps] of essais) {
    const r = await appel(/** @type {string} */ (chemin), { methode: /** @type {string} */ (methode), corps });
    assert.equal(r.statut, 401, `${methode} ${chemin}`);
  }
});

test('un jeton falsifié vaut une absence de session', async () => {
  const faux = [
    'ppl_session=eyJ2IjoxLCJyIjoib3JnYW5pc2F0ZXVyIiwiaWF0IjoxLCJleHAiOjk5OTk5OTk5OTl9.AAAA',
    'ppl_session=nimporte-quoi',
    'ppl_session=',
  ];
  for (const c of faux) {
    const s = await appel('/api/session', { cookie: c });
    assert.equal(s.json.organisateur, false);
    const r = await appel('/api/joueurs', { methode: 'POST', corps: { nom: 'Intrus' }, cookie: c });
    assert.equal(r.statut, 401);
  }
});

test('mauvais mot de passe : 401, et le cookie n’est pas posé', async () => {
  const r = await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: 'ce-n-est-pas-le-bon' } });
  assert.equal(r.statut, 401);
  assert.equal(r.entetes.get('set-cookie'), null);
});

test('une écriture venue d’un autre site est refusée, même avec la session', async () => {
  const c = await connexion();
  const r = await appel('/api/joueurs', {
    methode: 'POST', corps: { nom: 'Intrus' }, cookie: c, entetes: { Origin: 'https://site-malveillant.example' },
  });
  assert.equal(r.statut, 403);
  const r2 = await appel('/api/connexion', {
    methode: 'POST', corps: { mot_de_passe: MOT_DE_PASSE }, entetes: { Origin: 'https://site-malveillant.example' },
  });
  assert.equal(r2.statut, 403, 'pas de connexion forcée depuis un autre site');
});

// ---------------------------------------------------------------- avec session

test('le cookie de session est HttpOnly, SameSite=Strict', async () => {
  const r = await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: MOT_DE_PASSE } });
  assert.equal(r.statut, 204);
  const sc = r.entetes.get('set-cookie') ?? '';
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.match(sc, /Path=\//);
  if (BASE.startsWith('https://')) assert.match(sc, /Secure/);
  const s = await appel('/api/session', { cookie: sc.split(';')[0] });
  assert.equal(s.json.organisateur, true);
});

// Relevé le 17/10/2026 : tapé en minuscules sur le serveur réel, le mot de
// passe fabriqué était refusé. Pour cette forme-là, la saisie est tolérante.
const FABRIQUE = /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/.test(MOT_DE_PASSE);
test('mot de passe fabriqué : accepté en minuscules et sans tirets', {
  skip: !FABRIQUE && 'seulement pour un mot de passe fabriqué par l’installeur',
}, async () => {
  for (const variante of [MOT_DE_PASSE.toLowerCase(), MOT_DE_PASSE.replaceAll('-', '')]) {
    const r = await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: variante } });
    assert.equal(r.statut, 204, 'variante de saisie acceptée');
  }
});

test('les saisies mal formées sont refusées avant la base', async () => {
  const c = await connexion();
  /** @type {[string, unknown, number][]} */
  const cas = [
    ['/api/soirees/2026-10-21', { format: 'inconnu', resultats: [] }, 400],
    ['/api/soirees/2026-10-21', { format: 'libre', resultats: [{ joueur_id: 1, points: 150 }] }, 400],
    ['/api/soirees/2026-10-21', { format: 'libre', resultats: [{ joueur_id: 1, points: -1 }] }, 400],
    ['/api/soirees/2026-10-21', { format: 'libre', resultats: [{ joueur_id: 1, points: 3.5 }] }, 400],
    ['/api/soirees/2026-10-21', { format: 'libre', resultats: [{ joueur_id: 1, points: 3 }, { joueur_id: 1, points: 4 }] }, 400],
    ['/api/soirees/2026-10-21', { format: 'libre', resultats: 'tout' }, 400],
    ['/api/soirees/2026-10-21', { format: 'poules', etat: { version: 2 }, resultats: [] }, 400],
    ['/api/soirees/2026-10-21', { format: 'poules', etat: { version: 1, mode: 'poules', matchs: [{ a: 1, b: 1, sa: 2, sb: 0 }] }, resultats: [] }, 400],
    // La poule de trois de la phase finale : trois matchs au plus, bien formés.
    ['/api/soirees/2026-10-21', { format: 'poules', etat: { version: 1, mode: 'poules', finale: 'trois' }, resultats: [] }, 400],
    ['/api/soirees/2026-10-21', { format: 'poules', etat: { version: 1, mode: 'poules', finale: { matchs: [{ a: 1, b: 2, sa: 3, sb: 0 }] } }, resultats: [] }, 400],
    ['/api/soirees/2026-10-21', { format: 'poules', etat: { version: 1, mode: 'poules', finale: { matchs: Array.from({ length: 4 }, (_, i) => ({ a: 1, b: i + 2, sa: 2, sb: 0 })) } }, resultats: [] }, 400],
    ['/api/soirees/2026-02-30', { format: 'libre', resultats: [] }, 400],
    ['/api/soirees/2031-01-07', { format: 'libre', resultats: [] }, 400],
  ];
  for (const [chemin, corps, attendu] of cas) {
    const r = await appel(chemin, { methode: 'PUT', corps, cookie: c });
    assert.equal(r.statut, attendu, `${chemin} ${JSON.stringify(corps).slice(0, 80)}`);
  }
  const grand = await appel('/api/soirees/2026-10-21', {
    methode: 'PUT', cookie: c,
    corps: { format: 'poules', etat: { version: 1, mode: 'poules', presents: [], bourrage: 'x'.repeat(70_000) }, resultats: [] },
  });
  assert.equal(grand.statut, 413);
  const pasJson = await fetch(`${BASE}/api/joueurs`, {
    method: 'POST', headers: { Origin: ORIGINE, Cookie: c, 'Content-Type': 'text/plain' }, body: 'nom=x',
  });
  assert.equal(pasJson.status, 415);
  const nomBizarre = await appel('/api/joueurs', { methode: 'POST', corps: { nom: '<script>' }, cookie: c });
  assert.equal(nomBizarre.statut, 400);
});

// ---------------------------------------------------------------- parcours complet

test('parcours complet : joueur, soirée, classement, effacement', { skip: !ECRITURES && 'ECRITURES=1 pour l’activer' }, async () => {
  const c = await connexion();
  const nom = `Essai ${Date.now() % 100000}`;
  const j = await appel('/api/joueurs', { methode: 'POST', corps: { nom }, cookie: c });
  assert.equal(j.statut, 201);
  const doublon = await appel('/api/joueurs', { methode: 'POST', corps: { nom: nom.toUpperCase() }, cookie: c });
  assert.equal(doublon.statut, 409, 'un nom ne sert qu’une fois, casse comprise');

  const autre = (await appel('/api/joueurs')).json.joueurs.find((/** @type {any} */ x) => x.id !== j.json.id);
  const date = '2027-07-28';
  const put = await appel(`/api/soirees/${date}`, {
    methode: 'PUT', cookie: c,
    corps: {
      format: 'classement', libelle: 'Soirée d’essai',
      etat: {
        version: 1, mode: 'classement', presents: [j.json.id, autre.id], ordre: [j.json.id, autre.id],
        ajustements: { [String(autre.id)]: 1 },
      },
      resultats: [{ joueur_id: j.json.id, points: 2, place: 1 }, { joueur_id: autre.id, points: 1, place: 2 }],
    },
  });
  assert.equal(put.statut, 200);
  assert.equal(put.json.resultats.length, 2);
  assert.equal(put.json.semestre, 2);

  const lu = await appel(`/api/soirees/${date}`);
  assert.equal(lu.json.libelle, 'Soirée d’essai');
  assert.equal(lu.json.etat.mode, 'classement');
  assert.deepEqual(lu.json.etat.ajustements, { [String(autre.id)]: 1 }, 'les corrections à la main sont gardées');

  const cl = await appel('/api/classement');
  const moi = cl.json.joueurs.find((/** @type {any} */ x) => x.id === j.json.id);
  assert.equal(moi.s2.total, 2);
  assert.deepEqual(moi.detail, [{ date, points: 2, place: 1 }]);

  // Un joueur inconnu fait échouer TOUTE la saisie, pas seulement sa ligne.
  const inconnu = await appel(`/api/soirees/${date}`, {
    methode: 'PUT', cookie: c,
    corps: { format: 'libre', resultats: [{ joueur_id: j.json.id, points: 5 }, { joueur_id: 999999, points: 1 }] },
  });
  assert.equal(inconnu.statut, 400);
  assert.equal((await appel(`/api/soirees/${date}`)).json.resultats.length, 2, 'rien n’a été écrit');

  const eff = await appel(`/api/soirees/${date}/resultats`, { methode: 'DELETE', cookie: c });
  assert.equal(eff.statut, 204);
  const apres = await appel('/api/classement');
  assert.equal(apres.json.joueurs.find((/** @type {any} */ x) => x.id === j.json.id), undefined);

  const off = await appel(`/api/joueurs/${j.json.id}`, { methode: 'PATCH', corps: { actif: false }, cookie: c });
  assert.equal(off.statut, 200);
  assert.equal(off.json.actif, false);
});

test('dix essais ratés bloquent l’adresse', { skip: !ECRITURES && 'ECRITURES=1 pour l’activer' }, async () => {
  let dernier = 0;
  for (let i = 0; i < 12; i++) {
    dernier = (await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: `faux-${i}` } })).statut;
  }
  assert.equal(dernier, 429);
  const meme = await appel('/api/connexion', { methode: 'POST', corps: { mot_de_passe: MOT_DE_PASSE } });
  assert.equal(meme.statut, 429, 'même le bon mot de passe attend la fin du blocage');
});
