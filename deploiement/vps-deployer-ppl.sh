#!/usr/bin/env bash
# =========================================================================
# Déployeur de PPL — installé en /usr/local/bin/deployer-ppl.
#
# Reçoit le paquet (tar.gz) sur l'entrée standard :
#
#     ssh root@195.110.35.206 /usr/local/bin/deployer-ppl < paquet.tar.gz
#
# C'est livrer-ppl.sh qui fabrique le paquet et l'envoie. Le jour où une
# chaîne GitHub prendra le relais, une clef bridée par
#     command="/usr/local/bin/deployer-ppl"
# dans authorized_keys suffira : la commande demandée arrive alors dans
# SSH_ORIGINAL_COMMAND, comparée à une liste fermée, jamais interprétée.
#
# L'ORDRE COMPTE, ET LA PRODUCTION N'EST TOUCHÉE QU'À LA FIN :
#   1. contrôler le paquet ;
#   2. PRÉPARER la nouvelle version À CÔTÉ (/opt/ppl-api.nouveau, avec ses
#      dépendances ; /var/www/ppl.nouveau) — un échec ici laisse la
#      production intacte, ancien code ET anciennes dépendances ;
#   3. sauvegarder la base, appliquer le schéma, amorcer si la base est vide ;
#   4. BASCULER par deux renommages, garder la version d'avant ;
#   5. redémarrer et vérifier. Après la bascule, TOUT échec — service muet,
#      interruption — remet la version d'avant.
#
# Corrigé le 17/10/2026 après relecture : la première version écrivait le
# nouveau code par-dessus l'ancien avant d'installer ses dépendances ; un
# « npm ci » raté laissait une production à moitié remplacée, qui ne serait
# plus repartie au redémarrage suivant.
# =========================================================================

set -uo pipefail
umask 022
cd / || exit 1
# Une coupure SSH ne doit pas tuer le script au milieu de la bascule : on
# ignore SIGPIPE (les messages se perdent, le journal reste).
trap '' PIPE

JOURNAL=/var/log/deploiement-ppl.log
ENVF=/etc/ppl/env
RACINE_API=/opt/ppl-api
RACINE_WEB=/var/www/ppl
SAUVEGARDES=/var/backups/ppl
SERVICE=ppl-api
COMPTE=ppl-api
BASE=ppl
SITE=ppl.y-factor.fr
MOI=/usr/local/bin/deployer-ppl

tracer() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "${JOURNAL}"; }

BASCULE=0
TRAVAIL=""

# Remet la version d'avant (après la bascule seulement).
revenir() {
  [ "${BASCULE}" -eq 1 ] || return 0
  BASCULE=0
  echo "  ...     retour à la version précédente"
  if [ -d "${RACINE_API}.precedent" ]; then
    rm -rf "${RACINE_API}.echec" && mv "${RACINE_API}" "${RACINE_API}.echec" && mv "${RACINE_API}.precedent" "${RACINE_API}"
  fi
  if [ -d "${RACINE_WEB}.precedent" ]; then
    rm -rf "${RACINE_WEB}.echec" && mv "${RACINE_WEB}" "${RACINE_WEB}.echec" && mv "${RACINE_WEB}.precedent" "${RACINE_WEB}"
  fi
  systemctl restart "${SERVICE}" 9>&-
  sleep 3
  if curl -sf --max-time 5 "http://127.0.0.1:${PORT:-0}/api/sante" >/dev/null 2>&1; then
    echo "          version précédente remise en service"
  else
    echo "          ATTENTION la version précédente ne répond pas non plus : journalctl -u ${SERVICE}"
  fi
}

echec() {
  echo "  ECHEC   $1"
  tracer "ECHEC $1"
  revenir
  exit 1
}

