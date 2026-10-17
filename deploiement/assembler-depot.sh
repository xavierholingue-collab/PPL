#!/usr/bin/env bash
# =========================================================================
# Assemble le dépôt git ~/dev/ppl à partir du dossier OneDrive, et l'envoie
# sur GitHub (dépôt privé xavierholingue-collab/PPL).
#
# Même montage que Biblio et Y-Factor : OneDrive est la SOURCE, le dépôt vit
# dans WSL. OneDrive synchronise tout ce qu'il voit, .git compris, et une
# synchronisation survenue pendant l'écriture d'un objet corrompt le dépôt.
#
# SENS UNIQUE : OneDrive -> dépôt. Ne jamais éditer dans ~/dev/ppl.
#
# À LANCER DEPUIS LE TERMINAL UBUNTU (WSL) :
#
#   bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/assembler-depot.sh "ce qui a changé"
#
# Avec un message : assemble, vérifie, puis commit et envoi sur GitHub.
# Sans message    : assemble, vérifie et montre ce qui partirait, sans rien
#                   envoyer.
#
# AVANT TOUT ENVOI, deux vérifications qui arrêtent tout :
#   - aucun secret (mot de passe, secret de session, clef privée) ;
#   - aucune donnée du club : ni l'amorce, ni le nom d'un seul joueur.
# =========================================================================

set -uo pipefail

