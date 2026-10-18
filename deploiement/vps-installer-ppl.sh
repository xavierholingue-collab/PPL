#!/usr/bin/env bash
# =========================================================================
# Installe PPL (Ping Pong Loisir) sur le VPS, à côté de SupPerf, d'Adapsis
# et de Biblio — même pile que Biblio : Node sans Docker, PostgreSQL 18 de
# la machine, Caddy devant.
#
# S'EXÉCUTE SUR LE VPS, en root. Envoyé et lancé par installer-ppl.sh
# depuis le terminal Ubuntu.
#
# NE TOUCHE À RIEN D'EXISTANT : ni les autres bases, ni les autres blocs
# Caddy. Vérifie en fin de course que les sites déjà servis répondent comme
# avant ; sinon, retour arrière du Caddyfile.
#
# IDEMPOTENT : on peut le relancer. Les secrets déjà posés sont conservés
# (un mot de passe régénéré à chaque passage déconnecterait David sans
# prévenir, et casserait l'accès à la base).
# =========================================================================

set -uo pipefail

SITE=${SITE:-ppl.y-factor.fr}
# Le port de l'API se choisit plus bas (section 2) : celui d'une installation
# précédente, sinon PORT_DEMANDE (transmis par installer-ppl.sh), sinon le
# premier port libre à partir de 3020.
PORT_DEMANDE=${PORT_DEMANDE:-}
COMPTE=ppl-api
SERVICE=ppl-api
BASE=ppl
ROLE=ppl
# La grappe PostgreSQL 18 de la machine (depuis la bascule du 6 septembre
# 2026, l'ancienne grappe 15 dort sur 5433).
PG_PORT=${PG_PORT:-5432}
ENVF=/etc/ppl/env
RACINE_API=/opt/ppl-api
RACINE_WEB=/var/www/ppl
CADDYFILE=/etc/caddy/Caddyfile
MARQUE_DEBUT='# >>> ppl : gere par vps-installer-ppl.sh'
MARQUE_FIN='# <<< ppl'

ok()    { printf '  OK      %s\n' "$1"; }
info()  { printf '  ...     %s\n' "$1"; }
afaire(){ printf '  A FAIRE %s\n' "$1"; }
echec() { printf '  ECHEC   %s\n' "$1"; exit 1; }

cd / || exit 1
echo "== Installation de PPL sur ${SITE} =="
[ "$(id -u)" = "0" ] || echec "à lancer en root"

