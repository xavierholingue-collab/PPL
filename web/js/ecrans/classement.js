// @ts-check
/**
 * Le classement du championnat : semestre 1, semestre 2, saison.
 * Ouvert à tous ; c'est l'écran que les joueurs regardent.
 */
import { chargerClassement, chargerCalendrier, etat } from '../api.js';
import { h, remplir, marqueur, ordinal, pluriel, alpha, dateLongue, jourMois, aujourdhui, annoncer } from '../ui.js';

/** @typedef {'s1' | 's2' | 'annee'} Periode */

const NOMS_PERIODES = /** @type {const} */ ({ s1: 'Semestre 1', s2: 'Semestre 2', annee: 'Saison' });

/** Période choisie, gardée le temps de la visite. @type {Periode | null} */
let periodeChoisie = null;

/**
 * Par défaut : le semestre de la dernière soirée saisie, sinon celui du jour.
 * @param {{ derniereSoiree: string | null }} c
 * @param {{ soirees: any[] }} cal
 * @returns {Periode}
 */
function periodeParDefaut(c, cal) {
  const ref = c.derniereSoiree ?? aujourdhui();
  const s = cal.soirees.find((x) => x.date === ref);
  if (s) return s.semestre === 2 ? 's2' : 's1';
  return Number(ref.slice(5, 7)) >= 8 ? 's1' : 's2';
}

/**
 * La soirée à saisir, pour l'organisateur : celle du jour si elle compte,
 * sinon la dernière soirée passée qui compte et n'a pas de points.
 * @param {any[]} soirees
 */
export function soireeASaisir(soirees) {
  const jour = aujourdhui();
  const duJour = soirees.find((s) => s.date === jour && s.compte);
  if (duJour) return duJour;
  return [...soirees].reverse().find((s) => s.date < jour && s.compte && s.nb_joueurs === 0) ?? null;
}

/** @param {HTMLElement} vue */
export async function ecranClassement(vue) {
  const [c, cal] = await Promise.all([chargerClassement(), chargerCalendrier()]);
  const semestreDe = new Map(cal.soirees.map((s) => [s.date, s.semestre]));
  periodeChoisie ??= periodeParDefaut(c, cal);

  const corps = h('div', { class: 'section' });
  const segments = h('div', { class: 'segments', role: 'group', 'aria-label': 'Période' });
  for (const p of /** @type {Periode[]} */ (['s1', 's2', 'annee'])) {
    segments.appendChild(h('button', {
      type: 'button',
      'aria-pressed': String(p === periodeChoisie),
      onclick: () => {
        periodeChoisie = p;
        for (const b of segments.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === NOMS_PERIODES[p]));
        dessiner();
      },
    }, NOMS_PERIODES[p]));
  }

  function dessiner() {
    const periode = /** @type {Periode} */ (periodeChoisie);
    const classes = c.joueurs
      .filter((j) => j[periode].rang !== null && j[periode].soirees > 0)
      .sort((a, b) => a[periode].rang - b[periode].rang || alpha(a.nom, b.nom));
    const nbSoirees = new Set(classes.flatMap((j) => j.detail
      .filter((/** @type {any} */ d) => periode === 'annee' || semestreDe.get(d.date) === (periode === 's1' ? 1 : 2))
      .map((/** @type {any} */ d) => d.date))).size;

    if (classes.length === 0) {
      const debut = cal.soirees.find((s) => (periode === 's2' ? s.semestre === 2 : true) && s.compte);
      remplir(corps, h('div', { class: 'vide' },
        h('strong', null, 'Pas encore de points sur cette période.'),
        debut ? `Le classement s’affichera après la soirée du ${dateLongue(debut.date)}.` : 'Le classement s’affichera après la première soirée.'));
      return;
    }

    // Dans la page, l'ordre reste 1er, 2e, 3e (c'est ce que lit un lecteur
    // d'écran) ; la feuille de style place le premier au centre.
    const podium = h('div', { class: 'podium', role: 'list', 'aria-label': 'Les trois premiers' });
    const CASES = ['premier', 'deuxieme', 'troisieme'];
    classes.slice(0, 3).forEach((j, i) => {
      const p = j[periode];
      podium.appendChild(h('div', { class: `podium-place ${CASES[i]}`, role: 'listitem' },
        h('span', { class: 'podium-rang' }, p.exAequo ? `${ordinal(p.rang)} ex æquo` : ordinal(p.rang)),
        marqueur(p.total, { retourner: true, libelle: `${p.total} points` }),
        h('span', { class: 'podium-nom' }, j.nom),
        h('span', { class: 'podium-socle', 'aria-hidden': 'true' })));
    });

    const liste = h('ol', { class: 'classement', 'aria-label': `Classement, ${NOMS_PERIODES[periode].toLowerCase()}` });
    for (const j of classes) liste.appendChild(ligne(j, periode, semestreDe));

    remplir(corps,
      h('p', { class: 'resume' },
        `${NOMS_PERIODES[periode]}, après ${pluriel(nbSoirees, 'soirée')}. ${pluriel(classes.length, 'joueur classé', 'joueurs classés')}.`),
      podium,
      liste);
  }

  const organisateur = etat.session?.organisateur;
  const aSaisir = organisateur ? soireeASaisir(cal.soirees) : null;

  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, 'Classement'),
      c.derniereSoiree ? h('p', { class: 'sous-titre' }, `Mis à jour après la soirée du ${dateLongue(c.derniereSoiree)}.`) : null),
    aSaisir ? h('div', { class: 'carte carte-table' },
      h('h2', null, aSaisir.date === aujourdhui() ? 'Ce soir' : 'Soirée à saisir'),
      h('p', null, `${dateLongue(aSaisir.date)}${aSaisir.libelle ? `, ${aSaisir.libelle}` : ''}. Les points ne sont pas encore saisis.`),
      h('a', { class: 'bouton', href: `#/saisie/${aSaisir.date}` }, 'Saisir les points')) : null,
    segments,
    corps,
    h('div', { class: 'liens-export' },
      boutonPartager(c.saison),
      h('a', { class: 'bouton-second', href: '/api/export.ods', download: '' }, 'Télécharger pour LibreOffice'),
      h('a', { class: 'bouton-texte', href: '/api/export.csv', download: '' }, 'au format CSV')));
  dessiner();
}

