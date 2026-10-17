// @ts-check
/**
 * Règles de jeu de Ping Pong Loisir.
 *
 * Fonctions pures : rien ici ne touche au DOM, au réseau ni à l'horloge.
 * Le même fichier sert à l'écran de saisie (navigateur) et aux tests (Node).
 *
 * D'où viennent ces règles
 *   • la feuille « Résultats du 16 septembre » de David (poules, égalités,
 *     tableau final, barème au-delà de 17 joueurs) ;
 *   • le fichier « PPL 2026 2027 Classement Annuel Championnat_V0.ods »
 *     (somme par semestre, rang partagé entre ex æquo).
 *
 * Ce qui reste à confirmer avec David est signalé par « À CONFIRMER ».
 */

/** @typedef {number} IdJoueur */

/**
 * Un match de poule, en deux sets gagnants.
 * `sa` et `sb` sont les sets gagnés par `a` et par `b` : 2-0, 2-1, 1-2 ou 0-2.
 * @typedef {{ a: IdJoueur, b: IdJoueur, sa: number, sb: number }} Match
 */

/**
 * @typedef {{
 *   id: IdJoueur, points: number, victoires: number, defaites: number,
 *   joues: number, setsPour: number, setsContre: number,
 *   rang: number, exAequo: boolean, departage?: 'duel' | 'tournante'
 * }} LignePoule
 */

/** Au-delà de ce nombre de joueurs, le tableau final n'est pas disputé. */
export const SEUIL_TABLEAU_FINAL = 17;

/** Barème de la feuille quand le tableau final n'est pas joué : 1ers de poule 12 pts, 2es 11 pts… */
export const DEPART_BAREME_POULE = 12;

/** Les quatre issues possibles d'un match en deux sets gagnants, vues du joueur de gauche. */
export const ISSUES = /** @type {const} */ ([[2, 0], [2, 1], [1, 2], [0, 2]]);

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/**
 * Points de la soirée selon la place : N joueurs classés, N points au 1er,
 * 1 point au dernier. C'est ce que montrent toutes les soirées du fichier
 * (16/09 : 14 joueurs, 14 → 1 ; 23/09, 30/09, 14/10 : 18 joueurs, 18 → 1).
 * À CONFIRMER : la même règle vaut-elle pour tous les formats ?
 * @param {number} place 1 pour le premier
 * @param {number} nbClasses nombre de joueurs classés ce soir-là
 */
export function pointsSelonPlace(place, nbClasses) {
  if (!Number.isInteger(place) || !Number.isInteger(nbClasses) || place < 1 || place > nbClasses) {
    throw new RangeError(`place ${place} hors de 1..${nbClasses}`);
  }
  return nbClasses - place + 1;
}

/**
 * Barème « plus de 17 joueurs » écrit sur la feuille : les premiers de chaque
 * poule prennent 12 points, les seconds 11, les troisièmes 10… sans descendre
 * sous 1 point.
 * À CONFIRMER : les soirées à 18 joueurs du fichier ont donné 1 à 18 points.
 * @param {number} rangDansLaPoule
 * @param {number} [depart]
 */
export function pointsSelonRangDePoule(rangDansLaPoule, depart = DEPART_BAREME_POULE) {
  return Math.max(1, depart - rangDansLaPoule + 1);
}

/**
 * Points d'un match : 2 au gagnant ; au perdant, 1 s'il a pris un set, 0 sinon.
 * @param {number} sa sets gagnés par a
 * @param {number} sb sets gagnés par b
 * @returns {[number, number]}
 */
export function pointsDeMatch(sa, sb) {
  if (!issueValide(sa, sb)) throw new RangeError(`issue impossible : ${sa}-${sb}`);
  return sa > sb ? [2, sb] : [sa, 2];
}

/** @param {unknown} sa @param {unknown} sb */
export function issueValide(sa, sb) {
  return (sa === 2 && (sb === 0 || sb === 1)) || (sb === 2 && (sa === 0 || sa === 1));
}

// ---------------------------------------------------------------------------
// Poules
// ---------------------------------------------------------------------------

/**
 * Nombre de poules conseillé. La feuille prévoit deux poules de onze au plus.
 * À CONFIRMER : à partir de combien de joueurs David passe-t-il à trois poules ?
 * @param {number} nbJoueurs
 */
