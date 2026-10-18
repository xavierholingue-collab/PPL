# PPL — Ping Pong Loisir

Maquette d'application mobile pour les soirées du club : saisie des points en
fin de soirée sur le téléphone, classement du championnat (semestre 1,
semestre 2, saison) mis à jour aussitôt, et un assistant pour les soirées en
poules qui applique les règles de la feuille de David.

Adresse prévue : **https://ppl.y-factor.fr**

## Mettre en ligne — trois commandes

Toutes depuis le terminal Ubuntu (WSL).

**1. Le nom de domaine** (une fois). Depuis le dossier InfraLWS, comme pour lisia :

```bash
node zone-lws-appliquer.mjs /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/plan-dns-ppl.json
node zone-lws-appliquer.mjs /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/plan-dns-ppl.json --appliquer
```

Ou, à la main dans le panneau LWS : enregistrement A `ppl` → `195.110.35.206`, TTL 3600.

**2. L'installation sur le VPS** (une fois) :

```bash
bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/installer-ppl.sh
```

Elle choisit un port libre (aucun de ceux qu'écoutent ou que réservent les
autres applications), crée la base, le rôle, le compte de service, l'unité
systemd et le bloc Caddy, vérifie que les autres sites répondent comme avant, puis livre
l'application avec les données du fichier de David. **Le mot de passe
organisateur s'affiche une seule fois à la fin** : c'est celui à donner à David.
Pour le relire, en root sur le serveur : `grep MOT_DE_PASSE /etc/ppl/env`.

**3. Les livraisons suivantes** :

```bash
bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/livrer-ppl.sh
```

Le serveur sauvegarde la base avant toute chose (les dix dernières copies,
dans `/var/backups/ppl`), applique le schéma, pose le nouveau code d'un seul
coup, et remet l'ancienne version si le service ne répond pas. Les données du
fichier de David ne partent qu'avec la première livraison ; ensuite, la base
fait foi.

## Le dépôt git

Le code est sur GitHub, dans le dépôt privé `xavierholingue-collab/PPL`, et
chaque envoi y déclenche les contrôles (onglet Actions) : règles, types,
scripts, puis l'API complète sur un PostgreSQL 18, avec des joueurs inventés.

Même montage que Biblio : **ce dossier fait foi**. Le dépôt vit dans WSL
(`~/dev/ppl`) et ne s'édite jamais à la main. Pour envoyer l'état du dossier :

```bash
bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/assembler-depot.sh "ce qui a changé"
```

Sans message, le script montre ce qui partirait et n'envoie rien. Il refuse
tout envoi qui contiendrait un secret, l'amorce ou le nom d'un joueur du club.

## Ce que fait la maquette

| Écran | Pour qui | Ce qu'on y fait |
|---|---|---|
| Classement | tous | semestre 1, semestre 2, saison ; podium, détail par soirée, export LibreOffice |
| Soirées | tous | le calendrier de la saison, les points et les poules de chaque soirée |
| Joueurs | tous | la saison de chacun ; l'organisateur ajoute, renomme, archive |
| Saisie | organisateur | présents → format → résultats → vérification → enregistrement |

Trois façons de saisir une soirée :

- **Poules** : on touche le score de chaque match (2-0, 2-1, 1-2, 0-2) ;
  l'appli classe les poules (points, victoires, match gagné sur l'autre,
  tournante à trois), prépare le tableau final (1er de A contre 1er de B…) et
  attribue les points. Au-delà de 17 joueurs, barème de la feuille (12, 11, 10…).
- **Classement de la soirée** : on touche les joueurs dans l'ordre d'arrivée ;
  les points suivent la place (N joueurs : N points au 1er, 1 au dernier).
- **Points directs** : on tape les points de chacun, comme dans le fichier.

La saisie en cours est gardée sur le téléphone, et l'application s'ouvre même
sans réseau (service worker, réseau d'abord : en ligne, on sert toujours la
dernière version) : au gymnase, on saisit la soirée hors connexion et on
l'enregistre quand le réseau revient.

## La pile

La même que Biblio, sur le même serveur :

- **Caddy** devant : TLS, en-têtes de sécurité, politique de contenu stricte
  (aucun script ni style en ligne, donc rien à recalculer) ;
- **API** Node 22, serveur HTTP sans framework, une seule dépendance (`pg`),
  qui n'écoute qu'en local (127.0.0.1, sur le premier port libre à partir de
  3020, choisi à l'installation) et tourne sous un compte sans droits
  (`ppl-api`), dans une unité systemd durcie ;
- **PostgreSQL 18** de la machine, base `ppl`, rôle `ppl` ni superutilisateur
  ni BYPASSRLS, et qui ne peut ouvrir aucune autre base (vérifié à l'installation) ;
- **Pages** HTML et JavaScript natifs, sans compilation ; polices hébergées sur
  le serveur (aucun appel à Google).

Lecture libre ; toute écriture demande la session organisateur (cookie
HttpOnly, SameSite=Strict, signé, 60 jours), contrôle de l'origine, essais de
mot de passe limités à dix par quart d'heure.

## Organisation du dossier

```
api/          serveur Node : routes, session, validation, export .ods/.csv
db/           schéma SQL, rejouable, appliqué à chaque livraison
web/          l'application (HTML, CSS, JS), servie par Caddy
web/js/regles.js   toutes les règles de calcul, sans dépendance
web/sw.js     ouverture hors connexion
tests/        contrôles des règles, dont la vraie feuille du 16 septembre ;
              amorce-controle.json, les joueurs inventés des contrôles
amorce/       données du fichier de David (prénom + initiale) — hors dépôt
deploiement/  DNS, installeur, déployeur, livraison, assemblage du dépôt
.github/      les contrôles de GitHub Actions
```

## Contrôles

```bash
node --test tests/regles.test.mjs                  # règles : 19 contrôles
node --test tests/securite.test.mjs                # session, jetons, origine
node --test tests/coquille.test.mjs                # fichiers gardés hors ligne
BASE=https://ppl.y-factor.fr MOT_DE_PASSE=… node --test api/test-api.mjs
```

Le dernier, celui de l'API, n'écrit rien sans `ECRITURES=1` : on peut le
lancer contre le serveur réel. Le contrôle principal des règles rejoue la
feuille de poules du 16 septembre et retrouve exactement les points reportés
dans le fichier. Les types se vérifient avec `npm ci && npm run types`.

GitHub Actions rejoue tout cela à chaque envoi, plus ShellCheck sur les
scripts et l'API complète, écritures comprises, sur une base de contrôle.

## Ce qui reste ouvert

- Les réponses de David (barème au-delà de 17 joueurs, soirées spéciales,
  autres formats) ; les points `À CONFIRMER` sont marqués dans `web/js/regles.js`.
- Sauvegarde : la sauvegarde de nuit du VPS prend toutes les bases, donc
  `ppl` aussi (rien à déclarer). À vérifier une fois dans le manifeste du
  lendemain de l'installation.
- Si la maquette devient l'outil du club : livraison automatique depuis
  GitHub, avec une recette avant la production, comme Biblio.