nettoyer() {
  [ -n "${TRAVAIL}" ] && rm -rf "${TRAVAIL}"
  rm -rf "${RACINE_API}.nouveau" "${RACINE_WEB}.nouveau"
}
trap nettoyer EXIT
# Ctrl-C, coupure, arrêt : on SORT (et donc on revient en arrière si la
# bascule a eu lieu), au lieu de continuer sans dossier de travail.
trap 'echec "livraison interrompue"' INT TERM HUP

demande="${SSH_ORIGINAL_COMMAND:-deployer-ppl}"
tracer "demande=[${demande}]"
case "${demande}" in
  "deployer-ppl"|"/usr/local/bin/deployer-ppl"|"deployer ppl") ;;
  "sante")
      systemctl is-active "${SERVICE}" >/dev/null && echo "${SERVICE}:active" || echo "${SERVICE}:inactive"
      exit 0 ;;
  *)  tracer "REFUSE"; echo "Commande non autorisée." >&2; exit 1 ;;
esac

# Une seule livraison à la fois. Le verrou tient tant que le descripteur 9
# est ouvert : les commandes qui lancent des processus durables le ferment
# (« 9>&- »), pour qu'aucun d'eux ne garde le verrou après la livraison.
exec 9>/run/deployer-ppl.lock
flock -n 9 || { echo "  ECHEC   une autre livraison de PPL est en cours"; exit 1; }

[ -f "${ENVF}" ] || echec "${ENVF} absent : lancer d'abord installer-ppl.sh"
PORT=$(sed -n 's/^PORT=//p' "${ENVF}")
PGPASS=$(sed -n 's/^PGPASSWORD=//p' "${ENVF}")
PGPORT_PPL=$(sed -n 's/^PGPORT=//p' "${ENVF}")
PGPORT_PPL=${PGPORT_PPL:-5432}
[ -n "${PORT}" ] && [ -n "${PGPASS}" ] || echec "${ENVF} incomplet (PORT ou PGPASSWORD manquant)"

TRAVAIL=$(mktemp -d)
chmod 700 "${TRAVAIL}"

echo "== Déploiement de PPL =="

# --- 1. Le paquet ----------------------------------------------------------
cat > "${TRAVAIL}/paquet.tar.gz"
taille=$(stat -c %s "${TRAVAIL}/paquet.tar.gz")
[ "${taille}" -gt 1000 ] || echec "paquet vide ou tronqué (${taille} octets)"
[ "${taille}" -lt 52428800 ] || echec "paquet de plus de 50 Mo : ce n'est pas celui attendu"
liste=$(tar -tzf "${TRAVAIL}/paquet.tar.gz" 2>/dev/null) || echec "paquet illisible"
# Aucun chemin absolu, aucun « .. » : le paquet ne sort pas de son dossier.
if printf '%s\n' "${liste}" | grep -qE '(^/|(^|/)\.\.(/|$))'; then echec "chemin suspect dans le paquet"; fi
mkdir -p "${TRAVAIL}/c"
tar -xzf "${TRAVAIL}/paquet.tar.gz" -C "${TRAVAIL}/c" --no-same-owner --no-same-permissions || echec "extraction"
C="${TRAVAIL}/c"
# Aucun lien : un lien dans web/ serait suivi par Caddy et servirait des
# fichiers pris ailleurs sur le serveur.
if [ -n "$(find "${C}" -type l -print -quit)" ] || [ -n "$(find "${C}" -type f -links +1 -print -quit)" ]; then
  echec "le paquet contient des liens : refusé"
fi
echo "  paquet reçu : $((taille / 1024)) ko"

for attendu in api/server.js api/package.json api/package-lock.json api/amorcer.mjs web/index.html web/js/app.js db/01-schema.sql; do
  [ -f "${C}/${attendu}" ] || echec "fichier attendu absent du paquet : ${attendu}"
