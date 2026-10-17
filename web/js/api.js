// @ts-check
/**
 * Appels à l'API. Les erreurs remontent avec un message lisible : celui de
 * l'API quand elle en donne un, sinon une explication de ce qui s'est passé.
 */

export class ErreurApi extends Error {
  /** @param {string} message @param {number} statut */
  constructor(message, statut) { super(message); this.statut = statut; }
}

/**
 * @param {string} chemin
 * @param {{ methode?: string, corps?: unknown }} [o]
 * @returns {Promise<any>}
 */
export async function api(chemin, { methode = 'GET', corps } = {}) {
  let r;
  try {
    r = await fetch(`/api${chemin}`, {
      method: methode,
      headers: corps === undefined ? {} : { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ErreurApi('pas de réseau : rien n’a été envoyé', 0);
  }
  if (r.status === 204) return null;
  let json = null;
  try { json = await r.json(); } catch { /* réponse vide ou non JSON */ }
  if (!r.ok) {
    const message = json && typeof json.erreur === 'string' ? json.erreur : `le serveur a répondu ${r.status}`;
    throw new ErreurApi(message, r.status);
  }
  return json;
}

/** État partagé entre les écrans, rechargé à la demande. */
export const etat = {
  /** @type {{ organisateur: boolean, environnement: string, saison: string | null, version: string } | null} */
  session: null,
  /** @type {any[] | null} joueurs (id, nom, actif) */
  joueurs: null,
  /** @type {{ saison: string, soirees: any[] } | null} */
  calendrier: null,
  /** @type {{ saison: string, derniereSoiree: string | null, joueurs: any[] } | null} */
  classement: null,
};

export async function chargerSession() {
  etat.session = await api('/session');
  return etat.session;
}

/** @param {boolean} [forcer] */
export async function chargerJoueurs(forcer = false) {
  if (!etat.joueurs || forcer) etat.joueurs = (await api('/joueurs')).joueurs;
  return /** @type {any[]} */ (etat.joueurs);
}

/** @param {boolean} [forcer] */
export async function chargerCalendrier(forcer = false) {
  if (!etat.calendrier || forcer) etat.calendrier = await api('/saison');
  return /** @type {{ saison: string, soirees: any[] }} */ (etat.calendrier);
}

/** @param {boolean} [forcer] */
export async function chargerClassement(forcer = false) {
  if (!etat.classement || forcer) etat.classement = await api('/classement');
  return /** @type {{ saison: string, derniereSoiree: string | null, joueurs: any[] }} */ (etat.classement);
}

/** Après une écriture : tout ce qui en dépend sera relu. */
export function oublier() {
  etat.joueurs = null;
  etat.calendrier = null;
  etat.classement = null;
}
