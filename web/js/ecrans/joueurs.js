// @ts-check
/**
 * Les joueurs du club, et la saison de chacun.
 */
import { api, chargerJoueurs, chargerClassement, chargerCalendrier, etat, oublier } from '../api.js';
import { h, remplir, marqueur, ordinal, pluriel, alpha, jourMois, dateLongue, annoncer, rafraichir, icone } from '../ui.js';

/** @param {HTMLElement} vue */
export async function ecranJoueurs(vue) {
  const [joueurs, c] = await Promise.all([chargerJoueurs(), chargerClassement()]);
  const parId = new Map(c.joueurs.map((j) => [j.id, j]));
  const actifs = joueurs.filter((j) => j.actif).sort((x, y) => alpha(x.nom, y.nom));
  const archives = joueurs.filter((j) => !j.actif).sort((x, y) => alpha(x.nom, y.nom));
  const organisateur = etat.session?.organisateur;

  /** @param {any} j */
  const ligne = (j) => {
    const s = parId.get(j.id);
    return h('li', null, h('a', { href: `#/joueur/${j.id}`, class: j.actif ? '' : 'archive' },
      h('span', null, j.nom),
      h('span', { class: 'actions' },
        h('span', { class: 'chiffres' }, s ? `${s.annee.total} pts` : 'pas encore joué'),
        icone('chevron'))));
  };

  /** @type {Node | null} */
  let formulaire = null;
  if (organisateur) {
    const champ = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'nom-joueur', maxlength: '40', placeholder: 'Prénom et initiale', autocomplete: 'off' }));
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    formulaire = h('form', {
      class: 'carte',
      onsubmit: async (/** @type {SubmitEvent} */ ev) => {
        ev.preventDefault();
        erreur.textContent = '';
        try {
          const j = await api('/joueurs', { methode: 'POST', corps: { nom: champ.value } });
          oublier();
          annoncer(`${j.nom} ajouté`);
          rafraichir();
        } catch (e) {
          erreur.textContent = /** @type {Error} */ (e).message;
        }
      },
    },
    h('div', { class: 'champ' }, h('label', { for: 'nom-joueur' }, 'Ajouter un joueur'),
      h('div', { class: 'ligne-ajout' }, champ, h('button', { type: 'submit', class: 'bouton' }, 'Ajouter'))),
    h('p', { class: 'aide' }, 'Le prénom et l’initiale du nom suffisent : c’est ce qui s’affiche au classement.'),
    erreur);
  }

  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, 'Joueurs'),
      h('p', { class: 'sous-titre' }, `${pluriel(actifs.length, 'joueur')}, dont ${c.joueurs.length} avec des points cette saison.`)),
    formulaire,
    h('ul', { class: 'liste-simple', 'aria-label': 'Joueurs' }, actifs.map(ligne)),
    archives.length ? h('section', { class: 'section' },
      h('h2', null, 'Joueurs archivés'),
      h('ul', { class: 'liste-simple' }, archives.map(ligne))) : null);
}

/** @param {HTMLElement} vue @param {string[]} params */
export async function ecranJoueur(vue, [idTexte]) {
  const id = Number(idTexte);
  const [joueurs, c, cal] = await Promise.all([chargerJoueurs(), chargerClassement(), chargerCalendrier()]);
  const j = joueurs.find((x) => x.id === id);
  if (!j) {
    remplir(vue, h('h1', null, 'Joueur introuvable'), h('p', null, h('a', { href: '#/joueurs' }, 'Tous les joueurs')));
    return;
  }
  const s = c.joueurs.find((x) => x.id === id);
  const nbJoueurs = new Map(cal.soirees.map((x) => [x.date, x.nb_joueurs]));

  /** @param {{ total: number, rang: number | null, exAequo: boolean, soirees: number } | undefined} p @param {string} titre */
  const bloc = (p, titre) => h('div', null,
    marqueur(p?.total ?? 0, { libelle: `${p?.total ?? 0} points` }),
    h('strong', null, titre),
    h('span', { class: 'legende' }, p && p.rang ? `${ordinal(p.rang)}${p.exAequo ? ' ex æquo' : ''}, ${pluriel(p.soirees, 'soirée')}` : 'pas classé'));

  /** @type {Node[]} */
  const blocs = [
    h('div', { class: 'chiffres-joueur' }, bloc(s?.s1, 'Semestre 1'), bloc(s?.s2, 'Semestre 2'), bloc(s?.annee, 'Saison')),
  ];

  if (s && s.detail.length > 0) {
    blocs.push(h('section', { class: 'section', 'aria-labelledby': 'titre-soirees' },
      h('h2', { id: 'titre-soirees' }, 'Soirée par soirée'),
      h('p', { class: 'aide' }, 'La barre est pleine quand il gagne la soirée : les points suivent la place.'),
      h('ul', { class: 'barres' }, s.detail.map((/** @type {any} */ d) => {
        const n = nbJoueurs.get(d.date) || d.points || 1;
        const part = Math.max(4, Math.min(100, Math.round((100 * d.points) / n)));
        return h('li', { 'aria-label': `${dateLongue(d.date)} : ${pluriel(d.points, 'point')}${d.place ? `, ${ordinal(d.place)} sur ${n}` : ''}` },
          h('a', { href: `#/soiree/${d.date}`, 'aria-hidden': 'true', tabindex: '-1' }, jourMois(d.date)),
          h('span', { class: 'barre', 'aria-hidden': 'true' }, h('span', { vars: { '--part': `${part}%` } })),
          h('b', { 'aria-hidden': 'true' }, d.points));
      }))));
  } else {
    blocs.push(h('p', { class: 'vide' }, 'Pas encore de points cette saison.'));
  }

  if (etat.session?.organisateur) {
    const champ = /** @type {HTMLInputElement} */ (h('input', { type: 'text', id: 'renommer', maxlength: '40', value: j.nom, autocomplete: 'off' }));
    const erreur = h('p', { class: 'message-erreur', role: 'alert' });
    /** @param {Record<string, unknown>} modif @param {string} message */
    const modifier = async (modif, message) => {
      erreur.textContent = '';
      try {
        await api(`/joueurs/${id}`, { methode: 'PATCH', corps: modif });
        oublier();
        annoncer(message);
        rafraichir();
      } catch (e) {
        erreur.textContent = /** @type {Error} */ (e).message;
      }
    };
    blocs.push(h('form', {
      class: 'carte',
      onsubmit: (/** @type {SubmitEvent} */ ev) => { ev.preventDefault(); void modifier({ nom: champ.value }, 'Nom modifié'); },
    },
    h('div', { class: 'champ' }, h('label', { for: 'renommer' }, 'Nom affiché'),
      h('div', { class: 'ligne-ajout' }, champ, h('button', { type: 'submit', class: 'bouton-second' }, 'Renommer'))),
    h('button', {
      type: 'button', class: 'bouton-texte',
      onclick: () => void modifier({ actif: !j.actif }, j.actif ? 'Joueur archivé' : 'Joueur réactivé'),
    }, j.actif ? 'Archiver ce joueur (il ne sera plus proposé à la saisie)' : 'Réactiver ce joueur'),
    erreur));
  }

  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, j.nom),
      j.actif ? null : h('p', { class: 'sous-titre' }, 'Joueur archivé')),
    ...blocs,
    h('p', null, h('a', { href: '#/joueurs' }, 'Tous les joueurs')));
}
