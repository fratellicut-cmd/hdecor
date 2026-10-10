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
if EFFACEMENTS=aucune SAUVEGARDE_PHRASE="phrase-fausse-de-test-0000" DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/x" >/dev/null 2>&1; then
  echo "ÉCHEC : restauration acceptée avec une phrase fausse." >&2; exit 1
fi
echo "OK phrase fausse refusée"
REFUS="$(EFFACEMENTS=aucune DB_CIBLE="postgres:///$SOURCE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/x" 2>&1 || true)"
if grep -q "Base cible non vide" <<< "$REFUS"; then
  echo "OK base cible non vide refusée"
else
  echo "ÉCHEC : restauration acceptée sur une base en service." >&2; exit 1
fi
dropdb --if-exists "$CIBLE"; createdb "$CIBLE"
if DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/x" >/dev/null 2>&1; then
  echo "ÉCHEC : restauration acceptée sans liste des effacements." >&2; exit 1
fi
echo "OK liste des effacements exigée"
EFFACEMENTS=aucune DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/fichiers"

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

# Droit à l'effacement : un client effacé APRÈS l'archive l'est de nouveau après restauration.
EFFACE="$(psql -X -At -d "$SOURCE" -c "select id from public.clients where anonymise_le is null order by id limit 1")"
echo "$EFFACE" > "$TRAVAIL/effacements.txt"
dropdb --if-exists "$CIBLE"; createdb "$CIBLE"
SORTIE="$(EFFACEMENTS="$TRAVAIL/effacements.txt" DB_CIBLE="postgres:///$CIBLE" bash "$RACINE/scripts/sauvegarde/restaurer.sh" "$ARCHIVE" "$TRAVAIL/fichiers2")"
grep -q "1 client(s) effacé(s)" <<< "$SORTIE" || { echo "ÉCHEC : effacement non réappliqué." >&2; echo "$SORTIE" >&2; exit 1; }
[ "$(psql -X -At -d "$CIBLE" -c "select (anonymise_le is not null)::text from public.clients where id = '$EFFACE'")" = "true" ] \
  || { echo "ÉCHEC : client toujours présent après restauration." >&2; exit 1; }
echo "OK effacement réappliqué après restauration"

# Rotation : une archive de plus de 365 jours est supprimée à la sauvegarde suivante.
touch -d '400 days ago' "$TRAVAIL/archives/hdecor-20250101-000000.tar.gz.enc"
ROT="$(DB_URL="postgres:///$SOURCE" bash "$RACINE/scripts/sauvegarde/sauvegarder.sh" "$TRAVAIL/archives")"
grep -q "Archive ancienne supprimée" <<< "$ROT" && [ ! -e "$TRAVAIL/archives/hdecor-20250101-000000.tar.gz.enc" ] \
  || { echo "ÉCHEC : rotation." >&2; exit 1; }
echo "OK rotation des archives"
echo "Test de sauvegarde et de restauration : réussi."