# --- 0. Ce qui tourne avant ----------------------------------------------
# Les sites témoins : une liste fixe, plus TOUS les noms servis par le
# Caddyfile (hors PPL). Une liste figée oubliait par exemple xavier-holingue.eu.
declare -A avant
TEMOINS=(https://supperf.io https://y-factor.fr https://lisia.y-factor.fr https://api.y-factor.fr/sante https://app.y-factor.fr)
if [ -f "${CADDYFILE}" ]; then
  while read -r nom; do
    [ -n "${nom}" ] && [ "${nom}" != "${SITE}" ] && TEMOINS+=("https://${nom}")
  done < <(grep -E '^[a-z0-9][a-z0-9.,: -]*\{[[:space:]]*$' "${CADDYFILE}" | tr -d '{' | tr ',' '\n' \
           | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -E '^[a-z0-9-]+(\.[a-z0-9-]+)+$' | sort -u)
fi
mapfile -t TEMOINS < <(printf '%s\n' "${TEMOINS[@]}" | awk '!vu[$0]++')
for u in "${TEMOINS[@]}"; do
  avant["$u"]=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u" 2>/dev/null)
done
echo "  sites témoins avant : $(for u in "${TEMOINS[@]}"; do printf '%s=%s ' "${u#https://}" "${avant[$u]}"; done)"

# --- 1. Outils -------------------------------------------------------------
echo
echo "-- Outils --"
for outil in node npm psql pg_dump sudo rsync caddy curl openssl ss flock systemd-run; do
  command -v "${outil}" >/dev/null 2>&1 || echec "${outil} introuvable"
done
NODE=$(command -v node)
version=$(node --version | sed 's/^v//' | cut -d. -f1)
[ "${version}" -ge 22 ] || echec "node ${version} : PPL demande Node 22 ou plus"
ok "node $(node --version), npm $(npm --version), $(psql --version | head -1)"
sudo -u postgres psql -tAc 'select 1' >/dev/null 2>&1 || echec "PostgreSQL ne répond pas (sudo -u postgres psql)"

# --- 2. Le port ------------------------------------------------------------
#
# Un port est pris s'il est écouté, ou s'il est cité par la configuration
# d'une autre application (Caddy, unités systemd, fichiers d'environnement) :
# une application arrêtée ce jour-là garde son port.
raison=
port_pris() {
  local nom
  if [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]; then
    nom=$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'users:(("[^"]*' | head -1 | cut -d'"' -f2)
    raison="écouté${nom:+ par ${nom}}"; return 0
  fi
  if grep -rqsE ":$1([^0-9]|\$)" /etc/caddy; then raison="cité dans la configuration de Caddy"; return 0; fi
  if grep -rqsE "(^|[^0-9])$1([^0-9]|\$)" /etc/systemd/system; then raison="cité par une unité systemd"; return 0; fi
  if grep -rqsE "PORT=[\"']?$1([^0-9]|\$)" /etc; then raison="cité dans un fichier de /etc"; return 0; fi
  return 1
}

ancien_port=$(sed -n 's/^PORT=//p' "${ENVF}" 2>/dev/null)
if [ -n "${ancien_port}" ]; then
  # Réinstallation : PPL garde le port que Caddy et le service connaissent.
  PORT=${ancien_port}
  occupant=$(ss -ltnpH "sport = :${PORT}" 2>/dev/null)
  if [ -n "${occupant}" ] && ! systemctl is-active --quiet "${SERVICE}"; then
    echo "  ${occupant}"
    echec "le port ${PORT} de PPL est tenu par un autre service"
  fi
  if [ -n "${PORT_DEMANDE}" ] && [ "${PORT_DEMANDE}" != "${PORT}" ]; then
    info "port ${PORT_DEMANDE} demandé, mais PPL garde le port ${PORT} de l'installation précédente"
  fi
  ok "port ${PORT}, celui de l'installation précédente"
elif [ -n "${PORT_DEMANDE}" ]; then
  [[ "${PORT_DEMANDE}" =~ ^[0-9]{4,5}$ ]] || echec "port demandé invalide : ${PORT_DEMANDE}"
  if port_pris "${PORT_DEMANDE}"; then echec "le port ${PORT_DEMANDE} est déjà pris (${raison})"; fi
  PORT=${PORT_DEMANDE}
  ok "port ${PORT} libre, retenu pour PPL"
else
  PORT=
  for p in $(seq 3020 3099); do
    if port_pris "${p}"; then info "port ${p} déjà pris (${raison})"; continue; fi
    PORT=${p}; break
  done
  [ -n "${PORT}" ] || echec "aucun port libre de 3020 à 3099 : relancer avec PORT=xxxx devant la commande"
  ok "port ${PORT} libre, retenu pour PPL"
fi

# --- 3. Le compte de service ----------------------------------------------
if id -u "${COMPTE}" >/dev/null 2>&1; then
  ok "compte ${COMPTE} déjà présent"
else
  useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "${COMPTE}" \
    || echec "création du compte ${COMPTE}"
  ok "compte ${COMPTE} créé (sans interpréteur, sans dossier personnel)"
fi

# --- 4. Base et rôle -------------------------------------------------------
echo
echo "-- Base ${BASE} --"
ancien_pg=$(sed -n 's/^PGPASSWORD=//p' "${ENVF}" 2>/dev/null)
MDP_PG=${ancien_pg:-$(openssl rand -hex 24)}

# LE MOT DE PASSE PASSE PAR L'ENTRÉE STANDARD (\set), jamais en argument :
# un argument se lit dans « ps » et finit dans le journal de sudo. Il est
# hexadécimal, donc sans souci d'échappement.
role_existe=$(sudo -u postgres psql -tAc "select 1 from pg_roles where rolname = '${ROLE}'" 2>/dev/null)
if [ "${role_existe}" = "1" ]; then verbe=alter; else verbe=create; fi
{ printf '\\set mdp %s\n' "${MDP_PG}"; cat <<'SQL'
:verbe role :"role" with login nosuperuser nocreatedb nocreaterole nobypassrls password :'mdp';
SQL
} | sudo -u postgres psql -q -v ON_ERROR_STOP=1 -v role="${ROLE}" -v verbe="${verbe}" >/dev/null \
  || echec "${verbe} du rôle ${ROLE}"
if [ "${verbe}" = "alter" ]; then info "rôle ${ROLE} existant, droits vérifiés"
else ok "rôle ${ROLE} créé (ni superutilisateur, ni BYPASSRLS)"; fi

base_existe=$(sudo -u postgres psql -tAc "select 1 from pg_database where datname = '${BASE}'" 2>/dev/null)
if [ "${base_existe}" = "1" ]; then
  info "base ${BASE} déjà présente"
else
  sudo -u postgres createdb -O "${ROLE}" -E UTF8 "${BASE}" || echec "création de la base"
  ok "base ${BASE} créée"
fi

# --- 5. Cloisonnement ------------------------------------------------------
#
# PostgreSQL accorde CONNECT à PUBLIC par défaut : sans ces révocations, le
# rôle ppl pourrait ouvrir les bases des autres applications.
echo
echo "-- Cloisonnement --"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 \
  -c "revoke connect on database ${BASE} from public" \
  -c "grant connect on database ${BASE} to ${ROLE}" >/dev/null || echec "droits de connexion"
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "${BASE}" \
  -c "revoke all on schema public from public" \
  -c "grant all on schema public to ${ROLE}" >/dev/null || echec "droits sur le schéma"
ok "seul le rôle ${ROLE} entre dans la base ${BASE}"

# Preuve, pas affirmation : on TENTE d'ouvrir chacune des autres bases.
# D'abord le témoin : par le même chemin que l'API (TCP local, mot de passe),
# le rôle doit ouvrir SA base. Sans ce témoin, un refus pour une tout autre
# raison (mauvais port, pg_hba) passerait pour un cloisonnement vérifié.
if ! PGPASSWORD="${MDP_PG}" psql -h 127.0.0.1 -p "${PG_PORT}" -U "${ROLE}" -d "${BASE}" -tAc 'select 1' >/dev/null 2>&1; then
  echec "le rôle ${ROLE} n'ouvre pas sa propre base par 127.0.0.1:${PG_PORT} : vérifier le port de la grappe 18 (pg_lsclusters) et pg_hba.conf"
fi
ok "témoin : le rôle ${ROLE} ouvre sa base par 127.0.0.1:${PG_PORT}"
fuite=0
for autre in $(sudo -u postgres psql -tAc "select datname from pg_database where datallowconn and datname not in ('postgres', 'template1', '${BASE}')"); do
  if PGPASSWORD="${MDP_PG}" psql -h 127.0.0.1 -p "${PG_PORT}" -U "${ROLE}" -d "${autre}" -tAc 'select 1' >/dev/null 2>&1; then
    echo "  ECHEC   le rôle ${ROLE} peut ouvrir la base ${autre}"
    echo "          correctif, après avoir vérifié qu'aucune application n'en dépend :"
    echo "            sudo -u postgres psql -c \"revoke connect on database ${autre} from public\""
    fuite=1
  else
    ok "accès à ${autre} refusé (vérifié)"
  fi
done
[ "${fuite}" -eq 0 ] || echec "cloisonnement en défaut : installation arrêtée, rien n'a été exposé"

# --- 6. Emplacements -------------------------------------------------------
echo
echo "-- Emplacements --"
install -d -m 755 -o root -g root "${RACINE_API}" "${RACINE_WEB}"
install -d -m 750 -o root -g "${COMPTE}" /etc/ppl
install -d -m 700 -o root -g root /var/backups/ppl
[ -f "${RACINE_WEB}/index.html" ] || printf '%s\n' \
  '<!doctype html><meta charset="utf-8"><title>Ping Pong Loisir</title><p>Installation en cours.' \
  > "${RACINE_WEB}/index.html"
chmod -R a+rX "${RACINE_WEB}"
ok "${RACINE_API} et ${RACINE_WEB} appartiennent à root : le service lit son code, il ne peut pas le réécrire"

# --- 7. Configuration ------------------------------------------------------
#
# LE MOT DE PASSE ORGANISATEUR est fabriqué une fois, dans un alphabet sans
# caractère ambigu (pas de 0/O, ni de 1/I/L) : il se tape sur un téléphone.
# 16 caractères parmi 31, soit environ 79 bits.
echo
echo "-- Configuration --"
ancien_mdp=$(sed -n 's/^MOT_DE_PASSE=//p' "${ENVF}" 2>/dev/null)
ancien_secret=$(sed -n 's/^SECRET_SESSION=//p' "${ENVF}" 2>/dev/null)
nouveau_mdp=0
if [ -z "${ancien_mdp}" ]; then
  brut=$(LC_ALL=C tr -dc 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' < /dev/urandom | head -c 16)
  ancien_mdp="${brut:0:4}-${brut:4:4}-${brut:8:4}-${brut:12:4}"
  nouveau_mdp=1
fi
[ -n "${ancien_secret}" ] || ancien_secret=$(openssl rand -base64 48 | tr -d '\n')

umask 077
cat > "${ENVF}.nouveau" <<ENV
# PPL — configuration de l'API. Écrit par vps-installer-ppl.sh.
# Lisible par le service (groupe ${COMPTE}), modifiable par root seulement.
PORT=${PORT}
HOTE=127.0.0.1
PGHOST=127.0.0.1
PGPORT=${PG_PORT}
PGUSER=${ROLE}
PGPASSWORD=${MDP_PG}
PGDATABASE=${BASE}
MOT_DE_PASSE=${ancien_mdp}
SECRET_SESSION=${ancien_secret}
ENVIRONNEMENT=maquette
DERRIERE_PROXY=1
ORIGINE=https://${SITE}
ENV
umask 022
chown "root:${COMPTE}" "${ENVF}.nouveau" && chmod 640 "${ENVF}.nouveau" && mv "${ENVF}.nouveau" "${ENVF}"
ok "${ENVF} écrit (root:${COMPTE}, 640)"

# --- 8. Le service ---------------------------------------------------------
#
# FILTRE D'APPELS SYSTÈME : ÉPROUVÉ AVANT D'ÊTRE POSÉ. On lance Node une fois
# sous les mêmes restrictions ; s'il ne tient pas, l'unité est écrite sans
# ce filtre (et on le dit) plutôt qu'avec un service qui ne démarrerait pas.
FILTRE="SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM"
if systemd-run --quiet --wait --pipe --collect -p User="${COMPTE}" \
     -p SystemCallFilter=@system-service -p SystemCallErrorNumber=EPERM \
     -p IPAddressDeny=any -p IPAddressAllow=localhost -p ProtectProc=invisible \
     "${NODE}" -e "require('http').createServer().listen(0,'127.0.0.1',function(){this.close();console.log('ok')})" \
     2>/dev/null | grep -qx ok; then
  ok "Node tient sous le filtre d'appels système et le pare-feu de l'unité"
else
  FILTRE="# SystemCallFilter retiré : Node n'a pas tenu sous ce filtre lors de l'essai d'installation."
  echo "  A VOIR  Node ne tient pas sous SystemCallFilter=@system-service : unité posée sans ce filtre"
fi

cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=API PPL (Ping Pong Loisir)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=${COMPTE}
Group=${COMPTE}
WorkingDirectory=${RACINE_API}
EnvironmentFile=${ENVF}
ExecStart=${NODE} server.js
Restart=on-failure
RestartSec=5
UMask=0077

# Le service ne peut rien écrire sur le disque, rien élever, rien charger.
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
RestrictSUIDSGID=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
# L'API ne parle qu'à Caddy et à PostgreSQL, tous deux sur la machine.
IPAddressDeny=any
IPAddressAllow=localhost
ProtectProc=invisible
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
${FILTRE}
# Le compilateur à la volée de Node écrit puis exécute de la mémoire :
# MemoryDenyWriteExecute le ferait tomber.
MemoryDenyWriteExecute=false

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "${SERVICE}" >/dev/null 2>&1
ok "unité ${SERVICE} installée (démarrée par le premier déploiement)"

# --- 9. Le déployeur -------------------------------------------------------
if [ -f /root/deployer-ppl.source ]; then
  install -m 700 -o root -g root /root/deployer-ppl.source /usr/local/bin/deployer-ppl
  rm -f /root/deployer-ppl.source
  ok "déployeur posé : /usr/local/bin/deployer-ppl"
else
  if [ -x /usr/local/bin/deployer-ppl ]; then
    info "déployeur déjà en place"
  else
    afaire "déployeur absent : relancer installer-ppl.sh"
  fi
fi

# --- 10. Le bloc Caddy -----------------------------------------------------
echo
echo "-- Caddy --"
[ -f "${CADDYFILE}" ] || echec "${CADDYFILE} introuvable"
SAUVE="${CADDYFILE}.avant-ppl-$(date +%Y%m%d-%H%M%S)"
cp -a "${CADDYFILE}" "${SAUVE}" || echec "sauvegarde du Caddyfile impossible"
ok "sauvegarde : ${SAUVE}"

# LE Caddyfile EST COMMUN À TOUS LES SITES. On ne retire l'ancien bloc
# que si ses deux marqueurs sont là, une seule fois chacun, dans l'ordre :
# sinon « sed » effacerait jusqu'à la fin du fichier, blocs des autres
# sites compris.
nb_debut=$(grep -cxF "${MARQUE_DEBUT}" "${CADDYFILE}")
nb_fin=$(grep -cxF "${MARQUE_FIN}" "${CADDYFILE}")
if [ "${nb_debut}" -eq 0 ] && [ "${nb_fin}" -eq 0 ]; then
  info "pas encore de bloc PPL"
elif [ "${nb_debut}" -eq 1 ] && [ "${nb_fin}" -eq 1 ] \
     && [ "$(grep -nxF "${MARQUE_DEBUT}" "${CADDYFILE}" | cut -d: -f1)" -lt "$(grep -nxF "${MARQUE_FIN}" "${CADDYFILE}" | cut -d: -f1)" ]; then
  sed -i "/^${MARQUE_DEBUT}$/,/^${MARQUE_FIN}$/d" "${CADDYFILE}"
  info "bloc précédent retiré"
else
  echec "marqueurs du bloc PPL abîmés dans ${CADDYFILE} (début : ${nb_debut}, fin : ${nb_fin}) : rien n'a été modifié, à corriger à la main"
fi

# Heredoc littéral : seuls les marqueurs @@…@@ sont remplacés ensuite.
sed -e "s/@@SITE@@/${SITE}/g" -e "s/@@PORT@@/${PORT}/g" -e "s/@@RACINE@@/${RACINE_WEB//\//\\/}/g" >> "${CADDYFILE}" <<'BLOC'
# >>> ppl : gere par vps-installer-ppl.sh
#
# PPL n'a AUCUN script ni style en ligne : la politique de contenu peut donc
# être stricte et fixe — pas d'empreintes à recalculer à chaque livraison.
# Ce bloc est réécrit EN ENTIER à chaque passage de l'installeur : ce qui
# doit survivre doit vivre dans le script, pas être ajouté ici à la main.
@@SITE@@ {
	encode zstd gzip

	handle /api/* {
		reverse_proxy 127.0.0.1:@@PORT@@
	}

	# Aucun fichier caché (.env, .git…) n'est servi, même déposé par erreur.
	@fichiers_caches path */.*
	handle @fichiers_caches {
		respond 404
	}

	handle {
		root * @@RACINE@@
		file_server
	}

	header {
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		Strict-Transport-Security "max-age=31536000"
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
		Cross-Origin-Opener-Policy "same-origin"
		# Maquette : pas d'indexation par les moteurs de recherche.
		X-Robots-Tag "noindex, nofollow"
		-Server
	}

	# Les pages évoluent à chaque livraison : pas de version figée en cache.
	@pages path / /index.html /sw.js /*.css /js/* /*.webmanifest
	header @pages Cache-Control "no-cache"
}
# <<< ppl
BLOC
ok "bloc ${SITE} ajouté"

if ! sortie=$(caddy validate --config "${CADDYFILE}" --adapter caddyfile 2>&1); then
  echo "  ECHEC validation :"; printf '%s\n' "${sortie}" | tail -8 | sed 's/^/         /'
  cp -a "${SAUVE}" "${CADDYFILE}"; echec "Caddyfile remis comme avant"
fi
ok "syntaxe valide"
if ! sortie=$(systemctl reload caddy 2>&1); then
  echo "  ECHEC rechargement :"; printf '%s\n' "${sortie}" | tail -6 | sed 's/^/         /'
  cp -a "${SAUVE}" "${CADDYFILE}"; systemctl reload caddy; echec "Caddyfile remis comme avant"
fi
ok "caddy rechargé"

# --- 11. Ce qui tournait avant tourne-t-il encore ? -----------------------
echo
echo "-- Sites témoins --"
sleep 3
degat=0
for u in "${TEMOINS[@]}"; do
  # Un écart isolé (site lent, redémarrage en cours) ne prouve rien : avant
  # de conclure, on redemande deux fois, à quelques secondes d'intervalle.
  for essai in 1 2 3; do
    apres=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$u" 2>/dev/null)
    [ "${apres}" = "${avant[$u]}" ] && break
    [ "${essai}" -lt 3 ] && sleep 4
  done
  if [ "${apres}" = "${avant[$u]}" ]; then ok "${u} : ${apres}, inchangé"
  else echo "  ECHEC   ${u} : ${avant[$u]} -> ${apres}"; degat=1; fi
done
if [ "${degat}" -eq 1 ]; then
  cp -a "${SAUVE}" "${CADDYFILE}"; systemctl reload caddy
  echec "un site existant a changé de comportement : Caddyfile remis comme avant"
fi

# --- 12. Bilan -------------------------------------------------------------
echo
resolu=$(getent hosts "${SITE}" | awk '{print $1}' | head -1)
if [ -z "${resolu}" ]; then
  afaire "${SITE} ne résout pas encore : appliquer plan-dns-ppl.json (le certificat suivra)"
else
  ok "${SITE} résout vers ${resolu}"
fi
info "API de PPL sur 127.0.0.1:${PORT}, derrière Caddy"
# La sauvegarde de nuit (/usr/local/bin/sauvegarder, cron de 3 h 45) balaie
# TOUTES les bases du serveur : rien à déclarer pour PPL, qui n'a aucun
# fichier de données hors de sa base. On le vérifie au lieu de le supposer.
if grep -q 'FROM pg_database' /usr/local/bin/sauvegarder 2>/dev/null; then
  ok "sauvegarde de nuit : la base « ${BASE} » est prise d'office (toutes les bases y passent)"
else
  afaire "vérifier que la sauvegarde de nuit prend la base « ${BASE} » (/etc/sauvegarde/applications.d/)"
fi

echo
echo "== FIN de l'installation =="
if [ "${nouveau_mdp}" -eq 1 ]; then
  echo
  echo "   MOT DE PASSE ORGANISATEUR (à transmettre à David, affiché une seule fois) :"
  echo
  echo "        ${ancien_mdp}"
  echo
  echo "   Pour le relire plus tard : sudo grep MOT_DE_PASSE ${ENVF}"
fi
