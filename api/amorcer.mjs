// @ts-check
/**
 * Amorce de la base : la saison, le calendrier, les joueurs et les soirées
 * déjà jouées, à partir d'un fichier JSON (amorce/amorce.json).
 *
 *   node amorcer.mjs chemin/vers/amorce.json
 *
 * NE FAIT RIEN SI LA BASE CONTIENT DÉJÀ DES JOUEURS. L'amorce sert une fois,
 * au premier déploiement ; la relancer par erreur sur une base en service ne
 * doit rien pouvoir écraser. Tout se fait dans une transaction : une amorce
 * à moitié posée n'existe pas.
 *
 * Les identifiants du fichier (« cle ») sont ceux des lignes du tableur de
 * David ; la base attribue les siens, et l'état des assistants est
 * renuméroté en conséquence.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { validerNom, validerLibelle, validerDate } from './validation.mjs';
import { renumeroterEtat } from './etat.mjs';
import { semestreDe } from './donnees.mjs';

const chemin = process.argv[2];
if (!chemin) {
  console.error('usage : node amorcer.mjs amorce.json');
  process.exit(2);
}

/** @type {{ saison: string, joueurs: { cle: number, nom: string }[], soirees: any[] }} */
const amorce = JSON.parse(readFileSync(chemin, 'utf8'));
if (!/^\d{4}\/\d{4}$/.test(amorce.saison)) throw new Error('saison mal formée');

/**
 * Renumérote tous les identifiants de joueurs d'un état d'assistant.
 * @param {any} etat
 * @param {Map<number, number>} ids
 */
function renumeroter(etat, ids) {
  const v = renumeroterEtat(etat, (cle) => {
    const id = ids.get(cle);
    if (id === undefined) throw new Error(`joueur ${cle} inconnu dans l'état d'une soirée`);
    return id;
  });
  if (!v.ok) throw new Error(`état invalide après renumérotation : ${v.erreur}`);
  return v.valeur;
}

const client = new pg.Client({ application_name: 'ppl-amorce' });
await client.connect();
try {
  const deja = await client.query('select count(*)::int as n from joueurs');
  if (deja.rows[0].n > 0) {
    console.log(`  amorce ignorée : la base contient déjà ${deja.rows[0].n} joueurs`);
    process.exitCode = 0;
  } else {
    await client.query('begin');
    const s = await client.query(
      'insert into saisons (libelle) values ($1) on conflict (libelle) do update set libelle = excluded.libelle returning id',
      [amorce.saison]);
    const saisonId = s.rows[0].id;

    /** @type {Map<number, number>} */
    const ids = new Map();
    for (const j of amorce.joueurs) {
      const nom = validerNom(j.nom);
      if (!nom.ok) throw new Error(`joueur ${j.cle} : ${nom.erreur}`);
      const r = await client.query('insert into joueurs (nom_affiche) values ($1) returning id', [nom.valeur]);
      ids.set(j.cle, r.rows[0].id);
    }

    let saisies = 0;
    for (const so of amorce.soirees) {
      const date = validerDate(so.date);
      if (!date.ok) throw new Error(`soirée ${so.date} : ${date.erreur}`);
      const libelle = validerLibelle(so.libelle);
      if (!libelle.ok) throw new Error(`soirée ${so.date} : ${libelle.erreur}`);
      const semestre = so.semestre === 1 || so.semestre === 2 ? so.semestre : semestreDe(date.valeur);
      const r = await client.query(
        `insert into soirees (saison_id, date_soiree, semestre, libelle, compte, format, etat, modifie_le)
         values ($1, $2, $3, $4, $5, $6, $7, case when $8 then now() end) returning id`,
        [saisonId, date.valeur, semestre, libelle.valeur, so.compte !== false, so.format ?? 'libre',
          renumeroter(so.etat, ids), Array.isArray(so.resultats)],
      );
      for (const res of so.resultats ?? []) {
        const joueur = ids.get(res.cle);
        if (joueur === undefined) throw new Error(`soirée ${so.date} : joueur ${res.cle} inconnu`);
        await client.query(
          'insert into resultats (soiree_id, joueur_id, points, place) values ($1, $2, $3, $4)',
          [r.rows[0].id, joueur, res.points, res.place ?? null]);
      }
      if (Array.isArray(so.resultats)) saisies += 1;
    }
    await client.query(`insert into journal (action, detail) values ('amorce', $1)`,
      [{ joueurs: ids.size, soirees: amorce.soirees.length, saisies }]);
    await client.query('commit');
    console.log(`  amorce posée : ${ids.size} joueurs, ${amorce.soirees.length} soirées au calendrier, ${saisies} déjà saisies`);
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(`  ECHEC amorce : ${/** @type {Error} */ (e).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
