// @ts-check
/**
 * Connexion de l'organisateur. Une fois connecté, ce téléphone le reste
 * (60 jours par défaut) : pas de mot de passe à retaper chaque mercredi.
 */
import { api, chargerSession, chargerCalendrier, etat, oublier } from '../api.js';
import { h, remplir, annoncer, sessionChangee, dateLongue } from '../ui.js';
import { soireeASaisir } from './classement.js';

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
