-- =============================================================================
-- H'DECOR, Phase 6 : pilotage (tableau de bord, planning, comptabilité simplifiée).
--   1. Justificatifs comptables : déposés par le SERVEUR seulement (type
--      vérifié sur le contenu), jamais remplacés ni supprimés depuis le navigateur.
--   2. Registre des achats : date de création, catégories par défaut.
--   3. Matériel : date de création, rattachement contrôlé.
--   4. Planning : un événement « chantier » porte son chantier.
--   5. Livre des recettes : net HT / TTC de la facture (part HT d'un
--      encaissement pour une entreprise soumise à la TVA).
-- =============================================================================

-- 1. Justificatifs -----------------------------------------------------------------
drop policy hdecor_ajout on storage.objects;
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in ('photos', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_maj on storage.objects;
create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_suppr on storage.objects;
create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)));

-- Chemin d'un justificatif : dossier de SA dépense.
alter table public.depenses add constraint justificatif_chemin_depense check (
  justificatif_chemin is null
  or justificatif_chemin ~ ('^' || organisation_id::text || '/depenses/' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'));

-- 2. Registre des achats -----------------------------------------------------------
alter table public.depenses add column updated_at timestamptz not null default now();
create trigger depenses_updated_at before update on public.depenses
  for each row execute function public.maj_updated_at();
-- Rentabilité par chantier (achats du chantier) et clé étrangère vers chantiers.
create index depenses_chantier_idx on public.depenses (organisation_id, chantier_id) where chantier_id is not null;

-- Catégories par défaut (modifiables), créées une fois pour l'organisation de la session.
create or replace function public.initialiser_categories_depenses()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.membres where user_id = auth.uid() limit 1);
begin
  if v_org is null then
    raise exception 'Organisation introuvable.' using errcode = 'P0002';
  end if;
  insert into public.categories_depenses (organisation_id, libelle)
  select v_org, l from unnest(array['Peintures et enduits', 'Petit matériel et consommables', 'Outillage',
                                    'Carburant et déplacements', 'Assurances', 'Téléphone et internet', 'Autres']) l
  where not exists (select 1 from public.categories_depenses c where c.organisation_id = v_org)
  on conflict (organisation_id, libelle) do nothing;
end;
$$;
revoke execute on function public.initialiser_categories_depenses() from public, anon;
grant execute on function public.initialiser_categories_depenses() to authenticated;

-- 3. Matériel ----------------------------------------------------------------------
alter table public.materiel add column created_at timestamptz not null default now();
alter table public.materiel add constraint materiel_libelle_non_vide check (btrim(libelle) <> '');

-- 4. Planning ----------------------------------------------------------------------
alter table public.evenements add constraint evenement_chantier_porte_son_chantier
  check (type <> 'chantier' or chantier_id is not null);
alter table public.evenements add constraint evenement_titre_non_vide check (btrim(titre) <> '');
-- Un événement ne s'étend pas sur plus d'un an (saisie erronée).
alter table public.evenements add constraint evenement_duree_raisonnable check (fin <= debut + interval '366 days');
create index rappels_org_echeance_idx on public.rappels (organisation_id, statut, echeance);

-- 5. Livre des recettes ------------------------------------------------------------
-- Colonnes ajoutées en fin de vue : net de la facture (TTC et HT, acomptes
-- déduits), régime, et part HT de l'encaissement (assujetti ; À VÉRIFIER avec le comptable).
create or replace view public.v_livre_recettes with (security_invoker = true) as
select p.organisation_id, p.date_paiement,
       case when f.type = 'avoir' then -p.montant_cents else p.montant_cents end as montant_cents,
       case when f.type = 'avoir' then 'remboursement' else 'encaissement' end as nature,
       p.mode, p.reference,
       f.numero as facture_numero, f.id as facture_id,
       coalesce(f.copie_client ->> 'nom_affiche', '') as client,
       p.id as paiement_id,
       f.net_a_payer_cents as facture_net_ttc_cents,
       f.total_ht_cents - coalesce((select sum((d ->> 'ht')::bigint) from jsonb_array_elements(f.deductions) d), 0)::bigint
         as facture_net_ht_cents,
       f.regime_tva,
       f.chantier_id,
       e.part_ht_cents
from public.paiements p
join public.factures f on f.id = p.facture_id
cross join lateral (
  select case when f.type = 'avoir' then -p.montant_cents else p.montant_cents end as m,
         f.total_ht_cents - coalesce((select sum((d ->> 'ht')::bigint) from jsonb_array_elements(f.deductions) d), 0) as ht,
         f.net_a_payer_cents as ttc
) n
cross join lateral (
  -- Part HT en CUMULÉ (assujetti) : arrondi(cumul × HT/TTC) − arrondi(cumul précédent × HT/TTC).
  -- Les parts d'une facture totalisent exactement son HT net, quel que soit le nombre de paiements.
  select case when f.regime_tva = 'franchise' or n.ttc <= 0 then n.m
         else (round(c.cumul::numeric * n.ht / n.ttc) - round((c.cumul - n.m)::numeric * n.ht / n.ttc))::bigint end as part_ht_cents
  from (select sum(case when f2.type = 'avoir' then -p2.montant_cents else p2.montant_cents end) as cumul
        from public.paiements p2 join public.factures f2 on f2.id = p2.facture_id
        where p2.facture_id = p.facture_id
          and (p2.date_paiement, p2.created_at, p2.id) <= (p.date_paiement, p.created_at, p.id)) c
) e;
