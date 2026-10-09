#!/usr/bin/env bash
# Recrée une base de test vierge, prépare l'environnement Supabase puis
# applique les migrations.
#   AUTH=shim    (défaut) : shim minimal (tests/db/shim_supabase.sql)
#   AUTH=gotrue  : VRAI schéma auth migré par GoTrue (binaire de la pile
#                  locale, voir scripts/supabase-sans-docker/demarrer.sh)
set -euo pipefail
DB=${DB:-hdecor_test}
AUTH=${AUTH:-shim}
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/../.." && pwd)"
psql -q -X -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
if [ "$AUTH" = gotrue ]; then
  PGOPTIONS='-c client_min_messages=warning' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$RACINE/scripts/supabase-sans-docker/base_supabase.sql" -o /dev/null
  GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:auth-admin-dev@127.0.0.1:5432/$DB?search_path=auth" \
  GOTRUE_DB_MIGRATIONS_PATH="$RACINE/.supabase-local/bin/migrations" \
  GOTRUE_JWT_SECRET=secret-de-test-0123456789-0123456789 API_EXTERNAL_URL=http://localhost GOTRUE_SITE_URL=http://localhost \
    "$RACINE/.supabase-local/bin/auth" migrate > /dev/null 2>&1
else
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$ICI/shim_supabase.sql"
fi
for f in "$RACINE"/supabase/migrations/*.sql; do
  PGOPTIONS='-c client_min_messages=warning' psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$f" -o /dev/null
done
echo "Base $DB prête ($AUTH)."
