// @ts-check
/**
 * Accès à la base. Toutes les requêtes sont paramétrées : aucune valeur
 * venue de l'extérieur n'est jamais collée dans le texte d'une requête.
 */

import { renumeroterEtat } from './etat.mjs';

/** @typedef {import('pg').Pool} Pool */
/** @typedef {import('pg').PoolClient} Client */

/**
 * Exécute `travail` dans une transaction : tout passe, ou rien.
 * @template T
 * @param {Pool} pool
 * @param {(client: Client) => Promise<T>} travail
 * @returns {Promise<T>}
 */
export async function enTransaction(pool, travail) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const resultat = await travail(client);
    await client.query('commit');
    return resultat;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** La saison en cours : la plus récente. @param {Pool | Client} db */
export async function saisonCourante(db) {
  const { rows } = await db.query('select id, libelle from saisons order by libelle desc limit 1');
  return rows[0] ?? null;
}

/**
 * Bornes d'une saison « 2026/2027 » : du 1er août 2026 au 31 juillet 2027.
 * @param {string} libelle
 */
export function bornesSaison(libelle) {
  const debut = Number(libelle.slice(0, 4));
  return { debut: `${debut}-08-01`, fin: `${debut + 1}-07-31` };
}

/** Semestre d'une date : d'août à décembre le 1er, de janvier à juillet le 2e. @param {string} date */
export function semestreDe(date) {
  return Number(date.slice(5, 7)) >= 8 ? 1 : 2;
}

/** @param {Pool} db @param {number} saisonId */
export async function listeSoirees(db, saisonId) {
  const { rows } = await db.query(
    `select to_char(s.date_soiree, 'YYYY-MM-DD') as date, s.semestre, s.libelle, s.compte, s.format,
            count(r.joueur_id)::int as nb_joueurs, s.modifie_le
       from soirees s
       left join resultats r on r.soiree_id = s.id
      where s.saison_id = $1
      group by s.id
      order by s.date_soiree`,
    [saisonId],
  );
  return rows;
}

/**
 * Le classement du championnat : totaux et rangs par semestre et sur
 * l'année, plus le détail soirée par soirée.
 *
 * Le rang est celui de la fonction RANG du tableur : les ex æquo partagent
 * le rang, et le suivant saute (1, 2, 2, 4). Un joueur n'est classé sur une
 * période que s'il y a joué au moins une soirée qui compte.
 *
 * @param {Pool} db @param {number} saisonId
 */
export async function classement(db, saisonId) {
  const totaux = await db.query(
    `with t as (
       select j.id, j.nom_affiche as nom, j.actif,
              coalesce(sum(r.points) filter (where s.semestre = 1), 0)::int as s1,
              coalesce(sum(r.points) filter (where s.semestre = 2), 0)::int as s2,
              coalesce(sum(r.points), 0)::int as annee,
              count(*) filter (where s.semestre = 1)::int as n1,
              count(*) filter (where s.semestre = 2)::int as n2,
              count(*)::int as n
         from resultats r
         join soirees s on s.id = r.soiree_id and s.saison_id = $1 and s.compte
         join joueurs j on j.id = r.joueur_id
        group by j.id
     )
     select t.*,
            case when n1 > 0 then rank() over (partition by n1 > 0 order by s1 desc) end::int as rang_s1,
            case when n2 > 0 then rank() over (partition by n2 > 0 order by s2 desc) end::int as rang_s2,
            rank() over (order by annee desc)::int as rang_annee,
            case when n1 > 0 then count(*) over (partition by n1 > 0, s1) > 1 end as ex_s1,
            case when n2 > 0 then count(*) over (partition by n2 > 0, s2) > 1 end as ex_s2,
            count(*) over (partition by annee) > 1 as ex_annee
       from t`,
    [saisonId],
  );
  const detail = await db.query(
    `select r.joueur_id, to_char(s.date_soiree, 'YYYY-MM-DD') as date, r.points, r.place
       from resultats r
       join soirees s on s.id = r.soiree_id and s.saison_id = $1 and s.compte
      order by s.date_soiree`,
    [saisonId],
  );
  /** @type {Map<number, { date: string, points: number, place: number | null }[]>} */
  const parJoueur = new Map();
  for (const d of detail.rows) {
    const liste = parJoueur.get(d.joueur_id) ?? [];
    liste.push({ date: d.date, points: d.points, place: d.place });
    parJoueur.set(d.joueur_id, liste);
  }
  return totaux.rows.map((t) => ({
    id: t.id,
    nom: t.nom,
    actif: t.actif,
    s1: { total: t.s1, soirees: t.n1, rang: t.rang_s1, exAequo: t.ex_s1 === true },
    s2: { total: t.s2, soirees: t.n2, rang: t.rang_s2, exAequo: t.ex_s2 === true },
    annee: { total: t.annee, soirees: t.n, rang: t.rang_annee, exAequo: t.ex_annee === true },
    detail: parJoueur.get(t.id) ?? [],
  }));
}

