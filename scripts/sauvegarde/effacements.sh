#!/usr/bin/env bash
# Liste des clients EFFACÉS (anonymisés) de la base en service : identifiants
# seulement, aucune donnée personnelle. À tenir à jour hors des archives (par
# exemple à chaque sauvegarde) : après la restauration d'une archive plus
# ancienne, restaurer.sh réapplique ces effacements (EFFACEMENTS=<fichier>).
#
#   DB_URL=postgres://… bash scripts/sauvegarde/effacements.sh > effacements.txt
set -euo pipefail
: "${DB_URL:?DB_URL manquante}"
psql -X -At -v ON_ERROR_STOP=1 -d "$DB_URL" -c "select id from public.clients where anonymise_le is not null order by id"
