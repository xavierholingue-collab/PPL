// @ts-check
/**
 * PPL — démarrage et aiguillage entre les écrans.
 *
 * Une seule page ; l'adresse après « # » dit quel écran afficher :
 *   #/classement   #/soirees   #/soiree/2026-09-16   #/saisie/2026-10-21
 *   #/joueurs      #/joueur/12   #/organisateur
 */
import { chargerSession, etat } from './api.js';
import { icone, remplir, h } from './ui.js';
import { ecranClassement } from './ecrans/classement.js';
import { ecranSoirees, ecranSoiree } from './ecrans/soirees.js';
import { ecranSaisie } from './ecrans/saisie.js';
import { ecranJoueurs, ecranJoueur } from './ecrans/joueurs.js';
import { ecranOrganisateur } from './ecrans/organisateur.js';

/** @typedef {(vue: HTMLElement, params: string[]) => Promise<void>} Ecran */

/** @type {[RegExp, Ecran, string][]} */
const ROUTES = [
  [/^\/?$/, ecranClassement, 'classement'],
  [/^\/classement$/, ecranClassement, 'classement'],
  [/^\/soirees$/, ecranSoirees, 'soirees'],
  [/^\/soiree\/(\d{4}-\d{2}-\d{2})$/, ecranSoiree, 'soirees'],
  [/^\/saisie\/(\d{4}-\d{2}-\d{2})$/, ecranSaisie, 'soirees'],
  [/^\/joueurs$/, ecranJoueurs, 'joueurs'],
  [/^\/joueur\/(\d{1,9})$/, ecranJoueur, 'joueurs'],
  [/^\/organisateur$/, ecranOrganisateur, 'organisateur'],
];

const vue = /** @type {HTMLElement} */ (document.getElementById('vue'));
let numero = 0;

async function afficher() {
  let chemin = '';
  try {
    chemin = decodeURIComponent(location.hash.replace(/^#/, ''));
  } catch {
    // « % » mal formé dans l'adresse : on retombe sur le classement.
  }
  const trouve = ROUTES.find(([motif]) => motif.test(chemin));
  const [motif, ecran, rubrique] = trouve ?? ROUTES[0];
  const params = (motif.exec(chemin) ?? []).slice(1);

  for (const a of document.querySelectorAll('.onglets a')) {
    if (a.getAttribute('data-rubrique') === rubrique) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  // Un écran lent ne doit pas écraser celui qu'on a ouvert après lui.
  const moi = ++numero;
  const cadre = h('div', { class: 'vue-contenu' });
  try {
    await ecran(cadre, params);
  } catch (e) {
    console.error(e);
    remplir(cadre, h('div', { class: 'erreur-bloc', role: 'alert' },
      h('strong', null, 'L’écran n’a pas pu s’afficher. '),
      /** @type {Error} */ (e).message ?? ''));
  }
  if (moi !== numero) return;
  // On pose le cadre lui-même, pas une copie de son contenu : un écran qui
  // se redessine ensuite (étapes de saisie) écrit dans ce même cadre.
  vue.replaceChildren(cadre);
  const titre = vue.querySelector('h1');
  if (titre) {
    titre.setAttribute('tabindex', '-1');
    titre.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0 });
}

function majEnTete() {
  const s = etat.session;
  const saison = document.getElementById('saison');
  if (saison) saison.textContent = s?.saison ?? '';
  const libelle = document.getElementById('libelle-orga');
  if (libelle) libelle.textContent = s?.organisateur ? 'Organisateur ✓' : 'Organisateur';
  const bandeau = document.getElementById('bandeau');
  if (bandeau && s && s.environnement !== 'production') {
    bandeau.textContent = s.environnement === 'maquette'
      ? 'Maquette : les données servent aux essais et peuvent être remises à zéro.'
      : 'Version locale de développement.';
    bandeau.hidden = false;
  }
}

async function demarrer() {
  for (const el of document.querySelectorAll('[data-icone]')) {
    el.replaceWith(icone(/** @type {any} */ (el.getAttribute('data-icone'))));
  }
  try {
    await chargerSession();
  } catch {
    etat.session = { organisateur: false, environnement: 'production', saison: null, version: '' };
  }
  majEnTete();
  window.addEventListener('hashchange', () => { void afficher(); });
  document.addEventListener('ppl:session', () => { majEnTete(); });
  document.addEventListener('ppl:rafraichir', () => { void afficher(); });
  await afficher();

  // Le téléphone signale la perte totale du réseau : on le dit, sans bloquer.
  const horsLigne = document.getElementById('hors-ligne');
  const majReseau = () => { if (horsLigne) horsLigne.hidden = navigator.onLine; };
  window.addEventListener('online', majReseau);
  window.addEventListener('offline', majReseau);
  majReseau();

  // Ouvrir l'application sans réseau (voir sw.js). Sans service worker
  // (navigation privée, vieux navigateur), tout fonctionne en ligne.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

void demarrer();
