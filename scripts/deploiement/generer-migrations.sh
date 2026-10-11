#!/usr/bin/env bash
# Produit deploiement/01-migrations.sql : toutes les migrations de
# supabase/migrations, dans l'ordre, en UNE transaction, pour le SQL Editor du
# tableau de bord Supabase (sans terminal).
#
# La table d'historique est remplie avec EXACTEMENT ce qu'écrit
# `supabase db push` (CLI 2.120.0) : les instructions découpées par la CLI
# elle-même, relues dans une base jetable où la vraie CLI a appliqué les
# migrations. Un futur `db push` ne les rejouera donc pas.
#
# Usage : bash scripts/deploiement/generer-migrations.sh
# Prérequis : PostgreSQL local démarré, rôle superuser (voir CLAUDE.md), réseau npm.
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$RACINE"
JETABLE="hdecor_cli_$$"
URL="postgresql://${PGUSER:-root}:${PGPASSWORD:-dev-local}@127.0.0.1:5432/$JETABLE"
SORTIE="deploiement/01-migrations.sql"
trap 'dropdb --if-exists "$JETABLE" >/dev/null 2>&1 || true' EXIT

createdb "$JETABLE"
psql -X -q -v ON_ERROR_STOP=1 -d "$JETABLE" -f tests/db/shim_supabase.sql >/dev/null
npx --yes supabase@2.120.0 db push --db-url "$URL" --yes >/dev/null

mapfile -t FICHIERS < <(ls supabase/migrations/*.sql | sort)
[ "$(psql -X -At -d "$JETABLE" -c 'select count(*) from supabase_migrations.schema_migrations')" = "${#FICHIERS[@]}" ] \
  || { echo "La CLI n'a pas enregistré toutes les migrations." >&2; exit 1; }

{
  cat <<'ENTETE'
-- =============================================================================
-- H'DECOR : déploiement initial du schéma (Supabase, SQL Editor)
-- FICHIER GÉNÉRÉ par scripts/deploiement/generer-migrations.sh : ne pas modifier.
--
-- Contenu : les migrations de supabase/migrations, dans l'ordre, en UNE seule
-- transaction (tout passe ou rien ne change), puis leur enregistrement dans
-- supabase_migrations.schema_migrations (mêmes colonnes et mêmes valeurs que
-- `supabase db push` 2.120.0). Pas de seed.sql (il n'y en a pas).
--
-- À exécuter UNE fois, sur un projet VIDE, dans SQL Editor (rôle postgres).
-- Une seconde exécution est refusée dès la première ligne.
-- =============================================================================

begin;

do $garde$
declare
  v_deja boolean := to_regclass('public.organisations') is not null;
begin
  -- Requête dynamique : la table d'historique peut ne pas exister encore.
  if not v_deja and to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select exists (select 1 from supabase_migrations.schema_migrations where version <= ''20261019000100'')' into v_deja;
  end if;
  if v_deja then
    raise exception 'Schéma H''DECOR déjà présent : ce script ne s''applique qu''à un projet vide.';
  end if;
end
$garde$;

ENTETE
  for f in "${FICHIERS[@]}"; do
    printf '\n-- =============================================================================\n'
    printf -- '-- Migration %s\n' "$(basename "$f")"
    printf -- '-- =============================================================================\n\n'
    cat "$f"
    printf '\n'
  done
  cat <<'HISTO'

-- =============================================================================
-- Historique des migrations (comme `supabase db push` 2.120.0)
-- =============================================================================

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;

HISTO
  psql -X -At -d "$JETABLE" -c "select format('insert into supabase_migrations.schema_migrations (version, name, statements) values (%L, %L, %L::text[]);', version, name, statements) from supabase_migrations.schema_migrations order by version"
  cat <<'FIN'

commit;

-- Contrôle (à lancer après) : 27 lignes attendues.
-- select version, name from supabase_migrations.schema_migrations order by version;
FIN
} > "$SORTIE"
echo "Écrit : $SORTIE ($(wc -c < "$SORTIE") octets, ${#FICHIERS[@]} migrations)."
