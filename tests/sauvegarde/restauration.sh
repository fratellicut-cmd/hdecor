#!/usr/bin/env bash
# Test de sauvegarde et de restauration (E4), sur la DÉMO locale :
#   npm run demo:pile && (serveur) && npm run demo:charger && bash tests/sauvegarde/restauration.sh
# Sauvegarde chiffrée de hdecor_demo, refus d'une phrase fausse et d'une base
# cible non vide, restauration dans une base neuve, puis : mêmes comptages
# table par table, invariants respectés, fichiers présents et empreintes
# SHA-256 des documents émis identiques. Base de test supprimée à la fin.
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE=hdecor_demo
CIBLE=hdecor_e2e_restau
set -a; . "$RACINE/.env.local"; set +a
[ "$(cat "$RACINE/.supabase-local/base-active")" = "$SOURCE" ] || { echo "La pile locale doit servir $SOURCE (npm run demo:pile)." >&2; exit 1; }
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"; dropdb --if-exists "$CIBLE" 2>/dev/null || true' EXIT
SAUVEGARDE_PHRASE="$(openssl rand -base64 24)"; export SAUVEGARDE_PHRASE

DB_URL="postgres:///$SOURCE" bash "$RACINE/scripts/sauvegarde/sauvegarder.sh" "$TRAVAIL/archives"
ARCHIVE="$(ls "$TRAVAIL"/archives/*.enc)"
if head -c 64 "$ARCHIVE" | grep -qa "PGDMP\|ustar"; then echo "ÉCHEC : archive non chiffrée." >&2; exit 1; fi

dropdb --if-exists "$CIBLE"; createdb "$CIBLE"
if SAUVEGARDE_PHRASE="phrase-fausse-de-test-0000" DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/x" >/dev/null 2>&1; then
  echo "ÉCHEC : restauration acceptée avec une phrase fausse." >&2; exit 1
fi
echo "OK phrase fausse refusée"
REFUS="$(DB_CIBLE="postgres:///$SOURCE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/x" 2>&1 || true)"
if grep -q "Base cible non vide" <<< "$REFUS"; then
  echo "OK base cible non vide refusée"
else
  echo "ÉCHEC : restauration acceptée sur une base en service." >&2; exit 1
fi
dropdb --if-exists "$CIBLE"; createdb "$CIBLE"
DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/fichiers"

comptes() {
  psql -X -At -d "$1" -c "select string_agg(format('select %L || '':'' || count(*) from public.%I', table_name, table_name), ' union all ' order by table_name)
                          from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'" \
    | psql -X -At -d "$1"
}
diff <(comptes "$SOURCE") <(comptes "$CIBLE") > /dev/null || { echo "ÉCHEC : comptages différents." >&2; diff <(comptes "$SOURCE") <(comptes "$CIBLE") >&2; exit 1; }
echo "OK mêmes comptages ($(comptes "$CIBLE" | wc -l) tables)"
psql -X -q -v ON_ERROR_STOP=1 -d "$CIBLE" <<SQL
begin;
\i $RACINE/tests/db/verif.sql
do \$\$ declare v text; begin
  select string_agg(invariant || ' : ' || violations, ' | ') into v from verif.invariants() where violations > 0;
  if v is not null then raise exception 'ÉCHEC invariants : %', v; end if;
end \$\$;
rollback;
SQL
echo "OK invariants respectés sur la base restaurée"
echo "Test de sauvegarde et de restauration : réussi."