SOURCE=${SOURCE:-/mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app}
DEPOT=${DEPOT:-${HOME}/dev/ppl}
DISTANT=${DISTANT:-https://github.com/xavierholingue-collab/PPL.git}
MESSAGE=${1:-}

ok()    { printf '  OK      %s\n' "$1"; }
echec() { printf '  ECHEC   %s\n' "$1"; exit 1; }

echo "== Assemblage du dépôt PPL =="
echo "   source : ${SOURCE}"
echo "   dépôt  : ${DEPOT}"
echo

[ -f "${SOURCE}/api/server.js" ] || echec "dossier source introuvable : ${SOURCE}"
[ "$(cd "${SOURCE}" && pwd -P)" != "$(cd "${DEPOT}" 2>/dev/null && pwd -P)" ] \
  || echec "la source et le dépôt sont le même dossier"
for outil in git rsync; do
  command -v "${outil}" >/dev/null 2>&1 || echec "${outil} introuvable : sudo apt install ${outil}"
done

# --- 1. Le dépôt local, cloné la première fois ------------------------------
if [ ! -d "${DEPOT}/.git" ]; then
  if [ -e "${DEPOT}" ] && [ -n "$(ls -A "${DEPOT}" 2>/dev/null)" ]; then
    echec "${DEPOT} existe et n'est pas un dépôt git : le déplacer d'abord"
  fi
  mkdir -p "$(dirname "${DEPOT}")"
  git clone --quiet "${DISTANT}" "${DEPOT}" || echec "clonage impossible : ${DISTANT} (accès GitHub ?)"
  ok "dépôt cloné dans ${DEPOT}"
fi
cd "${DEPOT}" || exit 1
origine=$(git remote get-url origin 2>/dev/null)
[ "${origine}" = "${DISTANT}" ] || echec "${DEPOT} pointe vers « ${origine} », pas vers ${DISTANT}"
# Un dépôt tout neuf n'a pas encore de branche : ce sera « main ».
git rev-parse --verify --quiet HEAD >/dev/null || git symbolic-ref HEAD refs/heads/main

# Se mettre au niveau de GitHub d'abord : un commit poussé d'ailleurs ne doit
# pas être écrasé par l'envoi qui suit.
if [ -n "$(git ls-remote --heads origin main 2>/dev/null)" ]; then
  git fetch --quiet origin main || echec "GitHub injoignable"
  git merge --ff-only --quiet origin/main 2>/dev/null \
    || echec "le dépôt local et GitHub ont divergé : à regarder avec « git -C ${DEPOT} status »"
fi
ok "dépôt à jour de GitHub"

# --- 2. La recopie, dans un seul sens ------------------------------------------
#
# Les exclusions protègent aussi ce qui est déjà dans le dépôt : .git n'est
# jamais touché. Les droits sont fixés (644, dossiers 755) : vus de WSL, les
# fichiers OneDrive paraissent tous exécutables, et git le noterait.
rsync -rlpt --delete --chmod=D755,F644 \
  --exclude='.git/' --exclude='node_modules/' --exclude='amorce/' \
  --exclude='*.tar.gz' --exclude='*.dump' --exclude='.env' --exclude='.env.*' \
  --exclude='*:Zone.Identifier' --exclude='desktop.ini' --exclude='Thumbs.db' \
  "${SOURCE}/" "${DEPOT}/" || echec "recopie"
ok "recopie : $(git ls-files --others --cached --exclude-standard | wc -l) fichiers"

# --- 3. Ni secret, ni donnée du club -------------------------------------------
echo
echo "-- Ni secret ni donnée du club dans le dépôt --"

# Une VALEUR littérale, pas le code qui manipule un secret :
# « MOT_DE_PASSE=${ancien_mdp} » est une variable, pas un mot de passe.
secrets=$(grep -rlIE --exclude-dir=.git --exclude-dir=node_modules \
  -e '^(MOT_DE_PASSE|SECRET_SESSION|PGPASSWORD)=[^$"'"'"'[:space:]…]{8,}' \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' . 2>/dev/null | head -5)
if [ -n "${secrets}" ]; then
  echo "  ALERTE valeur secrète trouvée dans :"
  printf '%s\n' "${secrets}" | sed 's/^/          /'
  echec "rien n'a été envoyé"
fi
ok "aucun secret"

amorces=$(find . -path ./.git -prune -o -name 'amorce.json' -print 2>/dev/null | head -3)
# La phrase d'avertissement de l'amorce, coupée en deux ici : écrite d'un
# seul tenant, ce script se dénoncerait lui-même.
marqueur="CE FICHIER CONTIENT DES DONN""ÉES DE PERSONNES"
marque=$(grep -rlI --exclude-dir=.git --exclude-dir=node_modules -e "${marqueur}" . 2>/dev/null | head -3)
if [ -n "${amorces}${marque}" ]; then
  echo "  ALERTE données du club dans :"
  printf '%s\n' "${amorces}" "${marque}" | sed '/^$/d; s/^/          /'
  echec "rien n'a été envoyé"
fi

# Les noms viennent de l'amorce elle-même, qui reste sur le poste : un nom
# recopié par mégarde dans un commentaire ou un test est trouvé ici.
if [ -f "${SOURCE}/amorce/amorce.json" ]; then
  noms=$(mktemp)
  # Mots entiers, et pas les surnoms de moins de quatre lettres (« Ju ») :
  # on les retrouverait par hasard dans n'importe quelle empreinte.
  grep -o '"nom": *"[^"]*"' "${SOURCE}/amorce/amorce.json" | sed 's/^"nom": *"//; s/"$//' \
    | awk 'length($0) >= 4' | sort -u > "${noms}"
  fuites=$(grep -rlIwF --exclude-dir=.git --exclude-dir=node_modules --exclude=package-lock.json \
    -f "${noms}" . 2>/dev/null | head -5)
  nb=$(wc -l < "${noms}")
  rm -f "${noms}"
  if [ -n "${fuites}" ]; then
    echo "  ALERTE nom d'un joueur du club dans :"
    printf '%s\n' "${fuites}" | sed 's/^/          /'
    echec "rien n'a été envoyé"
  fi
  ok "aucun nom de joueur du club (${nb} noms recherchés)"
else
  ok "aucune amorce (pas de liste de noms à rechercher)"
fi

# --- 4. Ce qui part ---------------------------------------------------------------
echo
echo "-- Changements --"
if [ -z "$(git status --porcelain)" ]; then
  ok "rien de nouveau : GitHub a déjà cet état du dossier"
  echo
  echo "== FIN =="
  exit 0
fi
git status --short | head -30
if [ -z "${MESSAGE}" ]; then
  echo
  echo "  Rien n'est envoyé sans message. Pour envoyer :"
  echo "    bash ${SOURCE}/deploiement/assembler-depot.sh \"ce qui a changé\""
  echo
  echo "== FIN =="
  exit 0
fi

git config user.email >/dev/null 2>&1 \
  || echec "git ne connaît pas ton identité : git config --global user.name \"…\" && git config --global user.email \"…\""
git add -A || echec "git add"
git commit --quiet -m "${MESSAGE}" || echec "commit"
git push --quiet origin HEAD:main || echec "envoi refusé par GitHub (le commit reste en local et repartira au prochain envoi)"
ok "envoyé : $(git log -1 --format='%h %s')"
echo "  contrôles : https://github.com/xavierholingue-collab/PPL/actions"
echo
echo "== FIN =="
