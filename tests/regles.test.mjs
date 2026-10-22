// @ts-check
/**
 * Contrôles des règles de jeu (web/js/regles.js).
 *
 * Le contrôle principal rejoue la vraie feuille du 16 septembre : poules,
 * égalités, tableau final, et doit retrouver EXACTEMENT les points que David
 * a reportés dans son fichier. Si une règle est mal comprise, c'est ici que
 * ça se voit — pas sur un exemple inventé pour passer.
 *
 * Lancer : node --test tests/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pointsSelonPlace, pointsSelonRangDePoule, pointsDeMatch, issueValide,
  repartirEnSerpentin, rencontresDePoule, classerPoule, cleGroupe,
  rencontresTableauFinal, placesDepuisTableauFinal, pointsDepuisPlaces,
  pointsSansTableauFinal, tableauFinalPrevu, nbPoulesConseille, rangsSportifs,
  finaleDuTableau, placesDepuisFinale, tableauFinalEnregistre,
} from '../web/js/regles.js';
import {
  POULE_A, POULE_B, GRILLE_A, GRILLE_B, TOTAUX_A, TOTAUX_B,
  VAINQUEURS_TABLEAU, POINTS_SAISIE, matchsDepuisGrille,
} from './feuille-16-septembre.mjs';

// ---------------------------------------------------------------- la feuille

test('16/09 — les totaux de la feuille se retrouvent en colonne', () => {
  for (const [joueurs, grille, totaux] of /** @type {const} */ ([
    [POULE_A, GRILLE_A, TOTAUX_A], [POULE_B, GRILLE_B, TOTAUX_B],
  ])) {
    const { lignes } = classerPoule(joueurs, matchsDepuisGrille(joueurs, grille));
    joueurs.forEach((id, i) => {
      const l = lignes.find((x) => x.id === id);
      assert.equal(l?.points, totaux[i], `total du joueur ${id}`);
    });
  }
});

