#!/usr/bin/env bash
# Numérotation sous concurrence : 60 sessions PostgreSQL simultanées émettent
# chacune une facture ; 10 d'entre elles annulent leur transaction (ROLLBACK)
# après avoir obtenu un numéro. Attendu : exactement 50 numéros FAC-AAAA-0001
# à FAC-AAAA-0050, sans trou ni doublon.
set -euo pipefail
DB=${DB:-hdecor_test}
ORG=aaaaaaaa-0000-0000-0000-00000000000a
USR=aaaaaaaa-0000-0000-0000-000000000001

psql -q -X -v ON_ERROR_STOP=1 -d "$DB" <<SQL
insert into auth.users (id, email) values ('$USR', 'a@test');
insert into public.organisations (id, nom) values ('$ORG', 'Org A');
insert into public.membres values ('$ORG', '$USR', 'proprietaire');
insert into public.parametres_entreprise (organisation_id, raison_sociale) values ('$ORG', 'Org A');
insert into public.clients (id, organisation_id, nom) values ('aaaaaaaa-0000-0000-0000-0000000c0001', '$ORG', 'Client');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, '$ORG', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 10000, 0, 10000,
  '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000
from generate_series(1, 60) i;
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
select '$ORG', ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 1, 'Prestation', 10000, 'u', 10000, 0, 10000
from generate_series(1, 60) i;
SQL

for i in $(seq 1 60); do
  ID="00000000-0000-0000-0000-$(printf '%012d' "$i")"
  if [ "$i" -le 10 ]; then FIN=rollback; else FIN=commit; fi
  psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null <<SQL &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$USR';
select public.emettre_facture('$ID', '{}', '{}', '{}', '$ORG/f.pdf', repeat('a', 64));
select pg_sleep(random() * 0.05);
$FIN;
SQL
done
wait

psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET 1
do $$
declare
  v_annee text := extract(year from public.aujourd_hui_paris())::text;
  v_nb int; v_distincts int; v_min int; v_max int; v_brouillons int;
begin
  select count(*), count(distinct numero),
         min(split_part(numero, '-', 3)::int), max(split_part(numero, '-', 3)::int)
    into v_nb, v_distincts, v_min, v_max
  from public.factures where statut = 'emise';
  select count(*) into v_brouillons from public.factures where statut = 'brouillon';
  if v_nb <> 50 or v_distincts <> 50 or v_min <> 1 or v_max <> 50 or v_brouillons <> 10 then
    raise exception 'ÉCHEC numérotation : % émises, % distinctes, de % à %, % brouillons',
      v_nb, v_distincts, v_min, v_max, v_brouillons;
  end if;
  if exists (select 1 from public.factures where statut = 'emise' and numero not like 'FAC-' || v_annee || '-____') then
    raise exception 'ÉCHEC format de numéro';
  end if;
  raise notice 'OK numérotation concurrente : 60 sessions simultanées, 10 annulées -> 50 numéros FAC-%-0001 à FAC-%-0050, sans trou ni doublon', v_annee, v_annee;
end $$;
SQL

