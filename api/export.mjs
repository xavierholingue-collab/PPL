// @ts-check
/**
 * Export du championnat pour le tableur : un fichier .ods (LibreOffice) et
 * un .csv de secours.
 *
 * Le fichier .ods est fabriqué ici, sans bibliothèque : c'est une archive
 * ZIP de trois fichiers XML. Une dépendance de plus pour cela serait une
 * chose de plus à surveiller pour ses failles ; le format, lui, ne bouge pas.
 */
import { deflateRawSync } from 'node:zlib';

/**
 * @typedef {{
 *   saison: string,
 *   soirees: { date: string, semestre: number, libelle: string | null, compte: boolean }[],
 *   joueurs: {
 *     nom: string,
 *     s1: { total: number, rang: number | null }, s2: { total: number, rang: number | null },
 *     annee: { total: number, rang: number | null },
 *     points: Record<string, number>
 *   }[]
 * }} Tableau
 */

// ------------------------------------------------------------------ CSV

/**
 * Une cellule CSV. Une valeur qui commence par = + - @ serait prise pour une
 * formule par le tableur : on la neutralise par une apostrophe.
 * @param {string | number | null} v
 */
function celluleCsv(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** @param {string} iso */
const jourMois = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** @param {Tableau} t */
export function versCsv(t) {
  const soirees = t.soirees.filter((s) => s.compte);
  const entete = ['Joueur', ...soirees.map((s) => jourMois(s.date)), 'Total S1', 'Rang S1', 'Total S2', 'Rang S2', 'Total saison', 'Rang saison'];
  const lignes = t.joueurs.map((j) => [
    j.nom,
    ...soirees.map((s) => j.points[s.date] ?? null),
    j.s1.total, j.s1.rang, j.s2.total, j.s2.rang, j.annee.total, j.annee.rang,
  ]);
  // Le BOM fait reconnaître l'UTF-8 au tableur ; le point-virgule est le
  // séparateur attendu par LibreOffice et Excel réglés en français.
  return `﻿${[entete, ...lignes].map((l) => l.map(celluleCsv).join(';')).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ ODS

/** @param {string} s */
const xml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** @param {string | number | null} v @param {string} [style] */
function celluleOds(v, style) {
  const s = style ? ` table:style-name="${style}"` : '';
  if (v === null || v === undefined || v === '') return `<table:table-cell${s}/>`;
  if (typeof v === 'number') return `<table:table-cell${s} office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>`;
  return `<table:table-cell${s} office:value-type="string"><text:p>${xml(v)}</text:p></table:table-cell>`;
}

/** @param {(string | number | null)[]} cellules @param {string} [style] */
const ligneOds = (cellules, style) => `<table:table-row>${cellules.map((c) => celluleOds(c, style)).join('')}</table:table-row>`;

/** @param {number | null} rang */
const rangTexte = (rang) => (rang === null ? null : rang === 1 ? '1er' : `${rang}e`);

/** @param {Tableau} t */
function contenuOds(t) {
  const feuilles = [];

  // 1. Le classement de l'année, comme l'onglet « Classement Général ».
  const parAnnee = [...t.joueurs].sort((a, b) => (a.annee.rang ?? 999) - (b.annee.rang ?? 999) || a.nom.localeCompare(b.nom, 'fr'));
  feuilles.push(`<table:table table:name="Classement ${xml(t.saison.replace('/', '-'))}">
<table:table-column table:style-name="col-nom"/><table:table-column table:number-columns-repeated="6" table:style-name="col-chiffre"/>
${ligneOds([`PPL — classement ${t.saison}`], 'titre')}
${ligneOds(['Joueur', 'Total S1', 'Rang S1', 'Total S2', 'Rang S2', 'Total saison', 'Rang saison'], 'entete')}
${parAnnee.map((j) => ligneOds([j.nom, j.s1.total || null, rangTexte(j.s1.rang), j.s2.total || null, rangTexte(j.s2.rang), j.annee.total, rangTexte(j.annee.rang)])).join('\n')}
</table:table>`);

  // 2 et 3. Une feuille par semestre, comme l'onglet SAISIE.
  for (const semestre of [1, 2]) {
    const soirees = t.soirees.filter((s) => s.semestre === semestre);
    const cle = semestre === 1 ? 's1' : 's2';
    const joueurs = [...t.joueurs].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    feuilles.push(`<table:table table:name="Semestre ${semestre}">
<table:table-column table:style-name="col-nom"/><table:table-column table:number-columns-repeated="${soirees.length + 2}" table:style-name="col-chiffre"/>
${ligneOds(['', ...soirees.map((s) => s.libelle ?? (s.compte ? null : 'Sans points'))], 'libelle')}
${ligneOds(['Joueur', ...soirees.map((s) => jourMois(s.date)), 'Total', 'Rang'], 'entete')}
${joueurs.map((j) => ligneOds([j.nom, ...soirees.map((s) => (s.compte ? j.points[s.date] ?? null : null)), j[cle].total || null, rangTexte(j[cle].rang)])).join('\n')}
</table:table>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
<office:automatic-styles>
<style:style style:name="col-nom" style:family="table-column"><style:table-column-properties style:column-width="4.2cm"/></style:style>
<style:style style:name="col-chiffre" style:family="table-column"><style:table-column-properties style:column-width="1.9cm"/></style:style>
<style:style style:name="titre" style:family="table-cell"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="entete" style:family="table-cell"><style:table-cell-properties fo:background-color="#dfe7f1"/><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="libelle" style:family="table-cell"><style:text-properties fo:font-style="italic"/></style:style>
</office:automatic-styles>
<office:body><office:spreadsheet>
${feuilles.join('\n')}
</office:spreadsheet></office:body>
</office:document-content>
`;
}

const MANIFESTE = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>
`;

/** @param {Tableau} t @returns {Buffer} */
export function versOds(t) {
  return zip([
    // « mimetype » d'abord et sans compression : c'est ainsi que les
    // logiciels reconnaissent un document OpenDocument.
    { nom: 'mimetype', donnees: Buffer.from('application/vnd.oasis.opendocument.spreadsheet'), compresser: false },
    { nom: 'META-INF/manifest.xml', donnees: Buffer.from(MANIFESTE), compresser: true },
    { nom: 'content.xml', donnees: Buffer.from(contenuOds(t)), compresser: true },
  ]);
}

// ------------------------------------------------------------------ ZIP

const TABLE_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @param {Buffer} b */
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Archive ZIP minimale (méthodes « stockée » et « deflate »).
 * @param {{ nom: string, donnees: Buffer, compresser: boolean }[]} fichiers
 */
export function zip(fichiers) {
  const locaux = [];
  const centraux = [];
  let decalage = 0;
  // 1er janvier 2026, 00:00 : une date fixe rend l'archive reproductible.
  const heureDos = 0;
  const dateDos = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, 'utf8');
    const contenu = f.compresser ? deflateRawSync(f.donnees) : f.donnees;
    const methode = f.compresser ? 8 : 0;
    const crc = crc32(f.donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(methode, 8);
    local.writeUInt16LE(heureDos, 10);
    local.writeUInt16LE(dateDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(contenu.length, 18);
    local.writeUInt32LE(f.donnees.length, 22);
    local.writeUInt16LE(nom.length, 26);
    local.writeUInt16LE(0, 28);
    locaux.push(local, nom, contenu);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(methode, 10);
    central.writeUInt16LE(heureDos, 12);
    central.writeUInt16LE(dateDos, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(contenu.length, 20);
    central.writeUInt32LE(f.donnees.length, 24);
    central.writeUInt16LE(nom.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, nom);
    decalage += local.length + nom.length + contenu.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(fichiers.length, 8);
  fin.writeUInt16LE(fichiers.length, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

/**
 * Assemble le tableau à exporter à partir du classement et du calendrier.
 * @param {string} saison
 * @param {Tableau['soirees']} soirees
 * @param {Awaited<ReturnType<typeof import('./donnees.mjs').classement>>} lignes
 * @returns {Tableau}
 */
export function preparerTableau(saison, soirees, lignes) {
  return {
    saison,
    soirees,
    joueurs: lignes.map((l) => ({
      nom: l.nom,
      s1: { total: l.s1.total, rang: l.s1.rang },
      s2: { total: l.s2.total, rang: l.s2.rang },
      annee: { total: l.annee.total, rang: l.annee.rang },
      points: Object.fromEntries(l.detail.map((d) => [d.date, d.points])),
    })),
  };
}
