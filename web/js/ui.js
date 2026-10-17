// @ts-check
/**
 * Petits outils d'interface.
 *
 * TOUT TEXTE VENU DES DONNÉES PASSE PAR textContent, jamais par innerHTML :
 * un nom de joueur ne peut pas devenir du code dans la page. C'est aussi ce
 * qui permet une politique de contenu stricte, sans script ni style en ligne.
 */

/**
 * @typedef {string | number | Node | null | undefined | false} Enfant
 * @typedef {Record<string, unknown>} Attributs
 */

/**
 * Crée un élément. Les attributs `on…` reçoivent des fonctions ; `class`
 * une chaîne ; les autres sont posés tels quels (false/null : absents).
 * @param {string} balise
 * @param {Attributs | null} [attributs]
 * @param {...(Enfant | Enfant[])} enfants
 * @returns {HTMLElement}
 */
export function h(balise, attributs, ...enfants) {
  const el = document.createElement(balise);
  for (const [nom, valeur] of Object.entries(attributs ?? {})) {
    if (valeur === false || valeur === null || valeur === undefined) continue;
    if (nom.startsWith('on') && typeof valeur === 'function') {
      el.addEventListener(nom.slice(2).toLowerCase(), /** @type {EventListener} */ (valeur));
    } else if (nom === 'style') {
      throw new Error('pas de style en ligne : utiliser une classe ou une variable CSS');
    } else if (nom === 'vars' && typeof valeur === 'object') {
      for (const [v, val] of Object.entries(/** @type {Record<string, string>} */ (valeur))) el.style.setProperty(v, val);
    } else {
      el.setAttribute(nom, valeur === true ? '' : String(valeur));
    }
  }
  ajouter(el, enfants);
  return el;
}

/** @param {Node} parent @param {(Enfant | Enfant[])[]} enfants */
function ajouter(parent, enfants) {
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    parent.appendChild(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

/** Remplace le contenu d'un élément. @param {Element} el @param {...(Enfant | Enfant[])} enfants */
export function remplir(el, ...enfants) {
  el.replaceChildren();
  ajouter(el, enfants);
}

const SVG = 'http://www.w3.org/2000/svg';

/** Les icônes, dessinées au trait. */
const TRACES = {
  classement: 'M6 21V10M12 21V4M18 21v-7M3 21h18',
  soirees: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  joueurs: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7M22 21v-1a6 6 0 0 0-4-5.6',
  organisateur: 'M8 20a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM11.2 12.3 20 3.5M16.5 7l2.2 2.2M13.9 9.6l1.8 1.8',
  chevron: 'M9 6l6 6-6 6',
  retour: 'M15 6l-6 6 6 6',
};

/** @param {keyof typeof TRACES} nom */
export function icone(nom) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', TRACES[nom]);
  svg.appendChild(p);
  return svg;
}

/**
 * Le marqueur à volets : un chiffre par panneau.
 * @param {number | string} valeur
 * @param {{ retourner?: boolean, libelle?: string }} [o]
 */
export function marqueur(valeur, { retourner = false, libelle } = {}) {
  const texte = String(valeur);
  return h('span', { class: `marqueur${retourner ? ' retourne' : ''}`, role: 'img', 'aria-label': libelle ?? texte },
    [...texte].map((c) => h('span', { class: 'volet', 'aria-hidden': 'true' }, c)));
}

// ---------------------------------------------------------------- dates

/** 'AAAA-MM-JJ' → Date locale à midi (évite les décalages d'heure d'été). @param {string} iso */
export function dateLocale(iso) {
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(a, m - 1, j, 12);
}

/** @param {Date} [d] */
export function aujourdhui(d = new Date()) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const F_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const F_JOUR = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const F_MOIS_COURT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

/** « mercredi 16 septembre » @param {string} iso */
export const dateLongue = (iso) => F_LONG.format(dateLocale(iso));
/** « Mercredi 16 septembre » @param {string} iso */
export const dateTitre = (iso) => { const t = dateLongue(iso); return t.charAt(0).toUpperCase() + t.slice(1); };
/** « mercredi » @param {string} iso */
export const jourSemaine = (iso) => F_JOUR.format(dateLocale(iso));
/** « sept. » @param {string} iso */
export const moisCourt = (iso) => F_MOIS_COURT.format(dateLocale(iso));
/** « 16/09 » @param {string} iso */
export const jourMois = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------------------------------------------------------------- textes

/** 1er, 2e, 3e… @param {number} n */
export const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);

/** « 1 soirée », « 3 soirées ». @param {number} n @param {string} singulier @param {string} [formePlurielle] */
export const pluriel = (n, singulier, formePlurielle) => `${n} ${n > 1 ? (formePlurielle ?? `${singulier}s`) : singulier}`;

/** Comparaison alphabétique française. */
export const alpha = new Intl.Collator('fr', { sensitivity: 'base' }).compare;

// ---------------------------------------------------------------- annonce

let minuterie = 0;
/**
 * Message bref, lu par les lecteurs d'écran (zone aria-live).
 * @param {string} texte
 * @param {{ erreur?: boolean, duree?: number }} [o]
 */
export function annoncer(texte, { erreur = false, duree = 3500 } = {}) {
  const zone = document.getElementById('annonce');
  if (!zone) return;
  zone.classList.toggle('erreur', erreur);
  zone.textContent = texte;
  window.clearTimeout(minuterie);
  minuterie = window.setTimeout(() => { zone.textContent = ''; }, duree);
}

/**
 * Bouton qui demande confirmation : premier appui, il change de texte ;
 * second appui dans les 5 secondes, il agit.
 * @param {string} texte
 * @param {string} texteConfirmation
 * @param {() => void | Promise<void>} action
 */
export function boutonConfirme(texte, texteConfirmation, action) {
  let arme = false;
  /** @type {number} */
  let delai = 0;
  const b = h('button', {
    type: 'button',
    class: 'bouton-danger',
    onclick: async () => {
      if (!arme) {
        arme = true;
        b.textContent = texteConfirmation;
        b.classList.add('confirmer');
        delai = window.setTimeout(() => { arme = false; b.textContent = texte; b.classList.remove('confirmer'); }, 5000);
        return;
      }
      window.clearTimeout(delai);
      await action();
    },
  }, texte);
  return b;
}

/** Redessine l'écran courant (après une écriture, par exemple). */
export function rafraichir() {
  document.dispatchEvent(new CustomEvent('ppl:rafraichir'));
}

/** Signale un changement de session (connexion, déconnexion). */
export function sessionChangee() {
  document.dispatchEvent(new CustomEvent('ppl:session'));
}
