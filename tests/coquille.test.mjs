// @ts-check
/**
 * Le service worker garde une liste des fichiers de l'application pour
 * l'ouvrir hors ligne (web/sw.js). Une liste écrite à la main vieillit en
 * silence : un fichier renommé ferait échouer l'installation du service
 * worker, et un écran ajouté ne s'ouvrirait pas hors ligne.
 * Ce contrôle compare la liste au dossier, dans les deux sens.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const WEB = new URL('../web/', import.meta.url).pathname;
const source = readFileSync(join(WEB, 'sw.js'), 'utf8');
const bloc = /const COQUILLE = \[([\s\S]*?)\];/.exec(source);
assert.ok(bloc, 'liste COQUILLE introuvable dans sw.js');
const liste = [...bloc[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

/** @param {string} dossier @returns {string[]} */
function fichiers(dossier) {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(join(dossier, e.name)) : [join(dossier, e.name)]);
}

test('chaque fichier de la coquille existe', () => {
  for (const chemin of liste) {
    if (chemin === '/') continue;
    assert.ok(existsSync(join(WEB, chemin)), `${chemin} est dans sw.js mais pas dans web/`);
  }
});

test('chaque script, feuille de style et police est dans la coquille', () => {
  const attendus = fichiers(WEB)
    .map((f) => `/${relative(WEB, f)}`)
    .filter((f) => /\.(js|css|woff2)$/.test(f) && f !== '/sw.js');
  for (const f of attendus) assert.ok(liste.includes(f), `${f} manque dans la liste COQUILLE de sw.js`);
});
