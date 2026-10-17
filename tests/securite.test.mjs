// @ts-check
/**
 * Contrôles des fonctions de session (api/securite.mjs), sans serveur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleSession, emettreJeton, jetonValide, motDePasseCorrect, nomCookie, cookieSession, origineAdmise, Limiteur } from '../api/securite.mjs';

const SECRET = 'un-secret-de-controle-suffisamment-long-0123456789';

test('changer le mot de passe invalide les sessions déjà ouvertes', () => {
  const avant = cleSession(SECRET, 'ancien-mot-de-passe');
  const apres = cleSession(SECRET, 'nouveau-mot-de-passe');
  const jeton = emettreJeton(avant, 3600);
  assert.equal(jetonValide(jeton, avant), true);
  assert.equal(jetonValide(jeton, apres), false);
});

test('jeton expiré, modifié, tronqué ou venu du futur : refusé', () => {
  const cle = cleSession(SECRET, 'mot-de-passe');
  const maintenant = 1_800_000_000;
  const jeton = emettreJeton(cle, 60, maintenant);
  assert.equal(jetonValide(jeton, cle, maintenant + 30), true);
  assert.equal(jetonValide(jeton, cle, maintenant + 61), false, 'expiré');
  assert.equal(jetonValide(`${jeton}x`, cle, maintenant), false, 'signature modifiée');
  assert.equal(jetonValide(jeton.split('.')[0], cle, maintenant), false, 'tronqué');
  const futur = emettreJeton(cle, 60, maintenant + 3600);
  assert.equal(jetonValide(futur, cle, maintenant), false, 'émis dans le futur');
  assert.equal(jetonValide(undefined, cle), false);
  assert.equal(jetonValide('a'.repeat(600), cle), false, 'trop long');
});

test('mot de passe : comparaison exacte, entrées étranges refusées', () => {
  assert.equal(motDePasseCorrect('ABCD-EFGH', 'ABCD-EFGH'), true);
  assert.equal(motDePasseCorrect('ABCD-EFGh', 'ABCD-EFGH'), false);
  assert.equal(motDePasseCorrect(undefined, 'x'), false);
  assert.equal(motDePasseCorrect({ toString: () => 'x' }, 'x'), false);
  assert.equal(motDePasseCorrect('x'.repeat(201), 'x'.repeat(201)), false);
});

test('mot de passe fabriqué : minuscules, espaces et tirets tolérés, rien d’autre', () => {
  const fabrique = 'ABCD-EFGH-JKMN-PQ23'; // inventé, même forme que ceux de l'installeur
  for (const saisie of [fabrique, fabrique.toLowerCase(), 'abcdefghjkmnpq23', ' ABCD EFGH JKMN PQ23 ', 'Abcd-Efgh-Jkmn-Pq23']) {
    assert.equal(motDePasseCorrect(saisie, fabrique), true, `« ${saisie} » accepté`);
  }
  for (const saisie of ['ABCD-EFGH-JKMN-PQ2', 'ABCD-EFGH-JKMN-PQ233', 'ABCD-EFGH-JKMN-PQ24', 'ABCD_EFGH_JKMN_PQ23', '']) {
    assert.equal(motDePasseCorrect(saisie, fabrique), false, `« ${saisie} » refusé`);
  }
  // Un mot de passe choisi à la main garde la comparaison exacte.
  assert.equal(motDePasseCorrect('mon-mot-de-passe', 'Mon-Mot-De-Passe'), false);
  assert.equal(motDePasseCorrect('MonMotDePasse', 'Mon-Mot-De-Passe'), false);
  // Les lettres absentes de l'alphabet (I, L, O) font sortir de la forme fabriquée.
  assert.equal(motDePasseCorrect('abcd-efgh-ijkl-mnop', 'ABCD-EFGH-IJKL-MNOP'), false);
});

test('cookie : préfixe __Host- et Secure en https, HttpOnly et SameSite=Strict toujours', () => {
  assert.equal(nomCookie(true), '__Host-ppl_session');
  const c = cookieSession('v', { securise: true, maxAge: 10 });
  assert.match(c, /^__Host-ppl_session=v; Path=\/; HttpOnly; SameSite=Strict; Max-Age=10; Secure$/);
  assert.doesNotMatch(cookieSession('v', { securise: false, maxAge: 10 }), /Secure|__Host-/);
});

test('origine : exacte en production, même hôte en local', () => {
  assert.equal(origineAdmise({ origin: 'https://ppl.y-factor.fr' }, 'https://ppl.y-factor.fr'), true);
  assert.equal(origineAdmise({ origin: 'https://lisia.y-factor.fr' }, 'https://ppl.y-factor.fr'), false, 'sous-domaine voisin');
  assert.equal(origineAdmise({ 'sec-fetch-site': 'same-site' }, 'https://ppl.y-factor.fr'), false);
  assert.equal(origineAdmise({ origin: 'http://127.0.0.1:8090', host: '127.0.0.1:8090' }, ''), true);
  assert.equal(origineAdmise({ origin: 'http://evil.example', host: '127.0.0.1:8090' }, ''), false);
});

test('limiteur : trop d’échecs bloquent, une réussite efface, la fenêtre expire', () => {
  const l = new Limiteur({ essais: 3, fenetreMs: 1000 });
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) l.echec('ip', t);
  assert.ok(l.bloque('ip', t + 10) > 0);
  assert.equal(l.bloque('ip', t + 1001), 0, 'fenêtre expirée');
  l.echec('autre', t); l.reussite('autre');
  assert.equal(l.bloque('autre', t), 0);
});