export function nbPoulesConseille(nbJoueurs) {
  if (nbJoueurs <= 7) return 1;
  if (nbJoueurs <= 22) return 2;
  return 3;
}

/**
 * Répartition en serpentin : le 1er en A, le 2e en B, le 3e en B, le 4e en A…
 * Les poules restent de niveau comparable si l'ordre d'entrée est un classement.
 * @param {IdJoueur[]} ordre joueurs du plus fort au moins fort
 * @param {number} nbPoules
 * @returns {IdJoueur[][]}
 */
export function repartirEnSerpentin(ordre, nbPoules) {
  if (!Number.isInteger(nbPoules) || nbPoules < 1) throw new RangeError('nombre de poules invalide');
  /** @type {IdJoueur[][]} */
  const poules = Array.from({ length: nbPoules }, () => []);
  ordre.forEach((id, i) => {
    const tour = Math.floor(i / nbPoules);
    const pos = i % nbPoules;
    poules[tour % 2 === 0 ? pos : nbPoules - 1 - pos].push(id);
  });
  return poules;
}

/**
 * Toutes les rencontres d'une poule, rangées par tours (méthode du cercle) :
 * dans un même tour, personne ne joue deux fois. Avec un nombre impair de
 * joueurs, un joueur est exempt à chaque tour.
 * @param {IdJoueur[]} joueurs
 * @returns {{ tour: number, a: IdJoueur, b: IdJoueur }[]}
 */
export function rencontresDePoule(joueurs) {
  /** @type {(IdJoueur | null)[]} */
  const cercle = [...joueurs];
  if (cercle.length % 2 === 1) cercle.push(null);
  const n = cercle.length;
  /** @type {{ tour: number, a: IdJoueur, b: IdJoueur }[]} */
  const liste = [];
  for (let t = 0; t < n - 1; t++) {
    for (let i = 0; i < n / 2; i++) {
      const a = cercle[i];
      const b = cercle[n - 1 - i];
      if (a !== null && b !== null) liste.push({ tour: t + 1, a, b });
    }
    // Le premier reste en place, les autres tournent d'un cran.
    const dernier = cercle.pop();
    cercle.splice(1, 0, dernier === undefined ? null : dernier);
  }
  return liste;
}

/** Clé d'une paire, indépendante de l'ordre. @param {IdJoueur} x @param {IdJoueur} y */
export function clePaire(x, y) {
  return x < y ? `${x}-${y}` : `${y}-${x}`;
}

/** Clé d'un groupe d'ex æquo, indépendante de l'ordre. @param {IdJoueur[]} ids */
export function cleGroupe(ids) {
  return [...ids].sort((p, q) => p - q).join('-');
}

/**
 * Le match joué entre x et y, s'il existe et a une issue valide.
 * @param {Match[]} matchs @param {IdJoueur} x @param {IdJoueur} y
 */
export function trouverMatch(matchs, x, y) {
  return matchs.find((m) =>
    ((m.a === x && m.b === y) || (m.a === y && m.b === x)) && issueValide(m.sa, m.sb));
}

/** @param {Match} m */
export function vainqueur(m) {
  return m.sa > m.sb ? m.a : m.b;
}

/**
 * Classement d'une poule, avec les départages de la feuille :
 *   1. points de match (2 / 1 / 0) ;
 *   2. nombre de victoires ;
 *   3. à deux, le match gagné sur l'autre ;
 *   4. à trois ou plus, la tournante en 5 points — son résultat est fourni
 *      par l'organisateur dans `departages`, sous la clé du groupe.
 * Un groupe que rien ne départage encore garde un rang partagé et figure
 * dans `aDepartager`.
 *
 * @param {IdJoueur[]} joueurs
 * @param {Match[]} matchs
 * @param {Record<string, IdJoueur[]>} [departages] ordre issu de la tournante
 */
