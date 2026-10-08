#!/usr/bin/env bash
# Tests du schéma sur un vrai PostgreSQL : séquentiels puis concurrence.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"
export DB=${DB:-hdecor_test}
bash "$ICI/reset.sh"
psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$ICI/schema.test.sql"
bash "$ICI/reset.sh"
bash "$ICI/concurrence.sh"
