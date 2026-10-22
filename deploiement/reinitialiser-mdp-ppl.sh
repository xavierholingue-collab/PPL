#!/usr/bin/env bash
# =========================================================================
# Mot de passe organisateur OUBLIÉ : revient à celui de l'installation.
#
# À LANCER DEPUIS LE TERMINAL UBUNTU (WSL) :
#
#     bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/reinitialiser-mdp-ppl.sh
#
# Le mot de passe choisi dans l'appli (onglet Organisateur) est effacé de la
# base ; celui de /etc/ppl/env, fabriqué à l'installation, vaut de nouveau,
# et s'affiche à l'écran. Toutes les sessions sont fermées. Ensuite, on peut
# en choisir un nouveau depuis l'appli.
# =========================================================================

set -uo pipefail

SERVEUR=${SERVEUR:-root@195.110.35.206}

echo "== Mot de passe organisateur de PPL : retour à celui de l'installation (${SERVEUR}) =="
# shellcheck disable=SC2016,SC1112 # texte exécuté sur le serveur tel quel ; apostrophes typographiques voulues
ssh -t "${SERVEUR}" '
  set -u
  # Table absente (version d’avant le 22/10/2026) : aucun mot de passe choisi
  # dans l’appli, c’est déjà celui de l’installation qui vaut.
  if [ -z "$(sudo -u postgres psql -tAqd ppl -c "select to_regclass(\$\$public.organisateur\$\$)")" ]; then
    echo "  OK      aucun mot de passe choisi dans l’appli : rien à effacer"
  else
    sudo -u postgres psql -qd ppl -v ON_ERROR_STOP=1 -c "delete from organisateur" \
      || { echo "  ECHEC   effacement en base : rien n’a changé"; exit 1; }
    echo "  OK      mot de passe choisi dans l’appli effacé"
  fi
  systemctl restart ppl-api || { echo "  ECHEC   redémarrage du service"; exit 1; }
  echo "  OK      service redémarré"
  echo
  echo "  Mot de passe organisateur : $(sed -n "s/^MOT_DE_PASSE=//p" /etc/ppl/env)"
  echo "  (minuscules et tirets indifférents ; à changer ensuite depuis l’appli si besoin)"
'