done
# On demande à server.js ce qu'il importe, plutôt que de tenir une liste à
# la main qui vieillirait en silence. Zéro module trouvé est une erreur.
modules=$(grep -aoE "from '\./[A-Za-z0-9_.-]+\.mjs'" "${C}/api/server.js" | sed "s|.*'\./||; s|'\$||" | sort -u)
[ -n "${modules}" ] || echec "aucun module importé lisible dans server.js"
for m in ${modules}; do [ -f "${C}/api/${m}" ] || echec "server.js importe api/${m}, absent du paquet"; done
node --check "${C}/api/server.js" || echec "server.js ne se lit pas"
echo "  contenu conforme ($(echo "${modules}" | wc -l) modules, $(find "${C}/db" -name '*.sql' | wc -l) fichiers de schéma)"

# --- 2. Préparer la nouvelle version, à côté -------------------------------
rm -rf "${RACINE_API}.nouveau" "${RACINE_WEB}.nouveau"
rsync -a --exclude node_modules "${C}/api/" "${RACINE_API}.nouveau/" || echec "préparation de l'API"
# npm ci : exactement les versions du verrou. --ignore-scripts : aucune
# dépendance n'exécute de code à l'installation (pg n'en a pas besoin).
( cd "${RACINE_API}.nouveau" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error ) \
  >"${TRAVAIL}/npm.log" 2>&1 || { tail -5 "${TRAVAIL}/npm.log"; echec "installation des dépendances (la production n'a pas été touchée)"; }
[ -f "${RACINE_API}.nouveau/.version" ] || date -u '+livre-%Y-%m-%dT%H:%MZ' > "${RACINE_API}.nouveau/.version"
chown -R root:root "${RACINE_API}.nouveau"
chmod -R u=rwX,go=rX "${RACINE_API}.nouveau"
rsync -a "${C}/web/" "${RACINE_WEB}.nouveau/" || echec "préparation des pages"
chown -R root:root "${RACINE_WEB}.nouveau"
chmod -R u=rwX,go=rX "${RACINE_WEB}.nouveau"
VERSION=$(cat "${RACINE_API}.nouveau/.version")
echo "  nouvelle version prête à côté ($(find "${RACINE_WEB}.nouveau" -type f | wc -l) pages, ${VERSION})"

# --- 3. Sauvegarde, schéma, amorce -----------------------------------------
install -d -m 700 -o root -g root "${SAUVEGARDES}"
SAUVEGARDE="${SAUVEGARDES}/avant-livraison-$(date +%Y%m%d-%H%M%S).dump"
# La redirection est faite par root, exprès : postgres produit le contenu,
# root écrit le fichier dans un dossier que postgres ne peut pas lire.
# shellcheck disable=SC2024
if sudo -u postgres pg_dump -Fc -d "${BASE}" > "${SAUVEGARDE}" 2>"${TRAVAIL}/dump.err" && [ -s "${SAUVEGARDE}" ]; then
  chmod 600 "${SAUVEGARDE}"
  echo "  base sauvegardée : $(du -h "${SAUVEGARDE}" | cut -f1) -> ${SAUVEGARDE}"
else
  tail -3 "${TRAVAIL}/dump.err" | sed 's/^/         /'
  rm -f "${SAUVEGARDE}"
  echec "sauvegarde de la base impossible : aucune modification tentée"
fi
# On garde les dix dernières.
find "${SAUVEGARDES}" -maxdepth 1 -name 'avant-livraison-*.dump' -printf '%T@ %p\n' \
  | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f

for fichier in $(find "${C}/db" -maxdepth 1 -name '*.sql' | sort); do
  nom=$(basename "${fichier}")
  if PGPASSWORD="${PGPASS}" psql -h 127.0.0.1 -p "${PGPORT_PPL}" -U ppl -d "${BASE}" -v ON_ERROR_STOP=1 -q -f "${fichier}" \
       >"${TRAVAIL}/schema.log" 2>&1; then
    echo "  schéma appliqué : ${nom}"
  else
    tail -6 "${TRAVAIL}/schema.log" | sed 's/^/         /'
    echo "         le code n'a pas été touché ; pour revenir à la base d'avant :"
    echo "           sudo -u postgres pg_restore --clean --if-exists -d ${BASE} ${SAUVEGARDE}"
    echec "schéma refusé (${nom})"
  fi
