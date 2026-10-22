// @ts-check
/**
 * Le calendrier des soirées, et le détail d'une soirée.
 */
import { api, chargerCalendrier, chargerJoueurs, etat, oublier } from '../api.js';
import {
  h, remplir, icone, dateLongue, dateTitre, moisCourt, aujourdhui, pluriel,
  ordinal, annoncer, boutonConfirme, rafraichir,
} from '../ui.js';
import { classerPoule, finaleDuTableau, rencontresDePoule, tableauFinalEnregistre, trouverMatch } from '../regles.js';

const NOMS_FORMATS = /** @type {Record<string, string>} */ ({
  poules: 'en poules', classement: 'classement de la soirée', libre: 'points saisis directement',
});

/**
 * Ce qu'on cherche d'un coup d'œil dans le calendrier : la soirée est-elle
 * saisie, à saisir, à venir ? C'est le titre de la ligne ; le nom de la
 * soirée (Beaujolais, AG…) vient en étiquette.
 * @param {any} s @param {string} jour
 */
function etatSoiree(s, jour) {
  if (s.nb_joueurs > 0) return { titre: pluriel(s.nb_joueurs, 'joueur'), detail: NOMS_FORMATS[s.format] ?? s.format, classe: '' };
  if (!s.compte) return { titre: s.libelle ?? 'Sans points', detail: 'Ne compte pas au championnat', classe: 'sans-points' };
  if (s.date === jour) return { titre: 'Ce soir', detail: 'Points à saisir en fin de soirée', classe: 'a-saisir' };
  if (s.date < jour) return { titre: 'Pas encore saisie', detail: 'Points à saisir', classe: 'a-saisir' };
  return { titre: 'À venir', detail: '', classe: '' };
}

/** @param {any} s @param {string} jour */
function ligneSoiree(s, jour) {
  const e = etatSoiree(s, jour);
  const etiquette = s.libelle && e.titre !== s.libelle ? h('span', { class: 'etiquette' }, s.libelle) : null;
  return h('li', null,
    h('a', { class: 'ligne-soiree', href: `#/soiree/${s.date}` },
      h('span', { class: 'date-bloc' }, h('b', null, Number(s.date.slice(8, 10))), h('span', null, moisCourt(s.date))),
      h('span', { class: 'ligne-soiree-texte' },
        h('span', { class: 'sr' }, `${dateLongue(s.date)} : `),
        h('strong', null, e.titre, etiquette ? ' ' : null, etiquette),
        e.detail ? h('span', { class: `etat-soiree ${e.classe}` }, e.detail) : null),
      icone('chevron')));
}

/** @param {HTMLElement} vue */
export async function ecranSoirees(vue) {
  const cal = await chargerCalendrier();
  const jour = aujourdhui();
  const organisateur = etat.session?.organisateur;
  const prochaine = cal.soirees.find((s) => s.date >= jour);

  /** @type {Node[]} */
  const sections = [];
  for (const semestre of [1, 2]) {
    const liste = cal.soirees.filter((s) => s.semestre === semestre);
    if (liste.length === 0) continue;
    sections.push(h('section', { class: 'section', 'aria-labelledby': `sem-${semestre}` },
      h('h2', { id: `sem-${semestre}` }, `Semestre ${semestre}`),
      h('ol', { class: 'calendrier' }, liste.map((s) => ligneSoiree(s, jour)))));
  }

  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, 'Soirées'),
      h('p', { class: 'sous-titre' }, `Saison ${cal.saison}, ${pluriel(cal.soirees.length, 'mercredi')} au calendrier.`)),
    prochaine ? h('div', { class: 'carte carte-table' },
      h('h2', null, prochaine.date === jour ? 'Ce soir' : 'Prochaine soirée'),
      h('p', null, dateTitre(prochaine.date), prochaine.libelle ? h('span', null, ' ', h('span', { class: 'etiquette' }, prochaine.libelle)) : null),
      organisateur && prochaine.compte
        ? h('a', { class: 'bouton', href: `#/saisie/${prochaine.date}` }, prochaine.nb_joueurs > 0 ? 'Modifier les points' : 'Saisir les points')
        : h('p', { class: 'aide' }, prochaine.compte ? 'Les points seront saisis en fin de soirée.' : 'Cette soirée ne compte pas pour le championnat.')) : null,
    ...sections);
}