test('16/09 — classement de la poule A, avec un duel à 8 points', () => {
  const r = classerPoule(POULE_A, matchsDepuisGrille(POULE_A, GRILLE_A));
  assert.equal(r.complete, true);
  // Cases 2 et 3 à 10 points : la case 2 a 5 victoires, la case 3 en a 4.
  // Cases 1 et 4 à 8 points avec 4 victoires : la case 1 a gagné le duel.
  // Case 5 à 8 points avec 3 victoires seulement.
  assert.deepEqual(r.lignes.map((l) => l.id), [2, 3, 1, 4, 5, 6, 7]);
  assert.deepEqual(r.lignes.map((l) => l.rang), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(r.lignes[2].departage, 'duel');
});

test('16/09 — classement de la poule B, deux duels', () => {
  const r = classerPoule(POULE_B, matchsDepuisGrille(POULE_B, GRILLE_B));
  assert.equal(r.complete, true);
  // Case 14 devant case 12 : même total, mêmes victoires, duel gagné.
  // Case 13 devant case 17 : idem.
  assert.deepEqual(r.lignes.map((l) => l.id), [18, 14, 12, 16, 13, 17, 15]);
});

test('16/09 — tableau final et points : exactement la colonne du fichier', () => {
  const a = classerPoule(POULE_A, matchsDepuisGrille(POULE_A, GRILLE_A)).lignes.map((l) => l.id);
  const b = classerPoule(POULE_B, matchsDepuisGrille(POULE_B, GRILLE_B)).lignes.map((l) => l.id);
  assert.equal(tableauFinalPrevu(2), true);
  const rencontres = rencontresTableauFinal(a, b);
  assert.equal(rencontres.length, 7);
  const places = placesDepuisTableauFinal(rencontres, VAINQUEURS_TABLEAU);
  assert.ok(places);
  const points = pointsDepuisPlaces(places);
  const obtenu = Object.fromEntries(points.map((p) => [p.id, p.points]));
  assert.deepEqual(obtenu, Object.fromEntries(Object.entries(POINTS_SAISIE).map(([k, v]) => [Number(k), v])));
});

// ---------------------------------------------------------------- points

test('points selon la place : 14 joueurs, 14 au premier, 1 au dernier', () => {
  assert.equal(pointsSelonPlace(1, 14), 14);
  assert.equal(pointsSelonPlace(14, 14), 1);
  assert.throws(() => pointsSelonPlace(0, 14));
  assert.throws(() => pointsSelonPlace(15, 14));
});

test('barème sans tableau final : 12, 11, 10… jamais sous 1', () => {
  assert.equal(pointsSelonRangDePoule(1), 12);
  assert.equal(pointsSelonRangDePoule(3), 10);
  assert.equal(pointsSelonRangDePoule(20), 1);
});

test('points de match : 2 au gagnant, 1 au perdant qui a pris un set', () => {
  assert.deepEqual(pointsDeMatch(2, 0), [2, 0]);
  assert.deepEqual(pointsDeMatch(2, 1), [2, 1]);
  assert.deepEqual(pointsDeMatch(1, 2), [1, 2]);
  assert.deepEqual(pointsDeMatch(0, 2), [0, 2]);
  for (const [x, y] of [[2, 2], [1, 1], [3, 0], [0, 0], [2, -1]]) {
    assert.equal(issueValide(x, y), false, `${x}-${y}`);
    assert.throws(() => pointsDeMatch(x, y));
  }
});

// ---------------------------------------------------------------- poules

test('serpentin : A B B A A B…', () => {
  assert.deepEqual(repartirEnSerpentin([1, 2, 3, 4, 5, 6, 7], 2), [[1, 4, 5], [2, 3, 6, 7]]);
  assert.deepEqual(repartirEnSerpentin([1, 2, 3, 4, 5, 6], 3), [[1, 6], [2, 5], [3, 4]]);
});

test('rencontres : chacun joue une fois chaque adversaire, dans l’ordre de la feuille', () => {
  for (const n of [2, 3, 6, 7, 11]) {
    const joueurs = Array.from({ length: n }, (_, i) => 10 * (n - i)); // ordre de la feuille, pas des identifiants
    const liste = rencontresDePoule(joueurs);
    assert.equal(liste.length, (n * (n - 1)) / 2, `${n} joueurs`);
    const paires = new Set(liste.map((m) => [m.a, m.b].sort((p, q) => p - q).join('-')));
    assert.equal(paires.size, liste.length, 'pas de doublon');
    // Le joueur de la ligne est à gauche, et passe avant tous ses adversaires dans la feuille.
    for (const m of liste) assert.ok(joueurs.indexOf(m.a) < joueurs.indexOf(m.b));
  }
  // Poule de 6 : 5 matchs pour le 1er, 4 pour le 2e… 1 pour l'avant-dernier.
  const six = rencontresDePoule([1, 2, 3, 4, 5, 6]);
  assert.deepEqual([1, 2, 3, 4, 5].map((j) => six.filter((m) => m.a === j).length), [5, 4, 3, 2, 1]);
  assert.deepEqual(six.slice(0, 6).map((m) => `${m.a}-${m.b}`), ['1-2', '1-3', '1-4', '1-5', '1-6', '2-3']);
});

test('égalité à trois : tournante demandée, puis appliquée', () => {
  // 1 bat 2, 2 bat 3, 3 bat 1 : trois joueurs à 3 points, une victoire chacun.
  const joueurs = [1, 2, 3];
  const matchs = [
    { a: 1, b: 2, sa: 2, sb: 1 },
    { a: 2, b: 3, sa: 2, sb: 1 },
    { a: 3, b: 1, sa: 2, sb: 1 },
  ];
  const avant = classerPoule(joueurs, matchs);
  assert.equal(avant.terminee, true);
  assert.equal(avant.complete, false);
  assert.equal(avant.aDepartager.length, 1);
  assert.equal(avant.aDepartager[0].motif, 'tournante');
  assert.ok(avant.lignes.every((l) => l.rang === 1 && l.exAequo));

  const apres = classerPoule(joueurs, matchs, { [cleGroupe([3, 1, 2])]: [2, 3, 1] });
  assert.equal(apres.complete, true);
  assert.deepEqual(apres.lignes.map((l) => [l.id, l.rang]), [[2, 1], [3, 2], [1, 3]]);
});

test('un départage qui ne correspond plus au groupe est ignoré', () => {
  const joueurs = [1, 2, 3];
  const matchs = [
    { a: 1, b: 2, sa: 2, sb: 1 }, { a: 2, b: 3, sa: 2, sb: 1 }, { a: 3, b: 1, sa: 2, sb: 1 },
  ];
  const r = classerPoule(joueurs, matchs, { '1-2': [2, 1] });
  assert.equal(r.complete, false);
});

test('poule en cours : rien à départager tant que le duel n’est pas joué', () => {
  const r = classerPoule([1, 2, 3], [{ a: 1, b: 3, sa: 2, sb: 0 }, { a: 2, b: 3, sa: 2, sb: 0 }]);
  assert.equal(r.terminee, false);
  assert.equal(r.lignes[0].exAequo, true);
  assert.equal(r.matchsJoues, 2);
  assert.equal(r.matchsAttendus, 3);
});

test('un match saisi deux fois ne compte qu’une fois ; un match hors poule est ignoré', () => {
  const r = classerPoule([1, 2], [
    { a: 1, b: 2, sa: 2, sb: 0 }, { a: 2, b: 1, sa: 2, sb: 0 }, { a: 1, b: 9, sa: 2, sb: 0 },
  ]);
  assert.equal(r.matchsJoues, 1);
  assert.equal(r.lignes[0].id, 1);
  assert.equal(r.lignes[0].points, 2);
});

// ---------------------------------------------------------------- tableau final

test('tableau final avec une poule plus grande : le dernier prend seul la place suivante', () => {
  const r = rencontresTableauFinal([1, 2, 3, 4, 5, 6, 7, 8, 9], [11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual(r.map((x) => x.places), [
    [1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15], [16],
  ]);
  const vainqueurs = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  const places = placesDepuisTableauFinal(r, vainqueurs);
  assert.ok(places);
  assert.equal(places.length, 16);
  const pts = pointsDepuisPlaces(places);
  assert.equal(pts[0].points, 16);
  assert.equal(pts[15].points, 1);
});

test('tableau final incomplet : pas de places', () => {
  const r = rencontresTableauFinal([1, 2], [3, 4]);
  assert.equal(placesDepuisTableauFinal(r, { 1: 1 }), null);
  assert.equal(placesDepuisTableauFinal(r, { 1: 1, 2: 99 }), null);
});

test('tableau final : toujours avec deux poules (David, 18/10/2026), jamais sinon', () => {
  assert.equal(tableauFinalPrevu(2), true);
  assert.equal(tableauFinalPrevu(1), false);
  assert.equal(tableauFinalPrevu(3), false);
});

test('phase finale non jouée (choix de l’organisateur) : barème par rang de poule', () => {
  const a = classerPoule([1, 2], [{ a: 1, b: 2, sa: 2, sb: 0 }]).lignes;
  const b = classerPoule([3, 4], [{ a: 3, b: 4, sa: 0, sb: 2 }]).lignes;
  const pts = pointsSansTableauFinal([a, b]);
  assert.deepEqual(pts.map((p) => [p.id, p.points]).sort((p, q) => p[0] - q[0]), [[1, 12], [2, 11], [3, 11], [4, 12]]);
});

test('places en double refusées', () => {
  assert.throws(() => pointsDepuisPlaces([{ id: 1, place: 1 }, { id: 2, place: 1 }]));
  assert.throws(() => pointsDepuisPlaces([{ id: 1, place: 1 }, { id: 2, place: 3 }]));
});

test('nombre de poules conseillé', () => {
  assert.equal(nbPoulesConseille(6), 1);
  assert.equal(nbPoulesConseille(14), 2);
  assert.equal(nbPoulesConseille(22), 2);
  assert.equal(nbPoulesConseille(23), 3);
});

// ---------------------------------------------------------------- championnat

test('rang sportif : 58, 50, 50, 47 → 1, 2, 2, 4 (comme le tableur)', () => {
  const r = rangsSportifs([{ total: 50 }, { total: 47 }, { total: 58 }, { total: 50 }]);
  assert.deepEqual(r.map((x) => x.rang), [1, 2, 2, 4]);
  assert.deepEqual(r.map((x) => x.exAequo), [false, true, true, false]);
});

// ---------------------------------------------------------------- phase finale (David, 18/10/2026)

/** Les matchs d'une poule de trois, gagnés par l'ordre donné. @param {number[]} ordre */
const pouleDeTrois = (ordre) => {
  const [x, y, z] = ordre;
  return [{ a: x, b: y, sa: 2, sb: 0 }, { a: x, b: z, sa: 2, sb: 1 }, { a: y, b: z, sa: 2, sb: 1 }];
};

test('phase finale, nombre pair : seulement des rencontres, pas de poule de trois', () => {
  const f = finaleDuTableau([1, 2, 3, 4, 5, 6, 7], [11, 12, 13, 14, 15, 16, 17]);
  assert.equal(f.pouleFinale, null);
  assert.equal(f.rencontres.length, 7);
  assert.deepEqual(f.rencontres.at(-1)?.places, [13, 14]);
});

test('phase finale, nombre impair : les trois derniers jouent une poule de trois', () => {
  // 15 joueurs : poules de 8 et de 7.
  const A = [1, 2, 3, 4, 5, 6, 7, 8];
  const B = [11, 12, 13, 14, 15, 16, 17];
  const f = finaleDuTableau(A, B);
  assert.equal(f.rencontres.length, 6, '1ers à 6es entre eux');
  assert.deepEqual(f.rencontres.at(-1)?.places, [11, 12]);
  assert.deepEqual(f.pouleFinale, { joueurs: [7, 17, 8], places: [13, 14, 15] });

  const vainqueurs = { 1: 11, 2: 2, 3: 3, 4: 14, 5: 5, 6: 6 };
  assert.equal(placesDepuisFinale(f, vainqueurs, []), null, 'poule de trois pas encore jouée');
  const places = placesDepuisFinale(f, vainqueurs, pouleDeTrois([8, 7, 17]));
  assert.ok(places);
  const pts = pointsDepuisPlaces(places);
  assert.equal(pts.length, 15);
  assert.deepEqual(pts.slice(0, 2).map((p) => [p.id, p.points]), [[11, 15], [1, 14]]);
  assert.deepEqual(pts.slice(-3).map((p) => [p.id, p.place, p.points]), [[8, 13, 3], [7, 14, 2], [17, 15, 1]]);
});

test('poule de trois à égalité parfaite : la tournante départage, comme en poule', () => {
  const f = finaleDuTableau([1, 2], [3]);
  assert.equal(f.rencontres.length, 0);
  assert.deepEqual(f.pouleFinale, { joueurs: [1, 3, 2], places: [1, 2, 3] });
  // Chacun gagne un match 2-1 : mêmes points, mêmes victoires.
  const cycle = [{ a: 1, b: 3, sa: 2, sb: 1 }, { a: 3, b: 2, sa: 2, sb: 1 }, { a: 2, b: 1, sa: 2, sb: 1 }];
  assert.equal(placesDepuisFinale(f, {}, cycle), null, 'il faut l’ordre de la tournante');
  const places = placesDepuisFinale(f, {}, cycle, { '1-2-3': [2, 3, 1] });
  assert.deepEqual(places, [{ id: 2, place: 1 }, { id: 3, place: 2 }, { id: 1, place: 3 }]);
});

test('poules retouchées (9 et 7) : pas de poule de trois, les joueurs en trop suivent leur poule', () => {
  const f = finaleDuTableau([1, 2, 3, 4, 5, 6, 7, 8, 9], [11, 12, 13, 14, 15, 16, 17]);
  assert.equal(f.pouleFinale, null);
  assert.deepEqual(f.rencontres.slice(-2).map((r) => r.places), [[15], [16]]);
});

test('soirées enregistrées avant le 22/10/2026 : relues selon la règle d’alors', () => {
  // Le choix écrit prime toujours.
  assert.equal(tableauFinalEnregistre(true, 22), true);
  assert.equal(tableauFinalEnregistre(false, 12), false);
  // Absent : la règle d'alors, pas de tableau final au-delà de 17 joueurs.
  assert.equal(tableauFinalEnregistre(undefined, 17), true);
  assert.equal(tableauFinalEnregistre(undefined, 18), false);
  assert.equal(tableauFinalEnregistre(null, 14), true);
});
