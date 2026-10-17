-- =========================================================================
-- PPL — schéma de la base
--
-- Rejouable sans dommage : chaque objet est créé « s'il n'existe pas ».
-- Le déployeur exécute tous les fichiers db/*.sql dans l'ordre des noms,
-- après une sauvegarde complète de la base.
--
-- Exécuté par le rôle de l'application (ppl), propriétaire des tables,
-- ni superutilisateur ni BYPASSRLS.
-- =========================================================================

-- Une saison va de septembre à mai : « 2026/2027 ».
create table if not exists saisons (
  id       integer generated always as identity primary key,
  libelle  text not null unique check (libelle ~ '^[0-9]{4}/[0-9]{4}$'),
  cree_le  timestamptz not null default now()
);

-- Les joueurs, sous le nom qu'on affiche (prénom et initiale). Le nom de
-- famille complet n'est pas nécessaire au classement : on ne le stocke pas.
create table if not exists joueurs (
  id           integer generated always as identity primary key,
  nom_affiche  text not null check (char_length(btrim(nom_affiche)) between 1 and 40),
  actif        boolean not null default true,
  cree_le      timestamptz not null default now()
);
create unique index if not exists joueurs_nom_unique on joueurs (lower(btrim(nom_affiche)));

-- Les soirées du calendrier. Une soirée qui ne compte pas (AG, relâche,
-- annulée) reste au calendrier, avec compte = false.
create table if not exists soirees (
  id           integer generated always as identity primary key,
  saison_id    integer not null references saisons (id) on delete restrict,
  date_soiree  date not null,
  semestre     smallint not null check (semestre in (1, 2)),
  libelle      text check (libelle is null or char_length(libelle) between 1 and 40),
  compte       boolean not null default true,
  format       text not null default 'libre'
                 check (format in ('libre', 'classement', 'poules')),
  -- État de l'assistant (poules, matchs, tableau final) : on garde la trace
  -- de la façon dont les points ont été obtenus. Taille bornée par l'API.
  etat         jsonb,
  modifie_le   timestamptz,
  unique (saison_id, date_soiree)
);

-- Les points de chaque joueur à chaque soirée.
create table if not exists resultats (
  soiree_id  integer not null references soirees (id) on delete cascade,
  joueur_id  integer not null references joueurs (id) on delete restrict,
  points     smallint not null check (points between 0 and 99),
  place      smallint check (place is null or place between 1 and 99),
  primary key (soiree_id, joueur_id)
);
create index if not exists resultats_joueur on resultats (joueur_id);

-- Le journal des modifications : qui a changé quoi, et quand. Pas
-- d'adresse IP : le journal sert à comprendre un classement, pas à
-- surveiller des personnes.
create table if not exists journal (
  id      bigint generated always as identity primary key,
  quand   timestamptz not null default now(),
  action  text not null,
  detail  jsonb
);
