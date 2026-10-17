// @ts-check
/**
 * La feuille de poules du 16 septembre 2026, recopiée case par case.
 *
 * Les joueurs sont désignés par leur case (A1…A7, B12…B18) et non par leur
 * nom : ce fichier part dans les contrôles, pas les prénoms du club.
 *
 * LECTURE DE LA FEUILLE — vérifiée sur les totaux
 *   La case (ligne L, colonne C) donne les points marqués par le joueur de
 *   la COLONNE contre celui de la ligne. Les « TOTAUX » se lisent donc en
 *   colonne : 8, 10, 10, 8, 8, 3, 0 pour la poule A ; 8, 4, 8, 1, 7, 4, 12
 *   pour la poule B. Les deux contrôles ci-dessous le revérifient.
 */

/** Poule A, dans l'ordre des lignes et des colonnes de la feuille. */
export const POULE_A = [1, 2, 3, 4, 5, 6, 7];
/** Poule B, cases 12 à 18. */
export const POULE_B = [12, 13, 14, 15, 16, 17, 18];

/** null sur la diagonale grisée. */
export const GRILLE_A = [
  [null, 2, 1, 0, 2, 0, 0],
  [0, null, 1, 2, 1, 1, 0],
  [2, 2, null, 0, 0, 0, 0],
  [2, 0, 2, null, 1, 0, 0],
  [0, 2, 2, 2, null, 0, 0],
  [2, 2, 2, 2, 2, null, 0],
  [2, 2, 2, 2, 2, 2, null],
];

export const GRILLE_B = [
  [null, 0, 2, 0, 0, 0, 2],
  [2, null, 2, 1, 2, 0, 2],
  [0, 0, null, 0, 2, 0, 2],
  [2, 2, 2, null, 2, 2, 2],
  [2, 0, 0, 0, null, 2, 2],
  [2, 2, 2, 0, 1, null, 2],
  [0, 0, 0, 0, 0, 0, null],
];

/** Totaux écrits en bas de la feuille. */
export const TOTAUX_A = [8, 10, 10, 8, 8, 3, 0];
export const TOTAUX_B = [8, 4, 8, 1, 7, 4, 12];

/**
 * Le tableau final, tel qu'il ressort du « Classement de la soirée » :
 * vainqueur de chaque niveau (1er de A contre 1er de B, etc.).
 */
export const VAINQUEURS_TABLEAU = { 1: 18, 2: 14, 3: 12, 4: 16, 5: 5, 6: 17, 7: 15 };

/** Points reportés dans l'onglet SAISIE, colonne du 16 septembre. */
export const POINTS_SAISIE = {
  18: 14, 2: 13, 14: 12, 3: 11, 12: 10, 1: 9, 16: 8,
  4: 7, 5: 6, 13: 5, 17: 4, 6: 3, 15: 2, 7: 1,
};

/**
 * Transforme une grille de la feuille en matchs { a, b, sa, sb }.
 * @param {number[]} joueurs
 * @param {(number | null)[][]} grille
 */
export function matchsDepuisGrille(joueurs, grille) {
  /** @type {{ a: number, b: number, sa: number, sb: number }[]} */
  const matchs = [];
  for (let l = 0; l < joueurs.length; l++) {
    for (let c = l + 1; c < joueurs.length; c++) {
      const pointsColonne = grille[l][c]; // joueur c contre joueur l
      const pointsLigne = grille[c][l];   // joueur l contre joueur c
      if (pointsColonne === null || pointsLigne === null) throw new Error('case vide');
      let sa;
      let sb;
      if (pointsLigne === 2 && pointsColonne < 2) { sa = 2; sb = pointsColonne; }
      else if (pointsColonne === 2 && pointsLigne < 2) { sa = pointsLigne; sb = 2; }
      else throw new Error(`cases incohérentes entre ${joueurs[l]} et ${joueurs[c]}`);
      matchs.push({ a: joueurs[l], b: joueurs[c], sa, sb });
    }
  }
  return matchs;
}
