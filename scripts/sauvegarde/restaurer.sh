#!/usr/bin/env bash
# =============================================================================
# Restauration d'une sauvegarde chiffrée (sauvegarder.sh) dans une base VIDE.
#
#   DB_CIBLE=postgres://… SAUVEGARDE_PHRASE=… bash scripts/sauvegarde/restaurer.sh <archive> [dossier-fichiers]
#
# - La base cible doit être vide (aucune table dans le schéma public) : jamais
#   d'écrasement d'une base en service.
# - Fichiers : redéposés dans le stockage (NEXT_PUBLIC_SUPABASE_URL et
#   SUPABASE_SERVICE_ROLE_KEY de la CIBLE), ou seulement extraits dans
#   [dossier-fichiers] si ce dossier est donné (contrôle, test de restauration).
# - Contrôle final : présence de chaque fichier et empreinte SHA-256 de chaque
#   document émis ou signé, comparée à celle enregistrée en base.
# =============================================================================
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
ARCHIVE="${1:?archive manquante}"
: "${DB_CIBLE:?DB_CIBLE manquante}"
: "${SAUVEGARDE_PHRASE:?SAUVEGARDE_PHRASE manquante}"
EXTRAIRE="${2:-}"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

TABLES=$(psql -X -At -v ON_ERROR_STOP=1 -d "$DB_CIBLE" -c "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$TABLES" = "0" ] || { echo "Base cible non vide ($TABLES tables) : restauration refusée." >&2; exit 1; }

echo "Déchiffrement…"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_PHRASE -in "$ARCHIVE" | tar -C "$TRAVAIL" -xzf -
echo "Sauvegarde du $(cat "$TRAVAIL/date.txt")."
echo "Base…"
pg_restore --exit-on-error --no-password -d "$DB_CIBLE" "$TRAVAIL/base.dump"
# La liste des fichiers est relue dans la base RESTAURÉE : elle doit être identique.
psql -X -q -v ON_ERROR_STOP=1 -d "$DB_CIBLE" -f "$ICI/fichiers.sql" > "$TRAVAIL/fichiers-restaures.csv"
cmp -s "$TRAVAIL/fichiers.csv" "$TRAVAIL/fichiers-restaures.csv" || { echo "La base restaurée ne référence pas les mêmes fichiers." >&2; exit 1; }
if [ -n "$EXTRAIRE" ]; then
  mkdir -p "$EXTRAIRE"
  cp -R "$TRAVAIL/fichiers/." "$EXTRAIRE/"
  node "$ICI/fichiers.mjs" verifier "$TRAVAIL/fichiers-restaures.csv" "$EXTRAIRE"
else
  node "$ICI/fichiers.mjs" importer "$TRAVAIL/fichiers-restaures.csv" "$TRAVAIL/fichiers"
  node "$ICI/fichiers.mjs" exporter "$TRAVAIL/fichiers-restaures.csv" "$TRAVAIL/relus"
  node "$ICI/fichiers.mjs" verifier "$TRAVAIL/fichiers-restaures.csv" "$TRAVAIL/relus"
fi
echo "Restauration terminée et contrôlée."
