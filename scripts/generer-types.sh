#!/usr/bin/env bash
# Régénère src/lib/supabase/types-base.ts depuis la base locale (DB_URL).
# Le fichier n'est remplacé que si la génération réussit.
set -euo pipefail
: "${DB_URL:?DB_URL manquante : URL de la base locale hdecor_dev}"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
npx --yes supabase@2.120.0 gen types typescript --db-url "$DB_URL" --schema public > "$TMP"
test -s "$TMP"
mv "$TMP" "$RACINE/src/lib/supabase/types-base.ts"
trap - EXIT
echo "Types régénérés."
