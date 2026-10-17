#!/usr/bin/env bash
# =========================================================================
# Livre la version de PPL qui se trouve dans ce dossier.
#
# À LANCER DEPUIS LE TERMINAL UBUNTU (WSL), à chaque nouvelle version :
#
#     bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/livrer-ppl.sh
#
# Fabrique le paquet (api, web, db, déployeur, amorce), vérifie qu'il est
# complet, puis l'envoie au déployeur du serveur, qui sauvegarde la base,
# applique le schéma, pose le code et revient en arrière si le service ne
# répond pas.
#
# L'amorce (amorce/amorce.json, les données du fichier de David) ne part
# qu'avec la première livraison, faite par installer-ppl.sh (AVEC_AMORCE=1).
# Les livraisons suivantes ne la transportent plus ; et même présente, le
# serveur l'ignore dès que la base contient des joueurs.
# =========================================================================

set -uo pipefail

SERVEUR=${SERVEUR:-root@195.110.35.206}
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=$(cd "${ICI}/.." && pwd)
TRAVAIL=$(mktemp -d)
trap 'rm -rf "${TRAVAIL}"' EXIT INT TERM

echo "== Livraison de PPL =="

# Copie de travail : on n'écrit rien dans le dossier OneDrive.
mkdir -p "${TRAVAIL}/p/deploiement"
cp -r "${APP}/api" "${APP}/web" "${APP}/db" "${TRAVAIL}/p/" || { echo "  ECHEC copie"; exit 1; }
cp "${ICI}/vps-deployer-ppl.sh" "${TRAVAIL}/p/deploiement/"
if [ "${AVEC_AMORCE:-0}" = "1" ] && [ -f "${APP}/amorce/amorce.json" ]; then
  mkdir -p "${TRAVAIL}/p/amorce"
  cp "${APP}/amorce/amorce.json" "${TRAVAIL}/p/amorce/"
  echo "  avec l'amorce (première livraison)"
fi
rm -rf "${TRAVAIL}/p/api/node_modules"
find "${TRAVAIL}/p" -name '*:Zone.Identifier' -delete 2>/dev/null
# Le serveur refuse les liens ; autant le dire ici, avec le nom du fichier.
liens=$(find "${TRAVAIL}/p" -type l)
if [ -n "${liens}" ]; then
  echo "  ECHEC liens symboliques dans le dossier, refusés par le serveur :"
  while IFS= read -r lien; do printf '         %s\n' "${lien}"; done <<< "${liens}"
  exit 1
fi

# Une empreinte du contenu sert de numéro de version (le dossier n'est pas
# un dépôt git) : deux livraisons identiques portent le même numéro.
empreinte=$(cd "${TRAVAIL}/p" && find api web db -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-10)
printf 'v%s-%s\n' "$(date -u '+%Y%m%d-%H%M')" "${empreinte}" > "${TRAVAIL}/p/api/.version"

for attendu in api/server.js api/package-lock.json web/index.html db/01-schema.sql; do
  [ -f "${TRAVAIL}/p/${attendu}" ] || { echo "  ECHEC ${attendu} manque dans le dossier"; exit 1; }
done
if command -v node >/dev/null 2>&1; then
  for f in "${TRAVAIL}"/p/api/*.mjs "${TRAVAIL}"/p/api/server.js; do
    node --check "${f}" || { echo "  ECHEC ${f##*/} ne se lit pas"; exit 1; }
  done
  echo "  syntaxe vérifiée"
fi

tar -czf "${TRAVAIL}/paquet.tar.gz" -C "${TRAVAIL}/p" --owner=0 --group=0 . || { echo "  ECHEC paquet"; exit 1; }
echo "  paquet : $(du -h "${TRAVAIL}/paquet.tar.gz" | cut -f1), version $(cat "${TRAVAIL}/p/api/.version")"
echo

ssh "${SERVEUR}" /usr/local/bin/deployer-ppl < "${TRAVAIL}/paquet.tar.gz"
