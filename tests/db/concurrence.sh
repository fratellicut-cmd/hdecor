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
insert into auth.users values ('$USR', 'a@test');
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