done

# L'AMORCE NE TOURNE QUE SUR UNE BASE VIDE, ET SOUS LE COMPTE DU SERVICE.
# Lancée en root à chaque livraison, elle chargeait pg et ses dépendances
# hors du bac à sable : une dépendance piégée aurait eu root sur tout le VPS.
if [ -f "${C}/amorce/amorce.json" ]; then
  nb=$(sudo -u postgres psql -tAd "${BASE}" -c "select count(*) from joueurs" 2>/dev/null | tr -d '[:space:]')
  if [ "${nb}" = "0" ]; then
    systemd-run --quiet --wait --pipe --collect 9>&- \
      -p User="${COMPTE}" -p Group="${COMPTE}" \
      -p EnvironmentFile="${ENVF}" -p WorkingDirectory="${RACINE_API}.nouveau" \
      -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes \
      "$(command -v node)" amorcer.mjs /dev/stdin < "${C}/amorce/amorce.json" \
      || echec "amorce refusée (la production n'a pas été touchée)"
  else
    echo "  amorce non utilisée : la base contient déjà ${nb:-?} joueurs"
  fi
fi

# --- 4. Bascule --------------------------------------------------------------
rm -rf "${RACINE_API}.precedent" "${RACINE_WEB}.precedent"
[ -d "${RACINE_API}" ] && { mv "${RACINE_API}" "${RACINE_API}.precedent" || echec "mise de côté de l'API en place"; }
[ -d "${RACINE_WEB}" ] && { mv "${RACINE_WEB}" "${RACINE_WEB}.precedent" || echec "mise de côté des pages en place"; }
BASCULE=1
mv "${RACINE_API}.nouveau" "${RACINE_API}" || echec "bascule de l'API"
mv "${RACINE_WEB}.nouveau" "${RACINE_WEB}" || echec "bascule des pages"
echo "  bascule faite (version précédente gardée à côté)"

# --- 5. Redémarrage et vérification -----------------------------------------
systemctl restart "${SERVICE}" 9>&- || echec "redémarrage du service"
pret=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -sf --max-time 5 "http://127.0.0.1:${PORT}/api/sante" >/dev/null 2>&1; then pret=1; break; fi
done
if [ "${pret}" -ne 1 ]; then
  journalctl -u "${SERVICE}" -n 15 --no-pager | sed 's/^/         /'
  echec "le service ne répond pas"
fi
BASCULE=0
echo "  service actif"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${SITE}/" 2>/dev/null)
case "${code}" in
  200) echo "  https://${SITE} : 200" ;;
  000) echo "  A SUIVRE https://${SITE} ne répond pas encore en HTTPS (DNS ou certificat en cours)" ;;
  *)   echo "  A VOIR   https://${SITE} : ${code}" ;;
esac

# --- 6. Le déployeur se met à jour lui-même --------------------------------
#
# Sans cela, une correction de ce script ne tournerait jamais : il n'est
# posé qu'une fois par l'installeur. On remplace APRÈS un déploiement réussi,
# et seulement si le nouveau se lit. « install » crée un nouveau fichier :
# le bash en cours continue de lire l'ancien.
NOUVEAU="${C}/deploiement/vps-deployer-ppl.sh"
if [ -f "${NOUVEAU}" ] && ! cmp -s "${NOUVEAU}" "${MOI}"; then
  if bash -n "${NOUVEAU}"; then
    cp -a "${MOI}" "${MOI}.precedent" 2>/dev/null
    install -m 700 -o root -g root "${NOUVEAU}" "${MOI}"
    echo "  déployeur mis à jour (précédent : ${MOI}.precedent)"
  else
    echo "  ATTENTION nouveau déployeur illisible : l'ancien est conservé"
  fi
fi

tracer "SUCCES ${VERSION}"
echo "== Déploiement terminé =="
