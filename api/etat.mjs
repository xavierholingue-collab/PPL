// @ts-check
/**
 * L'état d'un assistant de saisie (poules, classement…) cite les joueurs par
 * leur identifiant, à bien des endroits : présents, blessés, ordre d'arrivée, poules,
 * matchs, départages, vainqueurs du tableau final, poule de trois, points
 * corrigés. Les renuméroter se fait ICI et nulle part ailleurs : l'amorce
 * (identifiants du tableur → identifiants de la base) et la fusion de deux
 * joueurs (le même joueur inscrit deux fois) passent par la même fonction.
 */
import { validerEtat } from './validation.mjs';

/** @param {number[]} ordre @param {(id: number) => number} n */
const departage = (ordre, n) => {
  const ordreN = ordre.map(n);
  return /** @type {[string, number[]]} */ ([[...ordreN].sort((a, b) => a - b).join('-'), ordreN]);
};

/**
 * @param {any} etat
 * @param {(id: number) => number} n nouvel identifiant d'un joueur (peut lever une erreur)
 * @returns {{ ok: true, valeur: any } | { ok: false, erreur: string }}
 *   l'état renuméroté, revalidé comme une saisie (un même joueur deux fois,
 *   par exemple, le rend invalide)
 */
export function renumeroterEtat(etat, n) {
  if (!etat) return { ok: true, valeur: null };
  const copie = { ...etat };
  if (etat.presents) copie.presents = etat.presents.map(n);
  if (etat.ordre) copie.ordre = etat.ordre.map(n);
  if (etat.blesses) copie.blesses = etat.blesses.map(n);
  if (etat.abandons) copie.abandons = etat.abandons.map(n);
  if (etat.poules) copie.poules = etat.poules.map((/** @type {number[]} */ p) => p.map(n));
  if (etat.matchs) copie.matchs = etat.matchs.map((/** @type {any} */ m) => ({ ...m, a: n(m.a), b: n(m.b) }));
  if (etat.vainqueurs) copie.vainqueurs = Object.fromEntries(Object.entries(etat.vainqueurs).map(([k, v]) => [k, n(Number(v))]));
  if (etat.departages) {
    copie.departages = Object.fromEntries(Object.values(etat.departages).map((o) => departage(/** @type {number[]} */ (o), n)));
  }
  if (etat.finale) {
    copie.finale = {
      matchs: (etat.finale.matchs ?? []).map((/** @type {any} */ m) => ({ ...m, a: n(m.a), b: n(m.b) })),
      departages: Object.fromEntries(Object.values(etat.finale.departages ?? {}).map((o) => departage(/** @type {number[]} */ (o), n))),
    };
  }
  if (etat.ajustements) {
    copie.ajustements = Object.fromEntries(Object.entries(etat.ajustements).map(([k, v]) => [String(n(Number(k))), v]));
  }
  return validerEtat(copie);
}