/**
 * Partager le lien du classement (messagerie du club, courriel…) : la
 * feuille de partage du téléphone quand elle existe, sinon une copie.
 * @param {string} saison
 */
function boutonPartager(saison) {
  const adresse = `${location.origin}/#/classement`;
  return h('button', {
    type: 'button', class: 'bouton',
    onclick: async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Ping Pong Loisir', text: `Le classement ${saison} du championnat`, url: adresse });
        } catch { /* partage annulé par l'utilisateur */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(adresse);
        annoncer('Lien du classement copié');
      } catch {
        annoncer(`Le lien à partager : ${adresse}`, { duree: 8000 });
      }
    },
  }, 'Partager le classement');
}

/**
 * @param {any} j
 * @param {Periode} periode
 * @param {Map<string, number>} semestreDe
 */
function ligne(j, periode, semestreDe) {
  const p = j[periode];
  const detail = j.detail.filter((/** @type {any} */ d) => periode === 'annee' || semestreDe.get(d.date) === (periode === 's1' ? 1 : 2));
  const idDetail = `detail-${periode}-${j.id}`;
  const panneau = h('div', { class: 'detail-joueur', id: idDetail, hidden: true },
    h('ul', { class: 'pastilles', 'aria-label': 'Points par soirée' },
      detail.map((/** @type {any} */ d) => h('li', { class: 'pastille' }, jourMois(d.date), h('b', null, d.points)))),
    periode === 'annee' ? h('p', { class: 'aide' }, `Semestre 1 : ${j.s1.total} pts. Semestre 2 : ${j.s2.total} pts.`) : null,
    h('a', { href: `#/joueur/${j.id}` }, `Toute la saison de ${j.nom}`));
  const bouton = h('button', {
    type: 'button',
    class: 'ligne-joueur',
    'aria-expanded': 'false',
    'aria-controls': idDetail,
    onclick: () => {
      const ouvert = bouton.getAttribute('aria-expanded') === 'true';
      bouton.setAttribute('aria-expanded', String(!ouvert));
      panneau.hidden = ouvert;
    },
  },
  h('span', { class: 'ligne-rang' }, p.rang),
  h('span', { class: 'ligne-nom' },
    h('strong', null, j.nom),
    h('span', null, `${pluriel(p.soirees, 'soirée')}${p.exAequo ? ', ex æquo' : ''}`)),
  h('span', { class: 'ligne-points' }, p.total, h('small', null, 'pts')));
  return h('li', null, bouton, panneau);
}

