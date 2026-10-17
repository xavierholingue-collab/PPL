// @ts-check
/**
 * Validation de tout ce qui entre par l'API.
 *
 * Chaque fonction rend soit { ok: true, valeur } avec une valeur NETTOYÉE
 * (seuls les champs connus sont recopiés), soit { ok: false, erreur } avec
 * un message qui dit quoi corriger. Rien de ce que le navigateur envoie
 * n'est écrit tel quel en base.
 */

/** @template T @typedef {{ ok: true, valeur: T } | { ok: false, erreur: string }} Resultat */

const NOM = /^[\p{L}\p{M}\p{N} .'’-]{1,40}$/u;
const LIBELLE = /^[\p{L}\p{M}\p{N} .'’/&()!,-]{1,40}$/u;

/** Taille maximale de l'état d'un assistant, une fois sérialisé. */
export const TAILLE_MAX_ETAT = 32 * 1024;
const MAX_JOUEURS_SOIREE = 99;

/** @param {unknown} v */
const entier = (v) => typeof v === 'number' && Number.isInteger(v);
/** @param {unknown} v @param {number} min @param {number} max */
const entierEntre = (v, min, max) => entier(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;
/** @param {unknown} v */
const idValide = (v) => entierEntre(v, 1, 2_147_483_647);
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const objet = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Une date de soirée : AAAA-MM-JJ, et qui existe au calendrier.
 * @param {unknown} texte
 * @returns {Resultat<string>}
 */
export function validerDate(texte) {
  if (typeof texte !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texte)) return { ok: false, erreur: 'date attendue au format AAAA-MM-JJ' };
  const [a, m, j] = texte.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return { ok: false, erreur: 'cette date n’existe pas' };
  if (a < 2020 || a > 2100) return { ok: false, erreur: 'date hors de la plage admise' };
  return { ok: true, valeur: texte };
}

/** @param {unknown} texte @returns {Resultat<string>} */
export function validerNom(texte) {
  if (typeof texte !== 'string') return { ok: false, erreur: 'nom attendu' };
  const nom = texte.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!NOM.test(nom)) return { ok: false, erreur: 'nom : 1 à 40 caractères, lettres, chiffres, espace, point, apostrophe ou tiret' };
  return { ok: true, valeur: nom };
}

/** @param {unknown} texte @returns {Resultat<string | null>} */
export function validerLibelle(texte) {
  if (texte === null || texte === undefined || texte === '') return { ok: true, valeur: null };
  if (typeof texte !== 'string') return { ok: false, erreur: 'libellé attendu' };
  const libelle = texte.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (libelle === '') return { ok: true, valeur: null };
  if (!LIBELLE.test(libelle)) return { ok: false, erreur: 'libellé : 40 caractères au plus, sans caractère spécial' };
  return { ok: true, valeur: libelle };
}

/**
 * Création d'un joueur : { nom }.
 * @param {unknown} corps
 * @returns {Resultat<{ nom: string }>}
 */
export function validerNouveauJoueur(corps) {
  if (!objet(corps)) return { ok: false, erreur: 'objet attendu' };
  const nom = validerNom(corps.nom);
  return nom.ok ? { ok: true, valeur: { nom: nom.valeur } } : nom;
}

/**
 * Modification d'un joueur : { nom?, actif? }, au moins l'un des deux.
 * @param {unknown} corps
 * @returns {Resultat<{ nom?: string, actif?: boolean }>}
 */
export function validerModificationJoueur(corps) {
  if (!objet(corps)) return { ok: false, erreur: 'objet attendu' };
  /** @type {{ nom?: string, actif?: boolean }} */
  const valeur = {};
  if (corps.nom !== undefined) {
    const nom = validerNom(corps.nom);
    if (!nom.ok) return nom;
    valeur.nom = nom.valeur;
  }
  if (corps.actif !== undefined) {
    if (typeof corps.actif !== 'boolean') return { ok: false, erreur: 'actif : vrai ou faux' };
    valeur.actif = corps.actif;
  }
  if (Object.keys(valeur).length === 0) return { ok: false, erreur: 'rien à modifier' };
  return { ok: true, valeur };
}

/**
 * @param {unknown} v
 * @param {number} max
 * @returns {number[] | null}
 */
function listeIds(v, max) {
  if (!Array.isArray(v) || v.length > max || !v.every(idValide)) return null;
  return new Set(v).size === v.length ? /** @type {number[]} */ ([...v]) : null;
}

/**
 * L'état d'un assistant de saisie. On en garde la trace pour savoir d'où
 * viennent les points ; on ne recopie que les champs connus, bornés.
 * @param {unknown} etat
 * @returns {Resultat<Record<string, unknown> | null>}
 */
export function validerEtat(etat) {
  if (etat === null || etat === undefined) return { ok: true, valeur: null };
  if (!objet(etat)) return { ok: false, erreur: 'état : objet attendu' };
  if (JSON.stringify(etat).length > TAILLE_MAX_ETAT) return { ok: false, erreur: 'état trop volumineux' };
  if (etat.version !== 1) return { ok: false, erreur: 'état : version inconnue' };
  if (!['libre', 'classement', 'poules'].includes(/** @type {string} */ (etat.mode))) return { ok: false, erreur: 'état : mode inconnu' };

  const presents = listeIds(etat.presents ?? [], MAX_JOUEURS_SOIREE);
  if (!presents) return { ok: false, erreur: 'état : liste des présents invalide' };
  /** @type {Record<string, unknown>} */
  const propre = { version: 1, mode: etat.mode, presents };

  if (etat.ordre !== undefined) {
    const ordre = listeIds(etat.ordre, MAX_JOUEURS_SOIREE);
    if (!ordre) return { ok: false, erreur: 'état : ordre invalide' };
    propre.ordre = ordre;
  }
  if (etat.poules !== undefined) {
    if (!Array.isArray(etat.poules) || etat.poules.length > 6) return { ok: false, erreur: 'état : poules invalides' };
    const poules = etat.poules.map((p) => listeIds(p, MAX_JOUEURS_SOIREE));
    if (poules.some((p) => p === null)) return { ok: false, erreur: 'état : poules invalides' };
    propre.poules = poules;
  }
  if (etat.matchs !== undefined) {
    if (!Array.isArray(etat.matchs) || etat.matchs.length > 1500) return { ok: false, erreur: 'état : matchs invalides' };
    /** @type {{ a: number, b: number, sa: number, sb: number }[]} */
    const matchs = [];
    for (const m of etat.matchs) {
      if (!objet(m) || !idValide(m.a) || !idValide(m.b) || m.a === m.b
          || !entierEntre(m.sa, 0, 2) || !entierEntre(m.sb, 0, 2)) {
        return { ok: false, erreur: 'état : un match est mal formé' };
      }
      matchs.push({ a: /** @type {number} */ (m.a), b: /** @type {number} */ (m.b), sa: /** @type {number} */ (m.sa), sb: /** @type {number} */ (m.sb) });
    }
    propre.matchs = matchs;
  }
  if (etat.departages !== undefined) {
    if (!objet(etat.departages) || Object.keys(etat.departages).length > 50) return { ok: false, erreur: 'état : départages invalides' };
    /** @type {Record<string, number[]>} */
    const departages = {};
    for (const [cle, ordre] of Object.entries(etat.departages)) {
      const ids = listeIds(ordre, MAX_JOUEURS_SOIREE);
      if (!/^\d{1,10}(-\d{1,10}){1,98}$/.test(cle) || !ids) return { ok: false, erreur: 'état : départage mal formé' };
      departages[cle] = ids;
    }
    propre.departages = departages;
  }
  if (etat.tableauFinal !== undefined) {
    if (typeof etat.tableauFinal !== 'boolean') return { ok: false, erreur: 'état : tableauFinal vrai ou faux' };
    propre.tableauFinal = etat.tableauFinal;
  }
  // Les points corrigés à la main à l'étape Vérification : gardés avec la
  // soirée, pour qu'une réouverture ne les écrase pas en silence.
  if (etat.ajustements !== undefined) {
    if (!objet(etat.ajustements) || Object.keys(etat.ajustements).length > MAX_JOUEURS_SOIREE) {
      return { ok: false, erreur: 'état : ajustements invalides' };
    }
    /** @type {Record<string, number>} */
    const ajustements = {};
    for (const [id, points] of Object.entries(etat.ajustements)) {
      if (!/^\d{1,10}$/.test(id) || !entierEntre(points, 0, 99)) return { ok: false, erreur: 'état : ajustement mal formé' };
      ajustements[id] = /** @type {number} */ (points);
    }
    propre.ajustements = ajustements;
  }
  if (etat.vainqueurs !== undefined) {
    if (!objet(etat.vainqueurs) || Object.keys(etat.vainqueurs).length > 60) return { ok: false, erreur: 'état : vainqueurs invalides' };
    /** @type {Record<string, number>} */
    const vainqueurs = {};
    for (const [niveau, id] of Object.entries(etat.vainqueurs)) {
      if (!/^\d{1,2}$/.test(niveau) || !idValide(id)) return { ok: false, erreur: 'état : vainqueur mal formé' };
      vainqueurs[niveau] = /** @type {number} */ (id);
    }
    propre.vainqueurs = vainqueurs;
  }
  return { ok: true, valeur: propre };
}

/**
 * Enregistrement d'une soirée : remplace ses résultats d'un seul coup.
 * @param {unknown} corps
 * @returns {Resultat<{
 *   format: 'libre' | 'classement' | 'poules', libelle?: string | null, compte?: boolean,
 *   etat: Record<string, unknown> | null,
 *   resultats: { joueur_id: number, points: number, place: number | null }[]
 * }>}
 */
export function validerSoiree(corps) {
  if (!objet(corps)) return { ok: false, erreur: 'objet attendu' };
  const format = corps.format;
  if (format !== 'libre' && format !== 'classement' && format !== 'poules') {
    return { ok: false, erreur: 'format : libre, classement ou poules' };
  }

  /** @type {{ libelle?: string | null, compte?: boolean }} */
  const options = {};
  if (corps.libelle !== undefined) {
    const libelle = validerLibelle(corps.libelle);
    if (!libelle.ok) return libelle;
    options.libelle = libelle.valeur;
  }
  if (corps.compte !== undefined) {
    if (typeof corps.compte !== 'boolean') return { ok: false, erreur: 'compte : vrai ou faux' };
    options.compte = corps.compte;
  }

  const etat = validerEtat(corps.etat);
  if (!etat.ok) return etat;

  if (!Array.isArray(corps.resultats) || corps.resultats.length > MAX_JOUEURS_SOIREE) {
    return { ok: false, erreur: `résultats : liste de ${MAX_JOUEURS_SOIREE} joueurs au plus` };
  }
  /** @type {{ joueur_id: number, points: number, place: number | null }[]} */
  const resultats = [];
  const vus = new Set();
  for (const r of corps.resultats) {
    if (!objet(r) || !idValide(r.joueur_id)) return { ok: false, erreur: 'résultats : joueur manquant' };
    if (!entierEntre(r.points, 0, 99)) return { ok: false, erreur: 'résultats : points entiers de 0 à 99' };
    if (r.place !== undefined && r.place !== null && !entierEntre(r.place, 1, 99)) {
      return { ok: false, erreur: 'résultats : place entière de 1 à 99' };
    }
    if (vus.has(r.joueur_id)) return { ok: false, erreur: 'résultats : un joueur apparaît deux fois' };
    vus.add(r.joueur_id);
    resultats.push({
      joueur_id: /** @type {number} */ (r.joueur_id),
      points: /** @type {number} */ (r.points),
      place: r.place === undefined || r.place === null ? null : /** @type {number} */ (r.place),
    });
  }
  return { ok: true, valeur: { format, ...options, etat: etat.valeur, resultats } };
}
