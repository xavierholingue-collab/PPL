// @ts-check
/**
 * La saisie d'une soirée, en fin de soirée, sur le téléphone de l'organisateur.
 *
 *   1. Qui est là ?
 *   2. Comment s'est jouée la soirée ? (poules, classement, points directs)
 *   3. Les résultats : poules et tableau final, ordre d'arrivée, ou points
 *   4. Vérifier et enregistrer
 *
 * Chaque appui est recopié dans le brouillon du téléphone (brouillon.js).
 * Les règles de calcul sont toutes dans regles.js, contrôlées sur la vraie
 * feuille du 16 septembre.
 */
import { api, chargerJoueurs, chargerCalendrier, chargerClassement, etat, oublier } from '../api.js';
import { h, remplir, annoncer, dateTitre, dateLongue, ordinal, pluriel, alpha } from '../ui.js';
import * as R from '../regles.js';
import { lireBrouillon, ecrireBrouillon, effacerBrouillon } from '../brouillon.js';

/** @typedef {'presents' | 'format' | 'composition' | 'matchs' | 'tableau' | 'ordre' | 'points' | 'verification'} Etape */
/** @typedef {'poules' | 'classement' | 'libre'} Mode */
/** @typedef {{ joueur_id: number, points: number, place: number | null }} Resultat */

/**
 * @typedef {{
 *   version: 1, date: string, etape: Etape, mode: Mode | null,
 *   presents: number[], libelle: string | null, compte: boolean,
 *   nbPoules: number, methode: 'classement' | 'hasard', poules: number[][],
 *   matchs: R.Match[], departages: Record<string, number[]>,
 *   tableauFinal: boolean | null, vainqueurs: Record<string, number>,
 *   finale: { matchs: R.Match[], departages: Record<string, number[]> },
 *   ordre: number[], points: Record<string, number>,
 *   ajustements: Record<string, number>, pouleOuverte: number,
 *   anciennesPoules: Record<string, number>
 * }} Brouillon
 */

const LETTRES = 'ABCDEF';
const ETAPES_AFFICHEES = ['Présents', 'Format', 'Résultats', 'Vérification'];
/** @type {Record<Etape, number>} */
const NUMERO_ETAPE = { presents: 0, format: 1, composition: 2, matchs: 2, tableau: 2, ordre: 2, points: 2, verification: 3 };

/** @param {string} date @returns {Brouillon} */
function brouillonVide(date) {
  return {
    version: 1, date, etape: 'presents', mode: null, presents: [], libelle: null, compte: true,
    nbPoules: 2, methode: 'classement', poules: [], matchs: [], departages: {},
    tableauFinal: null, vainqueurs: {}, finale: { matchs: [], departages: {} },
    ordre: [], points: {}, ajustements: {}, pouleOuverte: 0, anciennesPoules: {},
  };
}

/**
 * Reprend une soirée déjà enregistrée pour la modifier.
 * @param {string} date @param {any} soiree
 * @returns {Brouillon}
 */
function brouillonDepuisServeur(date, soiree) {
  const b = brouillonVide(date);
  b.libelle = soiree.libelle ?? null;
  b.compte = soiree.compte !== false;
  const e = soiree.etat;
  const presents = soiree.resultats.map((/** @type {any} */ r) => r.joueur_id);
  b.presents = Array.isArray(e?.presents) && e.presents.length > 0 ? e.presents : presents;
  if (e?.mode === 'poules' && Array.isArray(e.poules)) {
    Object.assign(b, {
      mode: 'poules', etape: 'matchs', poules: e.poules, nbPoules: e.poules.length,
      matchs: e.matchs ?? [], departages: e.departages ?? {}, vainqueurs: e.vainqueurs ?? {},
      // null : comme la règle (tableau final joué) ; false : pas joué ce soir-là.
      tableauFinal: R.tableauFinalEnregistre(e.tableauFinal, b.presents.length) ? null : false,
      finale: { matchs: e.finale?.matchs ?? [], departages: e.finale?.departages ?? {} },
    });
  } else if (e?.mode === 'classement' && Array.isArray(e.ordre)) {
    Object.assign(b, { mode: 'classement', etape: 'ordre', ordre: e.ordre });
  } else {
    b.mode = 'libre';
    b.etape = 'points';
    b.points = Object.fromEntries(soiree.resultats.map((/** @type {any} */ r) => [String(r.joueur_id), r.points]));
  }
  // Les points corrigés à la main : ceux gardés avec la soirée ; à défaut
  // (soirée enregistrée avant qu'on les garde), les écarts entre les points
  // enregistrés et ceux que l'assistant recalcule. Sans cela, rouvrir une
  // soirée pour changer son nom écraserait une correction sans le dire.
  if (e?.ajustements && typeof e.ajustements === 'object') {
    b.ajustements = { ...e.ajustements };
  } else {
    const calc = resultatsCalcules(b);
    for (const r of calc ?? []) {
      const enregistre = soiree.resultats.find((/** @type {any} */ x) => x.joueur_id === r.joueur_id);
      if (enregistre && enregistre.points !== r.points) b.ajustements[String(r.joueur_id)] = enregistre.points;
    }
  }
  return b;
}

// ---------------------------------------------------------------- calculs

/** @param {Brouillon} b */
function classementsDePoules(b) {
  return b.poules.map((joueurs) => R.classerPoule(joueurs, b.matchs, b.departages));
}

/** Le tableau final se joue-t-il ? Le choix de l'organisateur prime sur la règle. @param {Brouillon} b */
function tableauJoue(b) {
  if (b.poules.length !== 2) return false;
  return b.tableauFinal ?? R.tableauFinalPrevu(2);
}

/** La phase finale, d'après le classement des deux poules. @param {Brouillon} b */
function finaleDe(b) {
  const cls = classementsDePoules(b);
  return R.finaleDuTableau(cls[0].lignes.map((l) => l.id), cls[1].lignes.map((l) => l.id));
}

/**
 * Les points calculés selon le mode, avant ajustement à la main.
 * Rend null tant qu'il manque des résultats.
 * @param {Brouillon} b
 * @returns {Resultat[] | null}
 */
function resultatsCalcules(b) {
  if (b.mode === 'libre') {
    return b.presents.map((id) => ({ joueur_id: id, points: b.points[String(id)] ?? 0, place: null }));
  }
  if (b.mode === 'classement') {
    if (b.ordre.length !== b.presents.length) return null;
    return R.pointsDepuisPlaces(b.ordre.map((id, i) => ({ id, place: i + 1 })))
      .map((p) => ({ joueur_id: p.id, points: p.points, place: p.place }));
  }
  if (b.mode === 'poules') {
    const cls = classementsDePoules(b);
    if (cls.some((c) => !c.complete)) return null;
    if (b.poules.length === 1) {
      return R.pointsDepuisPlaces(cls[0].lignes.map((l) => ({ id: l.id, place: l.rang })))
        .map((p) => ({ joueur_id: p.id, points: p.points, place: p.place }));
    }
    if (tableauJoue(b)) {
      const places = R.placesDepuisFinale(finaleDe(b),
        /** @type {Record<number, number>} */ (/** @type {unknown} */ (b.vainqueurs)), b.finale.matchs, b.finale.departages);
      if (!places) return null;
      return R.pointsDepuisPlaces(places).map((p) => ({ joueur_id: p.id, points: p.points, place: p.place }));
    }
    return R.pointsSansTableauFinal(cls.map((c) => c.lignes)).map((p) => ({ joueur_id: p.id, points: p.points, place: null }));
  }
  return null;
}