export function classerPoule(joueurs, matchs, departages = {}) {
  const membres = new Set(joueurs);
  /** @type {Map<IdJoueur, Omit<LignePoule, 'rang' | 'exAequo'>>} */
  const stats = new Map(joueurs.map((id) => [id, {
    id, points: 0, victoires: 0, defaites: 0, joues: 0, setsPour: 0, setsContre: 0,
  }]));

  // Un match compte une seule fois, même s'il a été saisi deux fois.
  const vus = new Set();
  /** @type {Match[]} */
  const retenus = [];
  for (const m of matchs) {
    if (!membres.has(m.a) || !membres.has(m.b) || m.a === m.b) continue;
    if (!issueValide(m.sa, m.sb)) continue;
    const cle = clePaire(m.a, m.b);
    if (vus.has(cle)) continue;
    vus.add(cle);
    retenus.push(m);
    const A = /** @type {NonNullable<ReturnType<typeof stats.get>>} */ (stats.get(m.a));
    const B = /** @type {NonNullable<ReturnType<typeof stats.get>>} */ (stats.get(m.b));
    const [pa, pb] = pointsDeMatch(m.sa, m.sb);
    A.points += pa; B.points += pb;
    A.joues += 1; B.joues += 1;
    A.setsPour += m.sa; A.setsContre += m.sb;
    B.setsPour += m.sb; B.setsContre += m.sa;
    if (m.sa > m.sb) { A.victoires += 1; B.defaites += 1; } else { B.victoires += 1; A.defaites += 1; }
  }

  const tries = [...stats.values()]
    .sort((x, y) => y.points - x.points || y.victoires - x.victoires);

  /** @type {(typeof tries)[]} */
  const groupes = [];
  for (const s of tries) {
    const g = groupes[groupes.length - 1];
    if (g && g[0].points === s.points && g[0].victoires === s.victoires) g.push(s);
    else groupes.push([s]);
  }

  /** @type {LignePoule[]} */
  const lignes = [];
  /** @type {{ cle: string, joueurs: IdJoueur[], motif: 'duel' | 'tournante' }[]} */
  const aDepartager = [];
  let rang = 1;
  for (const g of groupes) {
    if (g.length === 1) {
      lignes.push({ ...g[0], rang, exAequo: false });
    } else if (g.length === 2 && trouverMatch(retenus, g[0].id, g[1].id)) {
      const duel = /** @type {Match} */ (trouverMatch(retenus, g[0].id, g[1].id));
      const [premier, second] = vainqueur(duel) === g[0].id ? [g[0], g[1]] : [g[1], g[0]];
      lignes.push({ ...premier, rang, exAequo: false, departage: 'duel' });
      lignes.push({ ...second, rang: rang + 1, exAequo: false, departage: 'duel' });
    } else {
      const ids = g.map((s) => s.id);
      const cle = cleGroupe(ids);
      const ordre = departages[cle];
      if (Array.isArray(ordre) && memesElements(ordre, ids)) {
        ordre.forEach((id, i) => {
          const s = /** @type {NonNullable<ReturnType<typeof stats.get>>} */ (stats.get(id));
          lignes.push({ ...s, rang: rang + i, exAequo: false, departage: 'tournante' });
        });
      } else {
        aDepartager.push({ cle, joueurs: ids, motif: g.length === 2 ? 'duel' : 'tournante' });
        for (const s of g) lignes.push({ ...s, rang, exAequo: true });
      }
    }
    rang += g.length;
  }

  const attendus = (joueurs.length * (joueurs.length - 1)) / 2;
  return {
    lignes,
    aDepartager,
    matchsJoues: retenus.length,
    matchsAttendus: attendus,
    /** Tous les matchs sont joués. */
    terminee: retenus.length === attendus,
    /** Terminée, et chaque place est attribuée. */
    complete: retenus.length === attendus && aDepartager.length === 0,
  };
}

/** @param {IdJoueur[]} p @param {IdJoueur[]} q */
function memesElements(p, q) {
  if (p.length !== q.length || new Set(p).size !== p.length) return false;
  const s = new Set(q);
  return p.every((x) => s.has(x));
}

// ---------------------------------------------------------------------------
// Tableau final et classement de la soirée
// ---------------------------------------------------------------------------

/**
 * Faut-il jouer le tableau final ? Seulement avec deux poules et au plus
 * 17 joueurs, comme le dit la feuille. L'organisateur peut passer outre.
 * @param {number} nbPoules @param {number} nbJoueurs
 */
export function tableauFinalPrevu(nbPoules, nbJoueurs) {
  return nbPoules === 2 && nbJoueurs <= SEUIL_TABLEAU_FINAL;
}

