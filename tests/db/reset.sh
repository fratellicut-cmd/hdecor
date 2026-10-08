#!/usr/bin/env bash
# Recrée une base de test vierge, applique le shim Supabase puis les migrations.
set -euo pipefail
DB=${DB:-hdecor_test}
ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$ICI/../.."
psql -q -X -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$ICI/shim_supabase.sql"
for f in "$RACINE"/supabase/migrations/*.sql; do
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -f "$f" -o /dev/null
done
echo "Base $DB prête."