/** @param {Pool} db */
export async function listeJoueurs(db) {
  const { rows } = await db.query('select id, nom_affiche as nom, actif from joueurs order by nom_affiche');
  return rows;
}

/** Le joueur et sa ligne de journal, ensemble ou pas du tout. @param {Pool} pool @param {string} nom */
export async function creerJoueur(pool, nom) {
  return enTransaction(pool, async (client) => {
    const { rows } = await client.query(
      'insert into joueurs (nom_affiche) values ($1) returning id, nom_affiche as nom, actif', [nom]);
    await client.query(`insert into journal (action, detail) values ('joueur_cree', $1)`, [{ id: rows[0].id }]);
    return rows[0];
  });
}

/** @param {Pool} pool @param {number} id @param {{ nom?: string, actif?: boolean }} modif */
export async function modifierJoueur(pool, id, modif) {
  return enTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `update joueurs
          set nom_affiche = coalesce($2, nom_affiche),
              actif = coalesce($3, actif)
        where id = $1
        returning id, nom_affiche as nom, actif`,
      [id, modif.nom ?? null, modif.actif ?? null],
    );
    if (rows[0]) {
      await client.query(`insert into journal (action, detail) values ('joueur_modifie', $1)`, [{ id, champs: Object.keys(modif) }]);
    }
    return rows[0] ?? null;
  });
}

/**
 * Fusionne deux fiches du même joueur (inscrit deux fois, sous deux noms) :
 * les points de `de` passent à `vers`, l'état des saisies est renuméroté,
 * puis la fiche `de` est supprimée. Tout ou rien.
 *
 * REFUSÉE si les deux ont des points à une même soirée : une personne ne
 * joue pas deux fois le même soir, ce sont donc deux joueurs différents.
 * @param {Pool} pool @param {number} de @param {number} vers
 * @returns {Promise<
 *   | { ok: true, joueur: { id: number, nom: string, actif: boolean }, soirees: number }
 *   | { ok: false, statut: 404 | 409, erreur: string }>}
 */
export async function fusionnerJoueurs(pool, de, vers) {
  return enTransaction(pool, async (client) => {
    const { rows: fiches } = await client.query(
      'select id, nom_affiche as nom, actif from joueurs where id = any($1::int[]) order by id for update', [[de, vers]]);
    const source = fiches.find((f) => f.id === de);
    const cible = fiches.find((f) => f.id === vers);
    if (!source || !cible) return { ok: false, statut: 404, erreur: 'joueur introuvable' };

    const { rows: ensemble } = await client.query(
      `select to_char(s.date_soiree, 'DD/MM/YYYY') as date
         from resultats a
         join resultats b on b.soiree_id = a.soiree_id and b.joueur_id = $2
         join soirees s on s.id = a.soiree_id
        where a.joueur_id = $1
        order by s.date_soiree`,
      [de, vers]);
    if (ensemble.length > 0) {
      return {
        ok: false, statut: 409,
        erreur: `${source.nom} et ${cible.nom} ont tous les deux des points le ${ensemble.map((r) => r.date).join(', ')} : ce sont deux joueurs différents`,
      };
    }

    // Tous les états d'abord, sans rien écrire : un seul qui ne se
    // renumérote pas proprement, et rien n'est touché.
    const { rows: soirees } = await client.query(
      `select id, etat, to_char(date_soiree, 'DD/MM/YYYY') as date from soirees where etat is not null for update`);
    /** @type {{ id: number, etat: unknown }[]} */
    const nouveaux = [];
    for (const s of soirees) {
      const avant = JSON.stringify(s.etat);
      const v = renumeroterEtat(s.etat, (id) => (id === de ? vers : id));
      if (!v.ok) return { ok: false, statut: 409, erreur: `soirée du ${s.date} : ${v.erreur}` };
      if (JSON.stringify(v.valeur) !== avant) nouveaux.push({ id: s.id, etat: v.valeur });
    }

    for (const n of nouveaux) await client.query('update soirees set etat = $2, modifie_le = now() where id = $1', [n.id, n.etat]);
    const deplaces = await client.query('update resultats set joueur_id = $2 where joueur_id = $1', [de, vers]);
    await client.query('delete from joueurs where id = $1', [de]);
    await client.query(`insert into journal (action, detail) values ('joueurs_fusionnes', $1)`,
      [{ de: { id: de, nom: source.nom }, vers: { id: vers, nom: cible.nom }, soirees: deplaces.rowCount }]);
    return { ok: true, joueur: cible, soirees: deplaces.rowCount ?? 0 };
  });
}