/**
 * Rencontres du tableau final : 1er de A contre 1er de B pour les places 1 et 2,
 * les 2es pour les places 3 et 4, etc. Si une poule a un joueur de plus, il
 * prend seul la place suivante.
 * @param {IdJoueur[]} ordreA classement de la poule A
 * @param {IdJoueur[]} ordreB classement de la poule B
 * @returns {{ niveau: number, a: IdJoueur | null, b: IdJoueur | null, places: number[] }[]}
 */
export function rencontresTableauFinal(ordreA, ordreB) {
  const niveaux = Math.max(ordreA.length, ordreB.length);
  const liste = [];
  let prochaine = 1;
  for (let k = 0; k < niveaux; k++) {
    const a = ordreA[k] ?? null;
    const b = ordreB[k] ?? null;
    const places = a !== null && b !== null ? [prochaine, prochaine + 1] : [prochaine];
    prochaine += places.length;
    liste.push({ niveau: k + 1, a, b, places });
  }
  return liste;
}

/**
 * Places de la soirée à partir du tableau final.
 * `vainqueurs[niveau]` donne l'identifiant du gagnant de chaque rencontre
 * à deux joueurs. Rend `null` tant qu'une rencontre n'a pas de vainqueur.
 * @param {ReturnType<typeof rencontresTableauFinal>} rencontres
 * @param {Record<number, IdJoueur>} vainqueurs
 * @returns {{ id: IdJoueur, place: number }[] | null}
 */
export function placesDepuisTableauFinal(rencontres, vainqueurs) {
  /** @type {{ id: IdJoueur, place: number }[]} */
  const places = [];
  for (const r of rencontres) {
    if (r.a !== null && r.b !== null) {
      const v = vainqueurs[r.niveau];
      if (v !== r.a && v !== r.b) return null;
      const perdant = v === r.a ? r.b : r.a;
      places.push({ id: v, place: r.places[0] }, { id: perdant, place: r.places[1] });
    } else {
      const seul = /** @type {IdJoueur} */ (r.a ?? r.b);
      places.push({ id: seul, place: r.places[0] });
    }
  }
  return places;
}

/**
 * Points de la soirée à partir de places 1..N (format « classement »,
 * tableau final, poule unique).
 * @param {{ id: IdJoueur, place: number }[]} places
 * @returns {{ id: IdJoueur, place: number, points: number }[]}
 */
export function pointsDepuisPlaces(places) {
  const n = places.length;
  const vues = new Set(places.map((p) => p.place));
  if (vues.size !== n || places.some((p) => p.place < 1 || p.place > n)) {
    throw new RangeError('les places doivent aller de 1 à N, sans doublon');
  }
  return [...places]
    .sort((p, q) => p.place - q.place)
    .map((p) => ({ ...p, points: pointsSelonPlace(p.place, n) }));
}

/**
 * Points quand le tableau final n'est pas joué : barème de la feuille selon
 * le rang dans la poule. Pas de place unique ce soir-là.
 * @param {LignePoule[][]} classementsDePoules
 * @param {number} [depart]
 * @returns {{ id: IdJoueur, place: null, points: number }[]}
 */
export function pointsSansTableauFinal(classementsDePoules, depart = DEPART_BAREME_POULE) {
  return classementsDePoules
    .flatMap((lignes) => lignes.map((l) => ({ id: l.id, place: null, points: pointsSelonRangDePoule(l.rang, depart) })))
    .sort((p, q) => q.points - p.points);
}

// ---------------------------------------------------------------------------
// Championnat
// ---------------------------------------------------------------------------

/**
 * Rang « sportif » : les ex æquo partagent le rang et le suivant saute
 * (1, 2, 2, 4), comme la fonction RANG du tableur de David.
 * @template {{ total: number }} T
 * @param {T[]} lignes
 * @returns {(T & { rang: number, exAequo: boolean })[]}
 */
export function rangsSportifs(lignes) {
  const tries = [...lignes].sort((p, q) => q.total - p.total);
  return tries.map((l) => {
    const rang = 1 + tries.filter((x) => x.total > l.total).length;
    const exAequo = tries.filter((x) => x.total === l.total).length > 1;
    return { ...l, rang, exAequo };
  });
}
