-- =============================================================================
-- H'DECOR (Phase 2) : métré et calculateur de peinture.
--   1. Paramètres : porte par défaut (83 × 204 cm), formats de pots usuels.
--   2. Postes : type de produit (sans produit du catalogue), majoration de temps.
--   3. Éléments : conversion en m² (largeur développée, surface d'une unité).
--   4. Consommables (rouleaux, bâches, adhésif, abrasif) : lignes paramétrables.
--   5. Valeurs de départ du calcul, toutes « À VÉRIFIER », pour chaque organisation.
--   6. Suppression d'un chantier : seulement sans document, fichiers mis en
--      file de suppression (point B11 reporté de la Phase 1).
-- Les calculs restent dans src/domain ; la base ne stocke que la saisie.
-- =============================================================================

-- 1. Paramètres -----------------------------------------------------------------
alter table public.parametres_entreprise
  add column porte_largeur_mm integer not null default 830 check (porte_largeur_mm between 300 and 3000),
  add column porte_hauteur_mm integer not null default 2040 check (porte_hauteur_mm between 1000 and 4000),
  -- Formats proposés quand aucun produit du catalogue n'est choisi (ml).
  add column formats_pots_ml integer[] not null default array[1000, 2500, 5000, 10000, 15000]
    check (cardinality(formats_pots_ml) between 1 and 10 and 0 < all (formats_pots_ml) and 100000 >= all (formats_pots_ml));

-- 2. Postes ---------------------------------------------------------------------
alter table public.postes_travaux
  add column type_produit text check (type_produit is null or type_produit in (
    'sous_couche', 'impression', 'acrylique', 'glycero', 'laque', 'facade', 'lasure', 'vernis', 'enduit',
    'anti_humidite', 'anti_rouille', 'sous_couche_bloquante', 'autre')),
  -- Hauteur, mobilier, état du support : majoration du temps (20 % -> 2 000).
  add column majoration_temps_bp integer not null default 0 check (majoration_temps_bp between 0 and 50000),
  add column ordre smallint not null default 0,
  add column created_at timestamptz not null default now(),
  add constraint poste_produit_ou_type check (produit_id is not null or type_produit is not null);
create index postes_travaux_piece_idx on public.postes_travaux (organisation_id, piece_id, ordre);

-- 3. Éléments -------------------------------------------------------------------
alter table public.elements
  add column developpe_mm integer check (developpe_mm is null or developpe_mm between 1 and 5000),
  add column surface_unitaire_mm2 bigint check (surface_unitaire_mm2 is null or surface_unitaire_mm2 between 1 and 100000000);

-- 4. Consommables -----------------------------------------------------------------
create table public.consommables (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  libelle             text not null check (length(libelle) between 1 and 200),
  mode                text not null check (mode in ('par_chantier', 'par_m2')),
  -- Forfait par chantier, ou prix par m² peint (centimes).
  prix_ht_cents       bigint not null check (prix_ht_cents between 0 and 100000000),
  statut_verification public.statut_verification not null default 'a_verifier',
  actif               boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organisation_id, id)
);
select public.appliquer_rls_standard('public.consommables');

-- 5. Valeurs de départ ----------------------------------------------------------
-- Fourchettes du cahier des charges (§5.4), marquées À VÉRIFIER. Aucun temps
-- de pose ni coefficient n'est inventé : temps vides (à renseigner),
-- coefficients à 1,00 (aucun effet tant qu'ils ne sont pas confirmés).
create or replace function public.initialiser_calcul(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.referentiel_calcul (organisation_id, type_produit, rendement_min, rendement_max)
  values (p_organisation_id, 'sous_couche', 8, 12), (p_organisation_id, 'impression', 8, 12),
         (p_organisation_id, 'acrylique', 10, 12), (p_organisation_id, 'glycero', 12, 14),
         (p_organisation_id, 'laque', 12, 14), (p_organisation_id, 'lasure', 10, 14),
         (p_organisation_id, 'vernis', 10, 14),
         -- Enduit : valeur de départ du cahier des charges (1 m²/kg par passe), À VÉRIFIER sur la fiche du produit utilisé.
         (p_organisation_id, 'enduit', 1, 1)
  on conflict do nothing;
  insert into public.coefficients_support (organisation_id, support)
  select p_organisation_id, s from unnest(array['platre_neuf', 'ancienne_peinture', 'beton', 'enduit', 'bois_brut',
    'bois_vernis', 'metal', 'papier_peint', 'carrelage', 'autre']) s
  on conflict do nothing;
  insert into public.etapes_preparation (organisation_id, code, libelle, ordre)
  values (p_organisation_id, 'protection', 'Protection du chantier (bâches, adhésifs)', 1),
         (p_organisation_id, 'depose_papier_peint', 'Dépose de papier peint', 2),
         (p_organisation_id, 'decapage', 'Décapage', 3),
         (p_organisation_id, 'lessivage', 'Lessivage', 4),
         (p_organisation_id, 'rebouchage', 'Rebouchage', 5),
         (p_organisation_id, 'bande_joint', 'Bande à joint', 6),
         (p_organisation_id, 'enduit_1_passe', 'Enduit (une passe)', 7),
         (p_organisation_id, 'enduit_2_passes', 'Enduit (deux passes)', 8),
         (p_organisation_id, 'poncage', 'Ponçage', 9),
         (p_organisation_id, 'impression', 'Impression ou sous-couche', 10),
         (p_organisation_id, 'sous_couche_bloquante', 'Sous-couche bloquante (taches)', 11)
  on conflict do nothing;
$$;
revoke execute on function public.initialiser_calcul(uuid) from public, anon, authenticated;

create or replace function public.organisation_initialiser_calcul()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialiser_calcul(new.id);
  return null;
end;
$$;
revoke execute on function public.organisation_initialiser_calcul() from public, anon, authenticated;
create trigger organisations_initialiser_calcul after insert on public.organisations
  for each row execute function public.organisation_initialiser_calcul();

-- Organisations existantes.
select public.initialiser_calcul(id) from public.organisations;

-- 6. Suppression d'un chantier ----------------------------------------------------
create or replace function public.supprimer_chantier(p_chantier_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  n integer;
begin
  select organisation_id into v_org from public.chantiers where id = p_chantier_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Chantier introuvable.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.devis where chantier_id = p_chantier_id)
     or exists (select 1 from public.factures where chantier_id = p_chantier_id)
     or exists (select 1 from public.pv_reception where chantier_id = p_chantier_id) then
    raise exception 'Ce chantier a des devis, factures ou un PV : il ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
  -- Fichiers de chantier : mis en file AVANT la suppression en cascade.
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, 'photos', chemin from public.photos where chantier_id = p_chantier_id
  union all
  select v_org, espace, chemin from public.documents_chantier where chantier_id = p_chantier_id;
  get diagnostics n = row_count;
  delete from public.chantiers where id = p_chantier_id;
  return n;
end;
$$;
revoke execute on function public.supprimer_chantier(uuid) from public, anon;
grant execute on function public.supprimer_chantier(uuid) to authenticated;
-- Plus de suppression directe : les fichiers seraient orphelins.
revoke delete on public.chantiers from authenticated;