# -----------------------------------------------------------------------------
# Course à l'émission : deux acomptes de 60,00 € émis EN MÊME TEMPS sur un
# devis accepté de 100,00 €. Attendu : un seul passe (verrou sur le devis).
# -----------------------------------------------------------------------------
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$USR';
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, acompte_pct_bp,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('dddddddd-0000-0000-0000-000000000001', '$ORG', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 6000,
  10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('$ORG', 'dddddddd-0000-0000-0000-000000000001', 1, 'X', 10000, 'u', 10000, 0, 10000);
select public.emettre_devis('dddddddd-0000-0000-0000-000000000001', '{}', '{}', '{}', '$ORG/dc.pdf', repeat('d', 64));
select public.signer_devis_sur_place('dddddddd-0000-0000-0000-000000000001', 'Client Test', 'Bon pour accord',
  '$ORG/sig/c.png', repeat('d', 64), '{}', '10.0.0.1', 'test');
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
select ('eeeeeeee-0000-0000-0000-00000000000' || i)::uuid, '$ORG', 'acompte', 'aaaaaaaa-0000-0000-0000-0000000c0001',
  'dddddddd-0000-0000-0000-000000000001', 30, 'franchise', 6000, 6000, 0, 6000,
  '[{"taux_bp":0,"base_ht_cents":6000,"tva_cents":0}]', 6000
from generate_series(1, 2) i;
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
select '$ORG', ('eeeeeeee-0000-0000-0000-00000000000' || i)::uuid, 1, 'Acompte', 10000, 'u', 6000, 0, 6000
from generate_series(1, 2) i;
commit;
SQL

for i in 1 2; do
  psql -q -X -d "$DB" -o /dev/null <<SQL 2>/dev/null &
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$USR';
select public.emettre_facture('eeeeeeee-0000-0000-0000-00000000000$i', '{}', '{}', '{}', '$ORG/c$i.pdf', repeat('e', 64));
select pg_sleep(0.3);
commit;
SQL
done
wait

psql -X -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
\set QUIET 1
do $$
declare v int;
begin
  select count(*) into v from public.factures
  where devis_id = 'dddddddd-0000-0000-0000-000000000001' and statut = 'emise';
  if v <> 1 then
    raise exception 'ÉCHEC course à l''émission : % acomptes de 60,00 émis sur un devis de 100,00', v;
  end if;
  raise notice 'OK course à l''émission : 2 acomptes de 60,00 simultanés sur un devis de 100,00 -> 1 seul émis';
end $$;
SQL

# -----------------------------------------------------------------------------
# Course avoir / finale (audit chef-de-projet, passe 6) : un avoir sur un
# acompte et une finale qui DÉDUIT cet acompte, émis au même instant, dans
# les deux ordres. Attendu : un seul des deux passe, invariants respectés.
# -----------------------------------------------------------------------------
ICI="$(cd "$(dirname "$0")" && pwd)"
psql -q -X -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f "$ICI/verif.sql"
ENTETE="set role authenticated; set request.jwt.claim.sub = '$USR';"
q() { psql -X -qtA -d "$DB" -c "$ENTETE $1" | tail -1; }
for ordre in avoir_dabord finale_dabord; do
  D=$(q "select verif.devis(null, 100000)")
  A=$(q "select verif.fac('acompte', '$D', null, 30000)")
  AVOIR="select verif.essai(format('select verif.avoir(%L, ''correction'', 30000)', '$A'::text));"
  FINALE="select verif.essai(format('select verif.fac(''finale'', %L, null, 100000, array[%L::uuid])', '$D'::text, '$A'::text));"
  if [ "$ordre" = avoir_dabord ]; then P=$AVOIR; S=$FINALE; else P=$FINALE; S=$AVOIR; fi
  psql -X -qtA -d "$DB" -c "$ENTETE" -c "begin; $P select pg_sleep(1.5); commit;" > /dev/null &
  sleep 0.5
  timeout 20 psql -X -qtA -d "$DB" -c "$ENTETE $S" > /dev/null
  wait
  N=$(q "select count(*) from public.factures where statut = 'emise' and ((type = 'finale' and devis_id = '$D') or (type = 'avoir' and facture_origine_id = '$A'))")
  if [ "$N" != "1" ]; then
    echo "ÉCHEC course avoir / finale ($ordre) : $N émissions au lieu d'une" >&2
    exit 1
  fi
done
# Course émission de devis / changement du client du chantier (audit sécurité,
# passe 6) : le changement de client doit attendre l'émission, puis être refusé.
CH=$(q "insert into public.chantiers (organisation_id, client_id, nom) values ('$ORG', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Course') returning id")
q "insert into public.clients (id, organisation_id, nom) values ('aaaaaaaa-0000-0000-0000-0000000c0009', '$ORG', 'Autre') on conflict do nothing returning id" > /dev/null
DV=$(q "insert into public.devis (organisation_id, client_id, chantier_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva) values ('$ORG', 'aaaaaaaa-0000-0000-0000-0000000c0001', '$CH', 30, 'franchise', 10000, 0, 10000, '[{\"taux_bp\":0,\"base_ht_cents\":10000,\"tva_cents\":0}]') returning id")
q "insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents) values ('$ORG', '$DV', 1, 'X', 10000, 'u', 10000, 0, 10000) returning id" > /dev/null
psql -X -qtA -d "$DB" -c "$ENTETE" -c "begin; select public.emettre_devis('$DV', '{}', '{}', '{}', '$ORG/dcourse.pdf', repeat('c', 64)); select pg_sleep(1.5); commit;" > /dev/null &
sleep 0.5
psql -X -qtA -d "$DB" -c "$ENTETE update public.chantiers set client_id = 'aaaaaaaa-0000-0000-0000-0000000c0009' where id = '$CH'" > /dev/null 2>&1 || true   # refus attendu
wait
C=$(q "select client_id from public.chantiers where id = '$CH'")
if [ "$C" != "aaaaaaaa-0000-0000-0000-0000000c0001" ]; then
  echo "ÉCHEC course émission / client du chantier : le client a changé malgré le devis émis" >&2
  exit 1
fi
echo "NOTICE:  OK course émission / client du chantier : changement de client refusé après l'émission"

V=$(q "select coalesce(string_agg(invariant || ' : ' || violations, ' | '), '') from verif.invariants() where violations > 0")
if [ -n "$V" ]; then
  echo "ÉCHEC invariants après les courses : $V" >&2
  exit 1
fi
echo "NOTICE:  OK course avoir / finale : dans les deux ordres, une seule émission ; invariants I1 à I9 respectés"
