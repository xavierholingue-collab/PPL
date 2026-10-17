#!/usr/bin/env bash
# =========================================================================
# Installe PPL sur le VPS, puis fait la première livraison.
#
# À LANCER DEPUIS LE TERMINAL UBUNTU (WSL), une seule fois :
#
#     bash /mnt/c/Users/xavie/OneDrive/Doc/Claude/Projects/PPL/app/deploiement/installer-ppl.sh
#
# Ce que ça fait, dans l'ordre :
#   1. envoie l'installeur et le déployeur sur le serveur ;
#   2. y crée la base, le rôle, le compte de service, l'unité systemd et le
#      bloc Caddy de ppl.y-factor.fr (sans toucher aux autres sites) ;
#   3. livre l'application (livrer-ppl.sh).
#
# À la fin s'affiche le mot de passe organisateur, une seule fois.
# Le DNS (plan-dns-ppl.json) peut être posé avant ou après.
# =========================================================================

set -uo pipefail

SERVEUR=${SERVEUR:-root@195.110.35.206}
ICI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# Le port de l'API est choisi sur le serveur : le premier libre à partir de
# 3020. « PORT=3045 bash installer-ppl.sh » en impose un.
PORT_DEMANDE=${PORT:-}
if [ -n "${PORT_DEMANDE}" ] && ! [[ "${PORT_DEMANDE}" =~ ^[0-9]{4,5}$ ]]; then
  echo "  ECHEC PORT=${PORT_DEMANDE} : un numéro de port est attendu"; exit 1
fi

echo "== PPL sur le VPS (${SERVEUR}) =="
echo

echo "-- 1. Envoi de l'installeur et du déployeur --"
ssh "${SERVEUR}" 'umask 077; cat > /root/installer-ppl.sh' < "${ICI}/vps-installer-ppl.sh" || { echo "  ECHEC envoi de l'installeur"; exit 1; }
ssh "${SERVEUR}" 'umask 077; cat > /root/deployer-ppl.source' < "${ICI}/vps-deployer-ppl.sh" || { echo "  ECHEC envoi du déployeur"; exit 1; }
echo "  OK"
echo

echo "-- 2. Installation sur le serveur --"
ssh -t "${SERVEUR}" "PORT_DEMANDE=${PORT_DEMANDE} bash /root/installer-ppl.sh; code=\$?; rm -f /root/installer-ppl.sh; exit \$code" \
  || { echo; echo "  L'installation s'est arrêtée : rien n'a été livré. Le message ci-dessus dit pourquoi."; exit 1; }
echo

echo "-- 3. Première livraison, avec les données du fichier de David --"
AVEC_AMORCE=1 bash "${ICI}/livrer-ppl.sh"
