// @ts-check
/**
 * Connexion de l'organisateur. Une fois connecté, ce téléphone le reste
 * (60 jours par défaut) : pas de mot de passe à retaper chaque mercredi.
 */
import { api, chargerSession, chargerCalendrier, etat, oublier } from '../api.js';
import { h, remplir, annoncer, sessionChangee, dateLongue } from '../ui.js';
import { soireeASaisir } from './classement.js';

/** Longueur minimale : la même règle que l'API (api/validation.mjs). */
const LONGUEUR_MIN = 8;

/**
 * Changer le mot de passe organisateur, depuis un téléphone connecté. On
 * redonne l'actuel ; les autres téléphones devront se reconnecter.
 */
function changerMotDePasse() {
  /** @param {string} id @param {string} autocomplete */
  const champ = (id, autocomplete) => /** @type {HTMLInputElement} */ (h('input', {
    type: 'password', id, autocomplete, required: true, maxlength: '200',
    ...(autocomplete === 'new-password' ? { minlength: String(LONGUEUR_MIN) } : {}),
  }));
  const actuel = champ('mdp-actuel', 'current-password');
  const nouveau = champ('mdp-nouveau', 'new-password');
  const confirmation = champ('mdp-confirmation', 'new-password');
  const erreur = h('p', { class: 'message-erreur', role: 'alert' });
  const valider = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'bouton' }, 'Enregistrer'));
  const formulaire = /** @type {HTMLFormElement} */ (h('form', {
    class: 'carte', id: 'changer-mdp', hidden: true,
    onsubmit: async (/** @type {SubmitEvent} */ ev) => {
      ev.preventDefault();
      erreur.textContent = '';
      if ([...nouveau.value].length < LONGUEUR_MIN) { erreur.textContent = `Au moins ${LONGUEUR_MIN} caractères.`; nouveau.focus(); return; }
      if (nouveau.value !== confirmation.value) { erreur.textContent = 'Les deux saisies du nouveau mot de passe diffèrent.'; confirmation.select(); return; }
      valider.disabled = true;
      try {
        await api('/mot-de-passe', { methode: 'POST', corps: { actuel: actuel.value, nouveau: nouveau.value } });
        for (const c of [actuel, nouveau, confirmation]) c.value = '';
        formulaire.hidden = true;
        ouvrir.setAttribute('aria-expanded', 'false');
        annoncer('Mot de passe changé. Les autres téléphones devront se reconnecter.', { duree: 6000 });
      } catch (e) {
        erreur.textContent = /** @type {Error} */ (e).message;
      } finally {
        valider.disabled = false;
      }
    },
  },
  h('div', { class: 'champ' }, h('label', { for: 'mdp-actuel' }, 'Mot de passe actuel'), actuel),
  h('div', { class: 'champ' }, h('label', { for: 'mdp-nouveau' }, 'Nouveau mot de passe'), nouveau,
    h('small', { class: 'aide' }, `Au moins ${LONGUEUR_MIN} caractères. Majuscules et minuscules comptent.`)),
  h('div', { class: 'champ' }, h('label', { for: 'mdp-confirmation' }, 'Le nouveau, une seconde fois'), confirmation),
  erreur,
  valider));
  const ouvrir = h('button', {
    type: 'button', class: 'bouton-texte', 'aria-expanded': 'false', 'aria-controls': 'changer-mdp',
    onclick: () => {
      formulaire.hidden = !formulaire.hidden;
      ouvrir.setAttribute('aria-expanded', String(!formulaire.hidden));
      if (!formulaire.hidden) actuel.focus();
    },
  }, 'Changer le mot de passe');
  return h('div', null, ouvrir, formulaire);
}

/** @param {HTMLElement} vue */
export async function ecranOrganisateur(vue) {
  if (etat.session?.organisateur) {
    const cal = await chargerCalendrier();
    const aSaisir = soireeASaisir(cal.soirees);
    remplir(vue,
      h('div', { class: 'titre-page' },
        h('h1', null, 'Organisateur'),
        h('p', { class: 'sous-titre' }, 'Vous êtes connecté sur ce téléphone.')),
      aSaisir ? h('div', { class: 'carte carte-table' },
        h('h2', null, 'Soirée à saisir'),
        h('p', null, dateLongue(aSaisir.date)),
        h('a', { class: 'bouton', href: `#/saisie/${aSaisir.date}` }, 'Saisir les points')) : null,
      h('ul', { class: 'liste-simple' },
        h('li', null, h('a', { href: '#/soirees' }, 'Choisir une autre soirée à saisir')),
        h('li', null, h('a', { href: '#/joueurs' }, 'Ajouter ou renommer un joueur')),
        h('li', null, h('a', { href: '/api/export.ods', download: '' }, 'Télécharger le classement pour LibreOffice'))),
      changerMotDePasse(),
      h('button', {
        type: 'button', class: 'bouton-second',
        onclick: async () => {
          try {
            await api('/deconnexion', { methode: 'POST' });
          } finally {
            await chargerSession().catch(() => {});
            oublier();
            sessionChangee();
            annoncer('Déconnecté');
            location.hash = '#/classement';
          }
        },
      }, 'Se déconnecter'),
      etat.session?.version ? h('p', { class: 'aide' }, `Version ${etat.session.version}`) : null);
    return;
  }

  const champ = /** @type {HTMLInputElement} */ (h('input', {
    type: 'password', id: 'mot-de-passe', autocomplete: 'current-password', required: true,
  }));
  const erreur = h('p', { class: 'message-erreur', role: 'alert' });
  const bouton = /** @type {HTMLButtonElement} */ (h('button', { type: 'submit', class: 'bouton bouton-large' }, 'Se connecter'));
  remplir(vue,
    h('div', { class: 'titre-page' },
      h('h1', null, 'Organisateur'),
      h('p', { class: 'sous-titre' }, 'La saisie des points est réservée à l’organisateur. Le classement, lui, est ouvert à tous.')),
    h('form', {
      class: 'carte',
      onsubmit: async (/** @type {SubmitEvent} */ ev) => {
        ev.preventDefault();
        erreur.textContent = '';
        bouton.disabled = true;
        try {
          await api('/connexion', { methode: 'POST', corps: { mot_de_passe: champ.value } });
          await chargerSession();
          oublier();
          sessionChangee();
          annoncer('Connecté : vous pouvez saisir les points');
          location.hash = '#/soirees';
        } catch (e) {
          erreur.textContent = /** @type {Error} */ (e).message;
          champ.select();
        } finally {
          bouton.disabled = false;
        }
      },
    },
    h('div', { class: 'champ' }, h('label', { for: 'mot-de-passe' }, 'Mot de passe'), champ),
    erreur,
    bouton));
}