/** @param {Pool | Client} db @param {number} saisonId @param {string} date */
export async function soireeParDate(db, saisonId, date) {
  const s = await db.query(
    `select id, to_char(date_soiree, 'YYYY-MM-DD') as date, semestre, libelle, compte, format, etat, modifie_le
       from soirees where saison_id = $1 and date_soiree = $2`,
    [saisonId, date],
  );
  if (!s.rows[0]) return null;
  const r = await db.query(
    `select r.joueur_id, j.nom_affiche as nom, r.points, r.place
       from resultats r join joueurs j on j.id = r.joueur_id
      where r.soiree_id = $1
      order by r.points desc, r.place nulls last, j.nom_affiche`,
    [s.rows[0].id],
  );
  const { id, ...soiree } = s.rows[0];
  return { ...soiree, resultats: r.rows };
}

/**
 * Remplace les résultats d'une soirée, d'un seul coup. Crée la soirée si
 * elle n'est pas au calendrier (soirée déplacée, soirée en plus).
 * @param {Pool} pool
 * @param {{ id: number, libelle: string }} saison
 * @param {string} date
 * @param {{
 *   format: string, libelle?: string | null, compte?: boolean,
 *   etat: Record<string, unknown> | null,
 *   resultats: { joueur_id: number, points: number, place: number | null }[]
 * }} v saisie déjà validée par validerSoiree
 */
export async function enregistrerSoiree(pool, saison, date, v) {
  return enTransaction(pool, async (client) => {
    // Une soirée hors calendrier est créée au passage. « on conflict do
    // nothing » : deux enregistrements simultanés de la même date nouvelle ne
    // se heurtent plus (le second attendait une erreur 23505, donc un 500).
    await client.query(
      `insert into soirees (saison_id, date_soiree, semestre, libelle, compte, format)
       values ($1, $2, $3, $4, coalesce($5, true), $6)
       on conflict (saison_id, date_soiree) do nothing`,
      [saison.id, date, semestreDe(date), v.libelle ?? null, v.compte ?? null, v.format],
    );
    const ligne = await client.query(
      'select id from soirees where saison_id = $1 and date_soiree = $2 for update', [saison.id, date]);
    const soireeId = ligne.rows[0].id;
    await client.query(
      `update soirees
          set format = $2, etat = $3, modifie_le = now(),
              libelle = case when $4::boolean then $5 else libelle end,
              compte  = coalesce($6, compte)
        where id = $1`,
      [soireeId, v.format, v.etat, v.libelle !== undefined, v.libelle ?? null, v.compte ?? null],
    );
    await client.query('delete from resultats where soiree_id = $1', [soireeId]);
    if (v.resultats.length > 0) {
      await client.query(
        `insert into resultats (soiree_id, joueur_id, points, place)
         select $1, * from unnest($2::int[], $3::smallint[], $4::smallint[])`,
        [soireeId, v.resultats.map((r) => r.joueur_id), v.resultats.map((r) => r.points), v.resultats.map((r) => r.place)],
      );
    }
    await client.query(
      `insert into journal (action, detail) values ('soiree_enregistree', $1)`,
      [{ date, format: v.format, joueurs: v.resultats.length }],
    );
    return soireeParDate(client, saison.id, date);
  });
}

/** @param {Pool} pool @param {number} saisonId @param {string} date */
export async function effacerResultats(pool, saisonId, date) {
  return enTransaction(pool, async (client) => {
    const s = await client.query(
      'select id from soirees where saison_id = $1 and date_soiree = $2 for update', [saisonId, date]);
    if (!s.rows[0]) return false;
    await client.query('delete from resultats where soiree_id = $1', [s.rows[0].id]);
    await client.query('update soirees set etat = null, format = $2, modifie_le = now() where id = $1', [s.rows[0].id, 'libre']);
    await client.query(`insert into journal (action, detail) values ('soiree_effacee', $1)`, [{ date }]);
    return true;
  });
}