/** Les points à enregistrer : calculés, puis ajustés à la main s'il le faut. @param {Brouillon} b */
function resultatsFinaux(b) {
  const calc = resultatsCalcules(b);
  if (!calc) return null;
  return calc.map((r) => ({ ...r, points: b.ajustements[String(r.joueur_id)] ?? r.points }));
}

/**
 * L'état de l'assistant, tel qu'on le garde avec la soirée : seulement ce
 * qui concerne les présents de ce soir (un joueur retiré en cours de route
 * garde ses matchs dans le brouillon, pour le cas où on le recoche, mais
 * ils ne partent pas avec la soirée).
 * @param {Brouillon} b
 */
function etatPourServeur(b) {
  const presents = new Set(b.presents);
  const ajustements = Object.fromEntries(Object.entries(b.ajustements).filter(([id]) => presents.has(Number(id))));
  if (b.mode === 'poules') {
    const pouleDe = new Map(b.poules.flatMap((p, i) => p.map((id) => [id, i])));
    const matchs = b.matchs.filter((m) => pouleDe.has(m.a) && pouleDe.get(m.a) === pouleDe.get(m.b));
    return {
      version: 1, mode: 'poules', presents: b.presents, poules: b.poules, matchs,
      departages: b.departages, vainqueurs: b.vainqueurs, ajustements,
      ...(b.finale.matchs.length > 0 ? { finale: { matchs: b.finale.matchs, departages: b.finale.departages } } : {}),
      // Toujours écrit : la règle a changé une fois (22/10/2026), une soirée
      // enregistrée doit se relire de la même façon quoi qu'il arrive ensuite.
      ...(b.poules.length === 2 ? { tableauFinal: tableauJoue(b) } : {}),
    };
  }
  if (b.mode === 'classement') return { version: 1, mode: 'classement', presents: b.presents, ordre: b.ordre, ajustements };
  return { version: 1, mode: 'libre', presents: b.presents, ajustements };
}