/** @param {HTMLElement} vue @param {string[]} params */
export async function ecranSoiree(vue, [date]) {
  const organisateur = etat.session?.organisateur;
  let soiree;
  try {
    soiree = await api(`/soirees/${date}`);
  } catch (e) {
    if (/** @type {any} */ (e).statut !== 404) throw e;
    remplir(vue,
      h('div', { class: 'titre-page' }, h('h1', null, dateTitre(date))),
      h('div', { class: 'vide' }, h('strong', null, 'Pas de soirée prévue ce jour-là.'),
        organisateur ? h('a', { class: 'bouton', href: `#/saisie/${date}` }, 'Saisir quand même une soirée') : null));
    return;
  }
  const joueurs = await chargerJoueurs();
  const nomDe = new Map(joueurs.map((j) => [j.id, j.nom]));
  /** @param {number} id */
  const nom = (id) => nomDe.get(id) ?? `joueur ${id}`;

  const jour = aujourdhui();
  /** @type {Node[]} */
  const blocs = [];

  if (!soiree.compte) blocs.push(h('p', { class: 'aide' }, 'Cette soirée ne compte pas pour le championnat.'));

  if (soiree.resultats.length === 0) {
    blocs.push(h('div', { class: 'vide' },
      h('strong', null, date > jour ? 'Soirée à venir.' : 'Pas encore de points pour cette soirée.'),
      organisateur && soiree.compte ? h('a', { class: 'bouton', href: `#/saisie/${date}` }, 'Saisir les points') : null));
  } else {
    blocs.push(h('section', { class: 'section', 'aria-labelledby': 'titre-points' },
      h('h2', { id: 'titre-points' }, 'Points de la soirée'),
      h('table', { class: 'tableau' },
        h('thead', null, h('tr', null, h('th', { class: 'rang', scope: 'col' }, 'Place'), h('th', { scope: 'col' }, 'Joueur'), h('th', { class: 'nombre', scope: 'col' }, 'Points'))),
        h('tbody', null, soiree.resultats.map((/** @type {any} */ r) => h('tr', null,
          h('td', { class: 'rang' }, r.place ? ordinal(r.place) : ''),
          h('td', null, h('a', { href: `#/joueur/${r.joueur_id}` }, r.nom)),
          h('td', { class: 'nombre' }, r.points)))))));
  }

  if (soiree.etat?.mode === 'poules' && Array.isArray(soiree.etat.poules)) {
    blocs.push(sectionPoules(soiree.etat, nom));
  }

  if (organisateur) {
    blocs.push(h('div', { class: 'actions' },
      soiree.resultats.length > 0 ? h('a', { class: 'bouton-second', href: `#/saisie/${date}/verification` }, 'Corriger des points') : null,
      soiree.resultats.length > 0 ? h('a', { class: 'bouton-second', href: `#/saisie/${date}` }, 'Modifier la saisie') : null,
      soiree.resultats.length > 0 ? boutonConfirme('Effacer les points', 'Confirmer l’effacement', async () => {
        try {
          await api(`/soirees/${date}/resultats`, { methode: 'DELETE' });
          oublier();
          annoncer('Points effacés');
          rafraichir();
        } catch (e) {
          annoncer(/** @type {Error} */ (e).message, { erreur: true });
        }
      }) : null));
  }

  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, dateTitre(date)),
      soiree.libelle ? h('p', null, h('span', { class: 'etiquette' }, soiree.libelle)) : null),
    ...blocs,
    h('p', null, h('a', { href: '#/soirees' }, 'Toutes les soirées')));
}

/**
 * Les poules telles qu'elles ont été jouées, présentées comme la feuille :
 * la case (ligne, colonne) donne les points du joueur de la colonne contre
 * celui de la ligne, et les totaux se lisent en bas.
 * @param {any} e état de l'assistant
 * @param {(id: number) => string} nom
 */
