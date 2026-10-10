#!/usr/bin/env bash
# Contrôle du jeu de démonstration (base locale hdecor_demo) : invariants des
# montants et des numéros (tests/db/verif.sql, dans une transaction annulée :
# rien n'est écrit), et marquage « démo » de toutes les données d'identité.
set -euo pipefail
RACINE="$(cd "$(dirname "$0")/../.." && pwd)"
DB=hdecor_demo
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" <<SQL
begin;
\i $RACINE/tests/db/verif.sql
do \$\$
declare v text;
begin
  select string_agg(invariant || ' : ' || violations, ' | ') into v from verif.invariants() where violations > 0;
  if v is not null then raise exception 'Invariants violés : %', v; end if;
  -- Numérotation sans trou par série et par année.
  select string_agg(serie, ', ') into v from (
    select left(numero, 8) as serie, count(*) as n, max(right(numero, 4)::int) as dernier
    from (select numero from public.devis where numero is not null
          union all select numero from public.factures where numero is not null) x
    group by left(numero, 8)) s where n <> dernier;
  if v is not null then raise exception 'Numérotation avec trou : %', v; end if;
  -- Identités marquées comme fictives.
  if exists (select 1 from public.parametres_entreprise where raison_sociale not like '%DÉMO%' or mentions_pied not like '%DÉMONSTRATION%') then
    raise exception 'Entreprise non marquée DÉMO.';
  end if;
  if exists (select 1 from public.clients where anonymise_le is null and coalesce(email, '') not like '%.invalid') then
    raise exception 'Client sans adresse email fictive (.invalid).';
  end if;
  raise notice 'Démo conforme : invariants respectés, numéros sans trou, données marquées fictives.';
end \$\$;
rollback;
SQL