/** Mélange de Fisher-Yates, avec l'aléa du navigateur. @param {number[]} t */
function melanger(t) {
  const c = [...t];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

// ---------------------------------------------------------------- écran

/** @param {HTMLElement} vue @param {string[]} params */
export async function ecranSaisie(vue, [date, etapeDemandee]) {
  if (!etat.session?.organisateur) {
    remplir(vue,
      h('div', { class: 'titre-page' }, h('h1', null, 'Saisie des points')),
      h('div', { class: 'vide' },
        h('strong', null, 'La saisie est réservée à l’organisateur.'),
        h('a', { class: 'bouton', href: '#/organisateur' }, 'Se connecter')));
    return;
  }

  const [joueurs, cal, classement] = await Promise.all([chargerJoueurs(true), chargerCalendrier(), chargerClassement()]);
  /** @type {any} */
  let serveur = null;
  // Hors connexion (statut 0), on saisit quand même : l'enregistrement se
  // fera au retour du réseau, depuis le brouillon du téléphone.
  let horsLigne = false;
  try {
    serveur = await api(`/soirees/${date}`);
  } catch (e) {
    const statut = /** @type {any} */ (e).statut;
    if (statut === 0) horsLigne = true;
    else if (statut !== 404) throw e;
  }

  const auCalendrier = cal.soirees.find((s) => s.date === date);
  const semestre = auCalendrier?.semestre ?? (Number(date.slice(5, 7)) >= 8 ? 1 : 2);
  const dejaEnregistree = (serveur?.resultats?.length ?? 0) > 0;

  /** @type {Brouillon} */
  let b;
  let repris = false;
  const enCours = lireBrouillon(date);
  if (enCours) {
    b = { ...brouillonVide(date), ...enCours };
    repris = true;
  } else if (dejaEnregistree) {
    b = brouillonDepuisServeur(date, serveur);
    // « Corriger des points » : droit au tableau des points, sans repasser par les matchs.
    if (etapeDemandee === 'verification') b.etape = 'verification';
  } else {
    b = brouillonVide(date);
    b.libelle = auCalendrier?.libelle ?? null;
    b.compte = auCalendrier ? auCalendrier.compte : true;
  }

  // Un brouillon gardé avant la poule de trois (octobre 2026) n'en a pas.
  b.finale = { matchs: b.finale?.matchs ?? [], departages: b.finale?.departages ?? {} };

  const nomDe = new Map(joueurs.map((j) => [j.id, j.nom]));
  /** @param {number} id */
  const nom = (id) => nomDe.get(id) ?? `joueur ${id}`;
  // Ordre de force : le classement du semestre de la soirée, puis l'alphabet.
  const cle = semestre === 2 ? 's2' : 's1';
  const totalDe = new Map(classement.joueurs.map((j) => [j.id, j[cle].total]));
  /** @param {number[]} ids */
  const parForce = (ids) => [...ids].sort((x, y) => (totalDe.get(y) ?? -1) - (totalDe.get(x) ?? -1) || alpha(nom(x), nom(y)));

  function sauver() {
    ecrireBrouillon(b);
  }

  /**
   * Les vainqueurs du tableau final et la poule de trois dépendent du
   * classement des poules : tout ce qui le change les rend caducs.
   */
  function oublierFinale() {
    b.vainqueurs = {};
    b.finale = { matchs: [], departages: {} };
  }

  /** @param {Etape} etape */
  function aller(etape) {
    b.etape = etape;
    sauver();
    dessiner();
    window.scrollTo({ top: 0 });
    vue.querySelector('h1')?.focus({ preventScroll: true });
  }

  function dessiner() {
    const n = NUMERO_ETAPE[b.etape];
    const etapes = h('ol', { class: 'etapes', 'aria-label': 'Étapes de la saisie' },
      ETAPES_AFFICHEES.map((t, i) => h('li', { class: i < n ? 'faite' : '', 'aria-current': i === n ? 'step' : null }, t)));
    /** @type {Record<Etape, () => (Node | null)[]>} */
    const parEtape = {
      presents: etapePresents, format: etapeFormat, composition: etapeComposition, matchs: etapeMatchs,
      tableau: etapeTableau, ordre: etapeOrdre, points: etapePoints, verification: etapeVerification,
    };
    // Chaque étape commence par son titre ; la date et les étapes viennent dessous.
    /** @type {(Node | null)[]} */
    let noeuds;
    try {
      noeuds = (parEtape[b.etape] ?? etapePresents)();
    } catch (e) {
      // Un état incohérent ne doit pas bloquer la saisie : on propose de
      // repartir de zéro plutôt que de laisser l'écran figé.
      console.error(e);
      remplir(vue,
        h('div', { class: 'titre-page' }, h('h1', null, 'La saisie en cours est illisible')),
        h('p', null, 'Le brouillon gardé sur ce téléphone ne correspond plus à cette version. Repartez de zéro : les points déjà enregistrés sur le serveur ne sont pas touchés.'),
        h('button', {
          type: 'button', class: 'bouton',
          onclick: () => {
            effacerBrouillon(date);
            b = dejaEnregistree ? brouillonDepuisServeur(date, serveur) : { ...brouillonVide(date), libelle: auCalendrier?.libelle ?? null, compte: auCalendrier ? auCalendrier.compte : true };
            repris = false;
            dessiner();
          },
        }, 'Repartir de zéro'));
      return;
    }
    const [titre, ...contenu] = noeuds;
    remplir(vue,
      h('div', { class: 'titre-page' },
        titre,
        h('p', { class: 'sous-titre' }, `${dateTitre(date)}${b.libelle ? `, ${b.libelle}` : ''}`)),
      etapes,
      horsLigne ? h('p', { class: 'aide', role: 'status' }, 'Pas de réseau pour l’instant : la saisie avance sur ce téléphone, vous l’enregistrerez quand le réseau reviendra.') : null,
      repris ? h('p', { class: 'aide' }, 'Saisie reprise là où elle s’était arrêtée sur ce téléphone. ',
        h('button', {
          type: 'button', class: 'bouton-texte',
          onclick: () => {
            effacerBrouillon(date);
            b = dejaEnregistree ? brouillonDepuisServeur(date, serveur) : { ...brouillonVide(date), libelle: auCalendrier?.libelle ?? null, compte: auCalendrier ? auCalendrier.compte : true };
            repris = false;
            dessiner();
          },
        }, 'Repartir de zéro')) : null,
      ...contenu);
  }

  // ---------------------------------------------------------- 1. présents

  function etapePresents() {
    const compteur = h('span', null);
    const continuer = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'bouton', onclick: () => aller('format') }, 'Continuer'));
    const maj = () => {
      compteur.textContent = pluriel(b.presents.length, 'joueur présent', 'joueurs présents');
      continuer.disabled = b.presents.length < 2;
    };
    const recherche = /** @type {HTMLInputElement} */ (h('input', { type: 'search', id: 'cherche-joueur', placeholder: 'Chercher un prénom', autocomplete: 'off' }));
    const liste = h('ul', { class: 'puces', 'aria-label': 'Joueurs' });
    let voirArchives = false;

    /** @param {any} j */
    const puce = (j) => {
      const b_ = h('button', {
        type: 'button', class: 'puce', 'aria-pressed': String(b.presents.includes(j.id)), 'data-nom': j.nom,
        onclick: () => {
          const i = b.presents.indexOf(j.id);
          if (i >= 0) b.presents.splice(i, 1); else b.presents.push(j.id);
          b_.setAttribute('aria-pressed', String(i < 0));
          // Un joueur retiré des présents sort aussi des poules et du classement.
          if (i >= 0) retirerPartout(j.id);
          sauver();
          maj();
        },
      }, j.nom);
      return h('li', null, b_);
    };

    const remplirListe = () => {
      const filtre = recherche.value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
      const visibles = joueurs
        .filter((j) => (j.actif || voirArchives || b.presents.includes(j.id)))
        .filter((j) => !filtre || j.nom.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(filtre))
        .sort((x, y) => alpha(x.nom, y.nom));
      remplir(liste, visibles.length ? visibles.map(puce) : h('li', { class: 'aide' }, 'Aucun joueur ne correspond.'));
    };
    recherche.addEventListener('input', remplirListe);

    const champNouveau = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'nouveau-joueur', placeholder: 'Prénom et initiale', maxlength: '40', autocomplete: 'off' }));
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    const ajout = h('form', {
      class: 'section',
      onsubmit: async (/** @type {SubmitEvent} */ ev) => {
        ev.preventDefault();
        erreur.textContent = '';
        const valeur = champNouveau.value.trim();
        if (!valeur) return;
        try {
          const j = await api('/joueurs', { methode: 'POST', corps: { nom: valeur } });
          joueurs.push(j);
          nomDe.set(j.id, j.nom);
          b.presents.push(j.id);
          sauver();
          champNouveau.value = '';
          oublier();
          remplirListe();
          maj();
          annoncer(`${j.nom} ajouté et marqué présent`);
        } catch (e) {
          erreur.textContent = /** @type {Error} */ (e).message;
        }
      },
    },
    h('div', { class: 'champ' }, h('label', { for: 'nouveau-joueur' }, 'Un nouveau ce soir ?'),
      h('div', { class: 'ligne-ajout' }, champNouveau, h('button', { type: 'submit', class: 'bouton-second' }, 'Ajouter'))),
    erreur);

    const archives = joueurs.some((j) => !j.actif)
      ? h('label', { class: 'interrupteur' },
        h('input', { type: 'checkbox', onchange: (/** @type {Event} */ ev) => { voirArchives = /** @type {HTMLInputElement} */ (ev.target).checked; remplirListe(); } }),
        'Afficher aussi les joueurs archivés')
      : null;

    remplirListe();
    maj();
    return [
      h('h1', null, 'Qui est là ?'),
      h('p', { class: 'aide' }, 'Touchez les joueurs présents ce soir.'),
      h('div', { class: 'recherche' }, h('label', { class: 'sr', for: 'cherche-joueur' }, 'Chercher un joueur'), recherche),
      liste,
      archives,
      ajout,
      h('div', { class: 'barre-action' }, h('p', { class: 'aide', role: 'status' }, compteur), continuer),
    ];
  }

  /** @param {number} id */
  /**
   * Un joueur décoché sort des poules et du classement, MAIS ses matchs et
   * ses points restent dans le brouillon, avec sa poule d'origine : décoché
   * par erreur et recoché aussitôt, il retrouve tout. Rien de lui ne part
   * avec la soirée tant qu'il n'est pas présent (voir etatPourServeur).
   * @param {number} id
   */
  function retirerPartout(id) {
    const poule = b.poules.findIndex((p) => p.includes(id));
    if (poule >= 0) b.anciennesPoules[String(id)] = poule;
    b.poules = b.poules.map((p) => p.filter((x) => x !== id));
    b.ordre = b.ordre.filter((x) => x !== id);
    for (const k of Object.keys(b.departages)) if (k.split('-').map(Number).includes(id)) delete b.departages[k];
    oublierFinale();
  }

  // ---------------------------------------------------------- 2. format

  function etapeFormat() {
    /** @type {[Mode, string, string][]} */
    const choix = [
      ['poules', 'Poules', 'Vous notez chaque match ; l’appli classe les poules, prépare le tableau final et donne les points.'],
      ['classement', 'Classement de la soirée', 'Tableau, tournoi… Vous indiquez l’ordre d’arrivée ; les points suivent la place.'],
      ['libre', 'Points directs', 'Vous tapez les points de chacun, comme dans le fichier.'],
    ];
    const continuer = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', class: 'bouton', disabled: b.mode === null,
      onclick: () => {
        if (b.mode === 'poules') aller(b.poules.length > 0 ? 'matchs' : 'composition');
        else if (b.mode === 'classement') aller('ordre');
        else aller('points');
      },
    }, 'Continuer'));
    const liste = h('ul', { class: 'choix-format' }, choix.map(([mode, titre, texte]) => h('li', null,
      h('button', {
        type: 'button', 'aria-pressed': String(b.mode === mode),
        onclick: (/** @type {Event} */ ev) => {
          b.mode = mode;
          for (const x of liste.querySelectorAll('button')) x.setAttribute('aria-pressed', 'false');
          /** @type {HTMLElement} */ (ev.currentTarget).setAttribute('aria-pressed', 'true');
          continuer.disabled = false;
          sauver();
        },
      }, h('strong', null, titre), h('span', null, texte)))));

    const libelle = /** @type {HTMLInputElement} */ (h('input', {
      type: 'text', id: 'libelle', maxlength: '40', value: b.libelle ?? '', placeholder: 'Beaujolais, Doubles, Masters…',
      oninput: () => { b.libelle = libelle.value.trim() || null; sauver(); },
    }));
    return [
      h('h1', null, 'Comment s’est jouée la soirée ?'),
      liste,
      h('div', { class: 'champ' }, h('label', { for: 'libelle' }, 'Nom de la soirée (facultatif)'), libelle),
      h('label', { class: 'interrupteur' },
        h('input', { type: 'checkbox', checked: b.compte, onchange: (/** @type {Event} */ ev) => { b.compte = /** @type {HTMLInputElement} */ (ev.target).checked; sauver(); } }),
        'Cette soirée compte pour le championnat'),
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('presents') }, 'Retour'),
        continuer),
    ];
  }

  // ---------------------------------------------------------- 3a. poules : composition

  function composer() {
    const ordre = b.methode === 'hasard' ? melanger(b.presents) : parForce(b.presents);
    b.poules = R.repartirEnSerpentin(ordre, b.nbPoules);
    b.matchs = [];
    b.departages = {};
    oublierFinale();
    b.pouleOuverte = 0;
  }

  /**
   * Un joueur ajouté aux présents après le tirage (arrivé en retard, oublié)
   * rejoint la poule la moins remplie. Les matchs déjà notés sont gardés :
   * refaire tout le tirage les effacerait.
   */
  function placerRetardataires() {
    const places = new Set(b.poules.flat());
    const manquants = b.presents.filter((id) => !places.has(id));
    for (const id of manquants) {
      // Recoché après un retrait : il retrouve sa poule, et donc ses matchs.
      const ancienne = b.anciennesPoules[String(id)];
      const plusPetite = b.poules.reduce((min, p, i) => (p.length < b.poules[min].length ? i : min), 0);
      b.poules[ancienne !== undefined && ancienne < b.poules.length ? ancienne : plusPetite].push(id);
      delete b.anciennesPoules[String(id)];
    }
    if (manquants.length > 0) {
      oublierFinale();
      sauver();
      annoncer(`${manquants.map(nom).join(', ')} ${manquants.length > 1 ? 'rejoignent' : 'rejoint'} la poule la moins remplie.`);
    }
  }

  /** Les matchs notés entre joueurs d'une même poule. @param {number} [joueur] seulement les siens */
  function matchsNotes(joueur) {
    const pouleDe = new Map(b.poules.flatMap((p, i) => p.map((id) => [id, i])));
    return b.matchs.filter((m) => pouleDe.has(m.a) && pouleDe.get(m.a) === pouleDe.get(m.b)
      && (joueur === undefined || m.a === joueur || m.b === joueur));
  }

  function etapeComposition() {
    if (b.poules.length === 0) {
      b.nbPoules = R.nbPoulesConseille(b.presents.length);
      composer();
      sauver();
    } else {
      placerRetardataires();
    }
    const conseil = R.nbPoulesConseille(b.presents.length);
    const zone = h('div', { class: 'poules-compo' });
    const info = h('p', { class: 'aide', role: 'status' });
    const zoneConfirmation = h('div', { 'aria-live': 'assertive' });

    /**
     * AUCUN GESTE N'EFFACE DES MATCHS SANS LE DIRE. Sans match noté, l'action
     * se fait tout de suite ; sinon on demande, dans la page, avec le nombre
     * de matchs qui seraient perdus.
     * @param {number} nb @param {string} quoi @param {() => void} action
     */
    const confirmerPuis = (nb, quoi, action) => {
      if (nb === 0) { action(); return; }
      remplir(zoneConfirmation, h('div', { class: 'depart', role: 'alertdialog', 'aria-label': 'Confirmer' },
        h('p', null, `${quoi} efface ${pluriel(nb, 'match noté', 'matchs notés')}.`),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'bouton-danger confirmer', onclick: () => { remplir(zoneConfirmation); action(); } }, 'Effacer et continuer'),
          h('button', { type: 'button', class: 'bouton-second', onclick: () => remplir(zoneConfirmation) }, 'Annuler'))));
      zoneConfirmation.querySelector('button')?.focus();
    };

    const refaire = () => { composer(); sauver(); dessinerPoules(); };

    const dessinerPoules = () => {
      remplir(zone, b.poules.map((poule, i) => h('div', { class: 'poule-colonne' },
        h('h3', null, `Poule ${LETTRES[i]}`, h('small', null, pluriel(poule.length, 'joueur'))),
        h('ol', null, poule.map((id) => h('li', null, h('button', {
          type: 'button',
          'aria-label': `${nom(id)} : passer dans la poule ${LETTRES[(i + 1) % b.poules.length]}`,
          onclick: () => {
            if (b.poules.length < 2) return;
            // Changer un joueur de poule n'efface QUE ses matchs à lui.
            confirmerPuis(matchsNotes(id).length, `Changer ${nom(id)} de poule`, () => {
              b.poules[i] = b.poules[i].filter((x) => x !== id);
              b.poules[(i + 1) % b.poules.length].push(id);
              b.matchs = b.matchs.filter((m) => m.a !== id && m.b !== id);
              for (const k of Object.keys(b.departages)) if (k.split('-').map(Number).includes(id)) delete b.departages[k];
              oublierFinale();
              sauver();
              dessinerPoules();
            });
          },
        }, h('span', null, nom(id)), b.poules.length > 1 ? h('span', { 'aria-hidden': 'true' }, '⇄') : null)))))));
      const n = b.presents.length;
      info.textContent = b.poules.length === 2
        ? (Math.abs(b.poules[0].length - b.poules[1].length) !== 1
          ? 'Après les poules, le tableau final : 1er de A contre 1er de B, 2e contre 2e, et ainsi de suite.'
          : 'Après les poules, le tableau final : 1er de A contre 1er de B, et ainsi de suite ; les trois derniers jouent une poule de trois.')
        : b.poules.length === 1
          ? 'Une seule poule : son classement donne directement les places de la soirée.'
          : `Avec ${b.poules.length} poules, les points suivent le rang dans la poule : 12 pts aux premiers, 11 aux deuxièmes…`;
    };

    const sortie = h('output', { 'aria-live': 'polite' }, b.nbPoules);
    /** @param {number} delta */
    const changerNombre = (delta) => {
      const n = Math.min(4, Math.max(1, b.nbPoules + delta));
      if (n === b.nbPoules) return;
      confirmerPuis(matchsNotes().length, 'Changer le nombre de poules', () => {
        b.nbPoules = n;
        sortie.textContent = String(n);
        refaire();
      });
    };
    const methodes = h('div', { class: 'segments', role: 'group', 'aria-label': 'Répartition' },
      /** @type {['classement' | 'hasard', string][]} */ ([['classement', 'Selon le classement'], ['hasard', 'Au hasard']]).map(([m, t]) => h('button', {
        type: 'button', 'aria-pressed': String(b.methode === m),
        onclick: () => {
          if (b.methode === m) return; // déjà choisie : rien à refaire
          confirmerPuis(matchsNotes().length, 'Refaire les poules', () => {
            b.methode = m;
            for (const x of methodes.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x.textContent === t));
            refaire();
            dessiner();
          });
        },
      }, t)));

    dessinerPoules();
    return [
      h('h1', null, 'Les poules'),
      h('div', { class: 'reglage' },
        h('span', null, 'Nombre de poules', h('br'), h('span', { class: 'aide' }, `Conseillé pour ${b.presents.length} joueurs : ${conseil}`)),
        h('span', { class: 'compteur' },
          h('button', { type: 'button', 'aria-label': 'Une poule de moins', onclick: () => changerNombre(-1) }, '−'),
          sortie,
          h('button', { type: 'button', 'aria-label': 'Une poule de plus', onclick: () => changerNombre(1) }, '+'))),
      methodes,
      b.methode === 'hasard'
        ? h('button', { type: 'button', class: 'bouton-texte', onclick: () => confirmerPuis(matchsNotes().length, 'Un nouveau tirage', refaire) }, 'Tirer à nouveau')
        : null,
      zoneConfirmation,
      h('p', { class: 'aide' }, 'Le serpentin équilibre les poules : 1er en A, 2e et 3e en B, 4e et 5e en A… Touchez un joueur pour le changer de poule.'),
      zone,
      info,
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('format') }, 'Retour'),
        h('button', { type: 'button', class: 'bouton', onclick: () => aller('matchs') }, 'Lancer les matchs')),
    ];
  }

  // ---------------------------------------------------------- cartes communes
  // Une poule de la soirée et la poule de trois de la phase finale se notent
  // de la même façon : mêmes cartes, seul l'endroit où l'on écrit change.

  /** @typedef {{ matchs: R.Match[], departages: Record<string, number[]> }} Cible */

  /**
   * Égalité que les victoires et le duel ne tranchent pas : la tournante
   * en 5 points se joue à la table, l'organisateur en donne l'ordre.
   * @param {{ cle: string, joueurs: number[] }} g
   * @param {string} ou « dans la poule A », « dans la poule de trois »
   * @param {() => Cible} cible
   * @param {() => void} apres appelé une fois l'ordre noté et sauvé
   */
  function carteDepartage(g, ou, cible, apres) {
    /** @type {number[]} */
    const ordre = [];
    const liste = h('ol', null);
    const boutons = h('div', { class: 'actions' });
    const remplirCarte = () => {
      remplir(liste, ordre.map((id) => h('li', null, nom(id))));
      remplir(boutons, g.joueurs.filter((id) => !ordre.includes(id)).map((id) => h('button', {
        type: 'button', class: 'bouton-second',
        onclick: () => {
          ordre.push(id);
          if (ordre.length === g.joueurs.length - 1) ordre.push(/** @type {number} */ (g.joueurs.find((x) => !ordre.includes(x))));
          if (ordre.length === g.joueurs.length) {
            cible().departages[g.cle] = [...ordre];
            sauver();
            apres();
          } else remplirCarte();
        },
      }, nom(id))));
    };
    remplirCarte();
    return h('div', { class: 'depart', role: 'group', 'aria-label': 'Égalité à départager' },
      h('h3', null, 'Égalité à départager'),
      h('p', null, `${g.joueurs.map(nom).join(', ')} : mêmes points et mêmes victoires ${ou}. `,
        'Jouez la tournante en 5 points, puis touchez-les dans l’ordre, du premier au dernier.'),
      liste,
      boutons);
  }

  /**
   * Un match en deux sets gagnants : on touche le score du joueur de gauche.
   * @param {{ a: number, b: number }} r
   * @param {() => Cible} cible
   * @param {() => void} apres appelé après chaque appui, une fois sauvé
   * @param {() => void} [rendCaduc] ce qu'un résultat changé efface en plus des départages
   */
  function carteMatch(r, cible, apres, rendCaduc) {
    const noms = h('div', { class: 'match-noms' });
    const issues = h('div', { class: 'issues', role: 'group', 'aria-label': `${nom(r.a)} contre ${nom(r.b)}` });
    const carte = h('li', { class: 'match' }, noms, issues);
    const dessinerCarte = () => {
      const c = cible();
      const m = R.trouverMatch(c.matchs, r.a, r.b);
      // L'issue est toujours lue du point de vue du joueur de gauche (r.a).
      const sa = m ? (m.a === r.a ? m.sa : m.sb) : null;
      const sb = m ? (m.a === r.a ? m.sb : m.sa) : null;
      carte.classList.toggle('joue', Boolean(m));
      remplir(noms,
        h('span', { class: m && sa !== null && sb !== null && sa > sb ? 'gagnant' : '' }, nom(r.a)),
        h('i', null, 'contre'),
        h('span', { class: m && sa !== null && sb !== null && sb > sa ? 'gagnant' : '' }, nom(r.b)));
      remplir(issues, R.ISSUES.map(([x, y]) => h('button', {
        type: 'button', class: 'issue', 'aria-pressed': String(sa === x && sb === y),
        'aria-label': `${nom(r.a)} ${x}, ${nom(r.b)} ${y}`,
        onclick: () => {
          const cc = cible();
          // Retoucher le score déjà choisi l'efface (erreur de doigt).
          cc.matchs = cc.matchs.filter((mm) => R.clePaire(mm.a, mm.b) !== R.clePaire(r.a, r.b));
          if (!(sa === x && sb === y)) cc.matchs.push({ a: r.a, b: r.b, sa: x, sb: y });
          // Un résultat qui change peut défaire une égalité déjà tranchée,
          // ou en créer une : les départages qui touchent ces joueurs sont revus.
          for (const k of Object.keys(cc.departages)) {
            const ids = k.split('-').map(Number);
            if (ids.includes(r.a) || ids.includes(r.b)) delete cc.departages[k];
          }
          rendCaduc?.();
          sauver();
          dessinerCarte();
          apres();
        },
      }, `${x}-${y}`)));
    };
    dessinerCarte();
    return carte;
  }

  // ---------------------------------------------------------- 3b. poules : matchs

  function etapeMatchs() {
    if (b.poules.length === 0) { b.etape = 'composition'; return etapeComposition(); }
    placerRetardataires();
    if (b.pouleOuverte >= b.poules.length) b.pouleOuverte = 0;
    const totalAttendus = b.poules.reduce((s, p) => s + (p.length * (p.length - 1)) / 2, 0);

    const progression = h('div', { class: 'progression' });
    const zoneMatchs = h('div', { class: 'section' });
    const zoneClassement = h('div', { class: 'section' });
    const suivant = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'bouton' }));

    const majProgression = () => {
      const cls = classementsDePoules(b);
      const joues = cls.reduce((s, c) => s + c.matchsJoues, 0);
      const barre = h('span', { class: 'progression-barre' }, h('span', { vars: { '--avance': `${Math.round((100 * joues) / Math.max(1, totalAttendus))}%` } }));
      remplir(progression, h('span', null, `${joues} matchs sur ${totalAttendus}`), barre);
      const toutes = cls.every((c) => c.complete);
      suivant.disabled = !toutes;
      const versTableau = b.poules.length === 2;
      suivant.textContent = versTableau ? 'Tableau final' : 'Voir les points';
      suivant.onclick = () => aller(versTableau ? 'tableau' : 'verification');
    };

    const majClassement = () => {
      const i = b.pouleOuverte;
      const c = R.classerPoule(b.poules[i], b.matchs, b.departages);
      /** @type {Node[]} */
      const blocs = [
        h('h2', null, `Classement de la poule ${LETTRES[i]}`),
        h('table', { class: 'tableau' },
          h('thead', null, h('tr', null,
            h('th', { class: 'rang', scope: 'col' }, 'Rg'), h('th', { scope: 'col' }, 'Joueur'),
            h('th', { class: 'nombre', scope: 'col' }, 'Pts'), h('th', { class: 'nombre', scope: 'col' }, 'V'), h('th', { class: 'nombre', scope: 'col' }, 'J'))),
          h('tbody', null, c.lignes.map((l) => h('tr', null,
            h('td', { class: 'rang' }, l.exAequo ? `${l.rang}=` : l.rang),
            h('td', null, nom(l.id)),
            h('td', { class: 'nombre' }, l.points), h('td', { class: 'nombre' }, l.victoires), h('td', { class: 'nombre' }, l.joues))))),
      ];
      if (c.terminee) {
        for (const g of c.aDepartager) blocs.push(carteDepartage(g, `dans la poule ${LETTRES[i]}`, () => b, majClassement));
      }
      remplir(zoneClassement, ...blocs);
      majProgression();
    };

    const dessinerPoule = () => {
      const i = b.pouleOuverte;
      const rencontres = R.rencontresDePoule(b.poules[i]);
      // Comme sur la feuille : le 1er joueur et ses matchs, puis le 2e…
      /** @type {Node[]} */
      const elements = [];
      let ligne = -1;
      /** @type {HTMLElement | null} */
      let liste = null;
      for (const r of rencontres) {
        if (r.a !== ligne) {
          ligne = r.a;
          const reste = rencontres.filter((x) => x.a === r.a).length;
          elements.push(h('h3', { class: 'tour-titre' }, nom(r.a), h('small', null, ` : ${pluriel(reste, 'match')}`)));
          liste = h('ol', { class: 'matchs' });
          elements.push(liste);
        }
        /** @type {HTMLElement} */ (liste).appendChild(carteMatch(r, () => b, majClassement, oublierFinale));
      }
      remplir(zoneMatchs, ...elements);
      majClassement();
    };

    const onglets = b.poules.length > 1
      ? h('div', { class: 'segments', role: 'group', 'aria-label': 'Poule affichée' },
        b.poules.map((_, i) => h('button', {
          type: 'button', 'aria-pressed': String(i === b.pouleOuverte),
          onclick: (/** @type {Event} */ ev) => {
            b.pouleOuverte = i;
            sauver();
            for (const x of /** @type {HTMLElement} */ (ev.currentTarget).parentElement?.querySelectorAll('button') ?? []) x.setAttribute('aria-pressed', 'false');
            /** @type {HTMLElement} */ (ev.currentTarget).setAttribute('aria-pressed', 'true');
            dessinerPoule();
          },
        }, `Poule ${LETTRES[i]}`)))
      : null;

    dessinerPoule();
    return [
      h('h1', null, 'Les matchs'),
      h('p', { class: 'aide' }, 'Dans l’ordre de la feuille : le 1er joueur contre chacun des suivants, puis le 2e, et ainsi de suite. Deux sets gagnants de 11 points. Touchez le score du joueur de gauche : 2-1, c’est lui qui gagne en trois sets.'),
      onglets,
      progression,
      zoneMatchs,
      zoneClassement,
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('composition') }, 'Poules'),
        suivant),
    ];
  }

  // ---------------------------------------------------------- 3c. tableau final

  function etapeTableau() {
    const cls = classementsDePoules(b);
    if (b.poules.length !== 2 || cls.some((c) => !c.complete)) { b.etape = 'matchs'; return etapeMatchs(); }
    const joue = tableauJoue(b);
    const voirPoints = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'bouton', onclick: () => aller('verification') }, 'Voir les points'));

    /** @type {Node[]} */
    const contenu = [h('h1', null, 'Tableau final')];
    // La case dit ce qui s'est réellement passé : le tableau final se joue
    // toujours avec deux poules, mais un soir où l'on s'arrête après les
    // poules, les points suivent le rang dans la poule.
    contenu.push(h('div', { class: 'carte' },
      h('label', { class: 'interrupteur' },
        h('input', {
          type: 'checkbox', checked: joue,
          onchange: (/** @type {Event} */ ev) => {
            const voulu = /** @type {HTMLInputElement} */ (ev.target).checked;
            b.tableauFinal = voulu === R.tableauFinalPrevu(2) ? null : voulu;
            oublierFinale();
            sauver();
            dessiner();
          },
        }),
        'Le tableau final a été joué ce soir'),
      joue ? null : h('p', { class: 'aide' }, 'Sans tableau final, les points suivent le rang dans la poule : 12 pts aux premiers, 11 aux deuxièmes…')));
    if (joue) {
      const finale = finaleDe(b);
      const pf = finale.pouleFinale;
      const zonePoule = h('div', { class: 'section' });
      const verifier = () => {
        voirPoints.disabled = R.placesDepuisFinale(finale,
          /** @type {Record<number, number>} */ (/** @type {unknown} */ (b.vainqueurs)), b.finale.matchs, b.finale.departages) === null;
      };
      contenu.push(h('p', { class: 'aide' }, '1er de A contre 1er de B pour les places 1 et 2, et ainsi de suite. En trois sets gagnants. Touchez le vainqueur.'));
      contenu.push(h('ol', { class: 'rencontres' }, finale.rencontres.map((r) => {
        if (r.a === null || r.b === null) {
          const seul = /** @type {number} */ (r.a ?? r.b);
          return h('li', { class: 'rencontre' },
            h('span', { class: 'rencontre-titre' }, `Place ${r.places[0]}`),
            h('span', null, `${nom(seul)}, seul à ce niveau`));
        }
        const choix = h('div', { class: 'rencontre-choix', role: 'group', 'aria-label': `Places ${r.places[0]} et ${r.places[1]}` });
        const dessinerChoix = () => remplir(choix, /** @type {[number, string][]} */ ([[r.a, 'A'], [r.b, 'B']]).map(([id, p]) => h('button', {
          type: 'button', 'aria-pressed': String(b.vainqueurs[String(r.niveau)] === id),
          onclick: () => {
            b.vainqueurs[String(r.niveau)] = id;
            sauver();
            dessinerChoix();
            verifier();
          },
        }, nom(id), h('small', null, `${ordinal(r.niveau)} de la poule ${p}`))));
        dessinerChoix();
        return h('li', { class: 'rencontre' }, h('span', { class: 'rencontre-titre' }, `Places ${r.places[0]} et ${r.places[1]}`), choix);
      })));

      if (pf) {
        // Nombre impair : les trois derniers jouent une poule de trois
        // (David, 22/10/2026), notée comme une poule de la soirée.
        const dessinerPouleFinale = () => {
          /** @type {Node[]} */
          const blocs = [
            h('h2', null, `Poule de trois, places ${pf.places[0]} à ${pf.places[2]}`),
            h('p', { class: 'aide' }, 'Les trois derniers jouent chacun contre chacun, en deux sets gagnants de 11.'),
            h('ol', { class: 'matchs' }, R.rencontresDePoule(pf.joueurs).map((r) => carteMatch(r, () => b.finale, dessinerClassement))),
            h('div', { class: 'section' }),
          ];
          remplir(zonePoule, ...blocs);
          dessinerClassement();
        };
        const dessinerClassement = () => {
          const c = R.classerPoule(pf.joueurs, b.finale.matchs, b.finale.departages);
          const zone = /** @type {HTMLElement} */ (zonePoule.lastElementChild);
          /** @type {Node[]} */
          const blocs = [];
          if (c.matchsJoues > 0) {
            blocs.push(h('table', { class: 'tableau' },
              h('caption', { class: 'sr' }, 'Classement de la poule de trois'),
              h('thead', null, h('tr', null,
                h('th', { class: 'rang', scope: 'col' }, 'Place'), h('th', { scope: 'col' }, 'Joueur'),
                h('th', { class: 'nombre', scope: 'col' }, 'Pts'), h('th', { class: 'nombre', scope: 'col' }, 'V'), h('th', { class: 'nombre', scope: 'col' }, 'J'))),
              h('tbody', null, c.lignes.map((l, i) => h('tr', null,
                h('td', { class: 'rang' }, c.complete ? pf.places[i] : (l.exAequo ? `${l.rang}=` : l.rang)),
                h('td', null, nom(l.id)),
                h('td', { class: 'nombre' }, l.points), h('td', { class: 'nombre' }, l.victoires), h('td', { class: 'nombre' }, l.joues))))));
          }
          if (c.terminee) for (const g of c.aDepartager) blocs.push(carteDepartage(g, 'dans la poule de trois', () => b.finale, dessinerClassement));
          remplir(zone, ...blocs);
          verifier();
        };
        dessinerPouleFinale();
        contenu.push(zonePoule);
      }
      verifier();
    }
    contenu.push(h('div', { class: 'barre-action' },
      h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('matchs') }, 'Retour'),
      voirPoints));
    return contenu;
  }

  // ---------------------------------------------------------- 3d. classement de la soirée

  function etapeOrdre() {
    b.ordre = b.ordre.filter((id) => b.presents.includes(id));
    const classes = h('ol', { class: 'ordre', 'aria-label': 'Classement de la soirée' });
    const restants = h('ul', { class: 'puces', 'aria-label': 'Joueurs à classer' });
    const voirPoints = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'bouton', onclick: () => aller('verification') }, 'Voir les points'));
    const etatTexte = h('p', { class: 'aide', role: 'status' });

    const majListes = () => {
      remplir(classes, b.ordre.map((id, i) => h('li', null,
        h('span', { class: 'place' }, i + 1),
        h('span', null, nom(id)),
        h('span', { class: 'ordre-boutons' },
          h('button', { type: 'button', 'aria-label': `Monter ${nom(id)}`, disabled: i === 0, onclick: () => { [b.ordre[i - 1], b.ordre[i]] = [b.ordre[i], b.ordre[i - 1]]; sauver(); majListes(); } }, '↑'),
          h('button', { type: 'button', 'aria-label': `Descendre ${nom(id)}`, disabled: i === b.ordre.length - 1, onclick: () => { [b.ordre[i + 1], b.ordre[i]] = [b.ordre[i], b.ordre[i + 1]]; sauver(); majListes(); } }, '↓'),
          h('button', { type: 'button', 'aria-label': `Retirer ${nom(id)} du classement`, onclick: () => { b.ordre.splice(i, 1); sauver(); majListes(); } }, '✕')))));
      const reste = b.presents.filter((id) => !b.ordre.includes(id)).sort((x, y) => alpha(nom(x), nom(y)));
      remplir(restants, reste.map((id) => h('li', null, h('button', {
        type: 'button', class: 'puce', onclick: () => { b.ordre.push(id); sauver(); majListes(); },
      }, nom(id)))));
      voirPoints.disabled = reste.length > 0;
      etatTexte.textContent = reste.length > 0
        ? `Encore ${pluriel(reste.length, 'joueur')} à placer : touchez-les dans l’ordre d’arrivée.`
        : `Tout le monde est placé : le 1er marque ${b.presents.length} points, le dernier 1 point.`;
    };
    majListes();
    return [
      h('h1', null, 'Classement de la soirée'),
      h('p', { class: 'aide' }, 'Touchez les joueurs du premier au dernier. Les flèches corrigent une erreur.'),
      classes,
      restants,
      etatTexte,
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('format') }, 'Retour'),
        voirPoints),
    ];
  }

  // ---------------------------------------------------------- 3e. points directs

  function etapePoints() {
    const liste = h('ol', { class: 'ordre points-libres' });
    const total = h('p', { class: 'aide', role: 'status' });
    const majTotal = () => {
      const t = b.presents.reduce((s, id) => s + (b.points[String(id)] ?? 0), 0);
      total.textContent = `Total distribué : ${pluriel(t, 'point')}.`;
    };
    for (const id of [...b.presents].sort((x, y) => alpha(nom(x), nom(y)))) {
      const champ = /** @type {HTMLInputElement} */ (h('input', {
        type: 'number', inputmode: 'numeric', min: '0', max: '99', step: '1', id: `pts-${id}`,
        value: String(b.points[String(id)] ?? ''),
        oninput: () => {
          const v = Number(champ.value);
          if (champ.value === '') delete b.points[String(id)];
          else if (Number.isInteger(v) && v >= 0 && v <= 99) b.points[String(id)] = v;
          sauver();
          majTotal();
        },
      }));
      /** @param {number} d */
      const pas = (d) => {
        const v = Math.min(99, Math.max(0, (b.points[String(id)] ?? 0) + d));
        b.points[String(id)] = v;
        champ.value = String(v);
        sauver();
        majTotal();
      };
      liste.appendChild(h('li', null,
        h('label', { for: `pts-${id}` }, nom(id)),
        h('span', { class: 'saisie-nombre' },
          h('button', { type: 'button', 'aria-label': `Un point de moins pour ${nom(id)}`, onclick: () => pas(-1) }, '−'),
          champ,
          h('button', { type: 'button', 'aria-label': `Un point de plus pour ${nom(id)}`, onclick: () => pas(1) }, '+'))));
    }
    majTotal();
    return [
      h('h1', null, 'Points de la soirée'),
      h('p', { class: 'aide' }, 'Un joueur sans points tapés compte 0.'),
      liste,
      total,
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller('format') }, 'Retour'),
        h('button', { type: 'button', class: 'bouton', onclick: () => aller('verification') }, 'Vérifier')),
    ];
  }

  // ---------------------------------------------------------- 4. vérification

  function etapeVerification() {
    const calc = resultatsCalcules(b);
    const retour = b.mode === 'poules' ? (b.poules.length === 2 ? 'tableau' : 'matchs') : b.mode === 'classement' ? 'ordre' : 'points';
    if (!calc) {
      return [
        h('h1', null, 'Il manque des résultats'),
        h('p', null, 'Revenez à l’étape précédente pour compléter la saisie.'),
        h('div', { class: 'barre-action' }, h('button', { type: 'button', class: 'bouton', onclick: () => aller(/** @type {Etape} */ (retour)) }, 'Retour')),
      ];
    }
    const lignes = [...calc].sort((x, y) => (x.place ?? 999) - (y.place ?? 999) || y.points - x.points || alpha(nom(x.joueur_id), nom(y.joueur_id)));
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    const enregistrer = /** @type {HTMLButtonElement} */ (h('button', {
      type: 'button', class: 'bouton',
      onclick: async () => {
        const resultats = resultatsFinaux(b);
        if (!resultats) return;
        enregistrer.disabled = true;
        erreur.textContent = '';
        try {
          await api(`/soirees/${date}`, {
            methode: 'PUT',
            corps: { format: b.mode, libelle: b.libelle, compte: b.compte, etat: etatPourServeur(b), resultats },
          });
          effacerBrouillon(date);
          oublier();
          annoncer('Points enregistrés');
          location.hash = `#/soiree/${date}`;
        } catch (e) {
          enregistrer.disabled = false;
          const statut = /** @type {any} */ (e).statut;
          erreur.textContent = statut === 0
            ? 'Pas de réseau : rien n’est perdu, la saisie reste sur ce téléphone. Réessayez dès que le réseau revient.'
            : statut === 401
              ? 'Votre session a expiré : reconnectez-vous (onglet Organisateur), la saisie vous attendra ici.'
              : /** @type {Error} */ (e).message;
        }
      },
    }, 'Enregistrer les points'));

    const total = lignes.reduce((s, r) => s + (b.ajustements[String(r.joueur_id)] ?? r.points), 0);
    return [
      h('h1', null, 'Vérifier et enregistrer'),
      h('p', null, `${pluriel(lignes.length, 'joueur')}, ${pluriel(total, 'point')} distribués.`,
        b.compte ? '' : ' Cette soirée ne comptera pas pour le championnat.'),
      dejaEnregistree ? h('p', { class: 'aide' }, 'Ces points remplaceront ceux déjà enregistrés pour cette soirée.') : null,
      h('table', { class: 'tableau' },
        h('thead', null, h('tr', null,
          h('th', { class: 'rang', scope: 'col' }, 'Place'), h('th', { scope: 'col' }, 'Joueur'), h('th', { class: 'nombre', scope: 'col' }, 'Points'))),
        h('tbody', null, lignes.map((r) => {
          const repere = h('small', { class: 'corrige' });
          const champ = /** @type {HTMLInputElement} */ (h('input', {
            type: 'number', inputmode: 'numeric', min: '0', max: '99', step: '1',
            'aria-label': `Points de ${nom(r.joueur_id)}`,
            value: String(b.ajustements[String(r.joueur_id)] ?? r.points),
            onchange: () => {
              const v = Number(champ.value);
              if (Number.isInteger(v) && v >= 0 && v <= 99 && v !== r.points) b.ajustements[String(r.joueur_id)] = v;
              else { delete b.ajustements[String(r.joueur_id)]; champ.value = String(r.points); }
              sauver();
              marquer();
            },
          }));
          // Une valeur corrigée à la main se voit, avec le calcul d'origine :
          // elle ne doit pas survivre en silence à un changement de résultats.
          const marquer = () => {
            const corrige = b.ajustements[String(r.joueur_id)] !== undefined;
            champ.classList.toggle('ajuste', corrige);
            repere.textContent = corrige ? `corrigé, calcul : ${r.points}` : '';
          };
          marquer();
          return h('tr', null,
            h('td', { class: 'rang' }, r.place ? ordinal(r.place) : ''),
            h('td', null, nom(r.joueur_id), h('br'), repere),
            h('td', { class: 'nombre' }, champ));
        }))),
      h('p', { class: 'aide' }, 'Les points se corrigent à la main si besoin, avant d’enregistrer.'),
      erreur,
      h('div', { class: 'barre-action' },
        h('button', { type: 'button', class: 'bouton-second', onclick: () => aller(/** @type {Etape} */ (retour)) }, 'Retour'),
        enregistrer),
    ];
  }

  dessiner();
  // Rappel discret : la date affichée est celle qu'on saisit.
  if (!auCalendrier) annoncer(`Le ${dateLongue(date)} n’est pas au calendrier : la soirée sera ajoutée.`, { duree: 5000 });
}
