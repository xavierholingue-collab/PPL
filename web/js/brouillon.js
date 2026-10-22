// @ts-check
/**
 * La saisie en cours, gardée sur le téléphone.
 *
 * Si le réseau tombe au gymnase, ou si l'écran se ferme au milieu des
 * poules, rien n'est perdu : chaque appui est recopié ici, et la saisie
 * reprend où elle en était. Ce n'est qu'un brouillon — la vérité reste
 * sur le serveur une fois les points enregistrés.
 *
 * Le stockage du navigateur peut être absent ou refusé (navigation privée,
 * réglages) : chaque accès est protégé, et l'application fonctionne sans.
 */

const PREFIXE = 'ppl.saisie.';

/** @param {unknown} t */
const ids = (t) => t === undefined || (Array.isArray(t) && t.every((x) => Number.isInteger(x) && x > 0));
/** @param {unknown} o */
const dico = (o) => o === undefined || (typeof o === 'object' && o !== null && !Array.isArray(o));
/** @param {unknown} t */
const matchs = (t) => t === undefined || (Array.isArray(t) && t.every((/** @type {any} */ m) =>
  m && [m.a, m.b, m.sa, m.sb].every(Number.isInteger)));

/**
 * Un brouillon d'une forme inattendue (version ancienne, stockage abîmé)
 * bloquerait l'écran de saisie de cette date sur ce téléphone : on le
 * vérifie, et on l'écarte s'il ne tient pas debout.
 * @param {any} b @param {string} date
 */
function formeValide(b, date) {
  return Boolean(b) && b.version === 1 && b.date === date
    && ids(b.presents) && ids(b.ordre)
    && (b.poules === undefined || (Array.isArray(b.poules) && b.poules.every(ids)))
    && matchs(b.matchs)
    && (b.finale === undefined || (dico(b.finale) && matchs(b.finale.matchs) && dico(b.finale.departages)))
    && dico(b.points) && dico(b.ajustements) && dico(b.departages) && dico(b.vainqueurs) && dico(b.anciennesPoules);
}

/** @param {string} date @returns {any | null} */
export function lireBrouillon(date) {
  try {
    const texte = window.localStorage.getItem(PREFIXE + date);
    if (!texte) return null;
    const b = JSON.parse(texte);
    if (formeValide(b, date)) return b;
    window.localStorage.removeItem(PREFIXE + date);
    return null;
  } catch {
    try { window.localStorage.removeItem(PREFIXE + date); } catch { /* stockage indisponible */ }
    return null;
  }
}

/** @param {any} b */
export function ecrireBrouillon(b) {
  try {
    window.localStorage.setItem(PREFIXE + b.date, JSON.stringify({ ...b, maj: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

/** @param {string} date */
export function effacerBrouillon(date) {
  try { window.localStorage.removeItem(PREFIXE + date); } catch { /* rien à faire */ }
}