function sectionPoules(e, nom) {
  const poules = /** @type {number[][]} */ (e.poules);
  const matchs = e.matchs ?? [];
  const lettres = 'ABCDEF';
  const blocs = poules.map((joueurs, i) => {
    const r = classerPoule(joueurs, matchs, e.departages ?? {});
    /** @param {number} ligne @param {number} colonne */
    const points = (ligne, colonne) => {
      const m = matchs.find((/** @type {any} */ x) => (x.a === ligne && x.b === colonne) || (x.a === colonne && x.b === ligne));
      if (!m) return '';
      const [sa, sb] = m.a === colonne ? [m.sa, m.sb] : [m.sb, m.sa];
      return sa > sb ? 2 : sa;
    };
    const rangDe = new Map(r.lignes.map((l) => [l.id, l]));
    return h('div', { class: 'section' },
      h('h3', null, `Poule ${lettres[i]}`),
      // Défilable au clavier aussi : la grille déborde sur un téléphone.
      h('div', { class: 'defile', tabindex: '0', role: 'region', 'aria-label': `Grille de la poule ${lettres[i]}` },
        h('table', { class: 'feuille' },
          h('caption', { class: 'sr' }, `Poule ${lettres[i]} : chaque colonne donne les points du joueur contre celui de la ligne`),
          h('thead', null, h('tr', null, h('td'), joueurs.map((c) => h('th', { scope: 'col' }, nom(c))))),
          h('tbody', null,
            joueurs.map((l) => h('tr', null,
              h('th', { scope: 'row' }, nom(l)),
              joueurs.map((c) => (c === l ? h('td', { class: 'diagonale', 'aria-label': '—' }) : h('td', null, points(l, c)))))),
            h('tr', { class: 'total' }, h('th', { scope: 'row' }, 'Totaux'), joueurs.map((c) => h('td', null, rangDe.get(c)?.points ?? ''))),
            h('tr', { class: 'total' }, h('th', { scope: 'row' }, 'Classement'), joueurs.map((c) => h('td', null, rangDe.get(c)?.rang ?? '')))))));
  });

  /** @type {Node | null} */
  let tableau = null;
  const presents = Array.isArray(e.presents) ? e.presents.length : poules.flat().length;
  if (poules.length === 2 && tableauFinalEnregistre(e.tableauFinal, presents)) {
    const ordres = poules.map((j) => classerPoule(j, matchs, e.departages ?? {}).lignes.map((l) => l.id));
    const finale = finaleDuTableau(ordres[0], ordres[1]);
    const pf = finale.pouleFinale;
    /** @type {Node | null} */
    let pouleDeTrois = null;
    if (pf) {
      const mf = Array.isArray(e.finale?.matchs) ? e.finale.matchs : [];
      const c = classerPoule(pf.joueurs, mf, e.finale?.departages ?? {});
      pouleDeTrois = h('div', null,
        h('h4', null, `Poule de trois, places ${pf.places[0]} à ${pf.places[2]}`),
        h('ul', { class: 'liste-simple' },
          rencontresDePoule(pf.joueurs).map((r) => {
            const m = trouverMatch(mf, r.a, r.b);
            const [sa, sb] = !m ? [null, null] : m.a === r.a ? [m.sa, m.sb] : [m.sb, m.sa];
            return h('li', null, h('div', { class: 'rangee' },
              h('span', null, `${nom(r.a)} contre ${nom(r.b)}`),
              h('span', { class: 'chiffres' }, sa === null ? '' : `${sa}-${sb}`)));
          })),
        c.complete ? h('ul', { class: 'liste-simple' }, c.lignes.map((l, i) => h('li', null, h('div', { class: 'rangee' },
          h('span', null, nom(l.id)), h('span', { class: 'chiffres' }, `place ${pf.places[i]}`))))) : null);
    }
    tableau = h('div', { class: 'section' },
      h('h3', null, 'Tableau final'),
      h('ul', { class: 'liste-simple' }, finale.rencontres.map((rc) => {
        const v = e.vainqueurs?.[rc.niveau];
        const texte = rc.a !== null && rc.b !== null
          ? (v ? `${nom(v)} bat ${nom(v === rc.a ? rc.b : rc.a)}` : `${nom(rc.a)} contre ${nom(rc.b)}`)
          : `${nom(/** @type {number} */ (rc.a ?? rc.b))}, seul à ce niveau`;
        return h('li', null, h('div', { class: 'rangee' },
          h('span', null, texte),
          h('span', { class: 'chiffres' }, rc.places.length === 2 ? `places ${rc.places[0]} et ${rc.places[1]}` : `place ${rc.places[0]}`)));
      })),
      pouleDeTrois);
  }

  return h('section', { class: 'section', 'aria-labelledby': 'titre-poules' },
    h('h2', { id: 'titre-poules' }, 'Les poules'),
    h('p', { class: 'aide' }, 'Comme sur la feuille : chaque colonne donne les points du joueur contre celui de la ligne.'),
    ...blocs,
    tableau);
}
