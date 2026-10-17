// @ts-check
/// <reference lib="webworker" />
/**
 * Service worker de PPL : l'application s'ouvre même sans réseau.
 *
 * Au gymnase, le réseau mobile peut manquer au moment de saisir les points.
 * Ici, RÉSEAU D'ABORD, toujours : en ligne, on sert exactement ce que le
 * serveur envoie (pas de version figée après une livraison) ; le cache ne
 * sert que de secours quand le réseau ne répond pas.
 *
 * Les lectures de l'API (joueurs, calendrier, classement, soirée) sont
 * gardées de la même façon, pour que l'écran de saisie s'ouvre hors ligne.
 * Les écritures, elles, ne passent jamais par le cache : sans réseau,
 * l'enregistrement échoue franchement et la saisie reste dans le brouillon
 * du téléphone jusqu'au retour du réseau.
 */

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = 'ppl-1';

const COQUILLE = [
  '/', '/index.html', '/jetons.css', '/app.css', '/manifest.webmanifest', '/icone.svg',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/regles.js', '/js/brouillon.js',
  '/js/ecrans/classement.js', '/js/ecrans/soirees.js', '/js/ecrans/saisie.js',
  '/js/ecrans/joueurs.js', '/js/ecrans/organisateur.js',
  '/polices/barlow-condensed-600.woff2', '/polices/barlow-condensed-700.woff2',
  '/polices/atkinson-hyperlegible-next.woff2',
];

/** Lectures de l'API qu'on garde pour le hors-ligne (jamais l'export). */
const API_GARDEE = /^\/api\/(session|saison|classement|joueurs|soirees\/\d{4}-\d{2}-\d{2})$/;

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (e) => {
  const requete = e.request;
  const url = new URL(requete.url);
  if (requete.method !== 'GET' || url.origin !== sw.location.origin) return;
  const estApi = url.pathname.startsWith('/api/');
  if (estApi && !API_GARDEE.test(url.pathname)) return;

  e.respondWith((async () => {
    try {
      const reponse = await fetch(requete);
      if (reponse.ok && reponse.type === 'basic') {
        const copie = reponse.clone();
        e.waitUntil(caches.open(CACHE).then((c) => c.put(requete, copie)));
      }
      return reponse;
    } catch {
      const garde = await caches.match(requete, { ignoreSearch: !estApi });
      if (garde) return garde;
      if (requete.mode === 'navigate') {
        const page = await caches.match('/index.html');
        if (page) return page;
      }
      return Response.error();
    }
  })());
});
