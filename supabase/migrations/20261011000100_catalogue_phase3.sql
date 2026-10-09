-- =============================================================================
-- H'DECOR (Phase 3) : catalogue.
--   1. Teintes archivables, produits retrouvables par marque + référence.
--   2. Formats par défaut par TYPE de produit (une laque ne se vend pas en 15 L).
--   3. Lignes d'exemple livrées, marquées « fictif » : aucune référence, aucun
--      prix, aucun rendement inventés.
--   4. Import CSV en une transaction (création ou mise à jour).
--   5. Alerte : prix d'achat changé pour un produit d'un devis en cours.
-- =============================================================================

-- 1. Teintes et produits ---------------------------------------------------------
alter table public.teintes
  add column actif boolean not null default true,
  add column updated_at timestamptz not null default now(),
  add constraint teintes_nom check (length(trim(nom)) between 1 and 100);
create trigger teintes_updated_at before update on public.teintes
  for each row execute function public.maj_updated_at();

-- Une référence fabricant n'existe qu'une fois par marque (clé de l'import).
create unique index produits_marque_reference_idx on public.produits
  (organisation_id, lower(trim(marque)), lower(trim(reference_fabricant))) where reference_fabricant is not null;

alter table public.produits
  add constraint produits_textes check (
    length(trim(marque)) between 1 and 100 and length(trim(designation)) between 1 and 200
    and (fiche_technique_url is null or fiche_technique_url ~ '^https?://'));

-- 2. Formats par type -----------------------------------------------------------
-- Vide : les formats généraux (paramètres) s'appliquent. Valeurs : ml ou g.
alter table public.referentiel_calcul
  add column formats_ml integer[] check (formats_ml is null or (
    cardinality(formats_ml) between 1 and 10 and 0 < all (formats_ml) and 100000 >= all (formats_ml)));

-- 3. Exemples fictifs -------------------------------------------------------------
create or replace function public.initialiser_catalogue(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_produit uuid;
begin
  -- Une seule fois : un catalogue déjà rempli n'est pas touché.
  if exists (select 1 from public.produits where organisation_id = p_organisation_id) then return; end if;
  insert into public.produits (organisation_id, marque, designation, type, usages, finition, statut_verification)
  values (p_organisation_id, 'Exemple fictif', 'Acrylique mat murs et plafonds (exemple fictif, à remplacer)', 'acrylique',
          array['mur', 'plafond'], 'mat', 'fictif')
  returning id into v_produit;
  insert into public.conditionnements (organisation_id, produit_id, contenance)
  values (p_organisation_id, v_produit, 2500), (p_organisation_id, v_produit, 10000);
  insert into public.produits (organisation_id, marque, designation, type, usages, finition, statut_verification)
  values (p_organisation_id, 'Exemple fictif', 'Laque satinée boiseries (exemple fictif, à remplacer)', 'laque',
          array['boiserie'], 'satin', 'fictif')
  returning id into v_produit;
  insert into public.conditionnements (organisation_id, produit_id, contenance)
  values (p_organisation_id, v_produit, 500), (p_organisation_id, v_produit, 2500);
  insert into public.teintes (organisation_id, nom, apercu_hex, statut_verification)
  values (p_organisation_id, 'Blanc (exemple fictif)', '#FFFFFF', 'fictif');
end;
$$;
revoke execute on function public.initialiser_catalogue(uuid) from public, anon, authenticated;

create or replace function public.organisation_initialiser_catalogue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialiser_catalogue(new.id);
  return null;
end;
$$;
revoke execute on function public.organisation_initialiser_catalogue() from public, anon, authenticated;
create trigger organisations_initialiser_catalogue after insert on public.organisations
  for each row execute function public.organisation_initialiser_catalogue();
select public.initialiser_catalogue(id) from public.organisations;

-- 4. Import CSV -------------------------------------------------------------------
-- p_lignes : tableau JSON déjà validé par le serveur (zod) ; les contraintes de
-- la base revalident tout. Clé : marque + référence fabricant, sinon marque +
-- désignation. Une ligne importée n'est jamais « vérifiée » : statut À VÉRIFIER.
-- Prix vide : le prix existant est conservé (jamais effacé par un import).
-- SECURITY INVOKER : la RLS de la session s'applique à chaque écriture.
create or replace function public.importer_produits(p_organisation_id uuid, p_lignes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ligne jsonb;
  v_format jsonb;
  v_id uuid;
  v_crees integer := 0;
  v_maj integer := 0;
  v_marque text;
  v_ref text;
  v_designation text;
begin
  if not public.est_membre(p_organisation_id) then
    raise exception 'Organisation introuvable.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) not between 1 and 2000 then
    raise exception 'Import : de 1 à 2 000 lignes.' using errcode = 'P0001';
  end if;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    v_marque := trim(v_ligne ->> 'marque');
    v_ref := nullif(trim(coalesce(v_ligne ->> 'reference_fabricant', '')), '');
    v_designation := trim(v_ligne ->> 'designation');
    select id into v_id from public.produits
    where organisation_id = p_organisation_id and lower(trim(marque)) = lower(v_marque)
      and case when v_ref is not null then lower(trim(reference_fabricant)) = lower(v_ref)
               else reference_fabricant is null and lower(trim(designation)) = lower(v_designation) end
    limit 1;
    if v_id is null then
      insert into public.produits (organisation_id, marque, gamme, reference_fabricant, designation, type, usages, finition,
        unite_mesure, rendement_m2_par_unite, couches_recommandees, sechage_recouvrable_h, fournisseur, fiche_technique_url, statut_verification)
      values (p_organisation_id, v_marque, nullif(trim(v_ligne ->> 'gamme'), ''), v_ref, v_designation, v_ligne ->> 'type',
        array(select jsonb_array_elements_text(v_ligne -> 'usages')), nullif(v_ligne ->> 'finition', ''),
        v_ligne ->> 'unite_mesure', (v_ligne ->> 'rendement')::numeric, (v_ligne ->> 'couches')::smallint,
        (v_ligne ->> 'sechage_h')::numeric, nullif(trim(v_ligne ->> 'fournisseur'), ''), nullif(trim(v_ligne ->> 'fiche_technique_url'), ''),
        'a_verifier')
      returning id into v_id;
      v_crees := v_crees + 1;
    else
      update public.produits set
        gamme = nullif(trim(v_ligne ->> 'gamme'), ''), designation = v_designation, type = v_ligne ->> 'type',
        usages = array(select jsonb_array_elements_text(v_ligne -> 'usages')), finition = nullif(v_ligne ->> 'finition', ''),
        unite_mesure = v_ligne ->> 'unite_mesure', rendement_m2_par_unite = (v_ligne ->> 'rendement')::numeric,
        couches_recommandees = (v_ligne ->> 'couches')::smallint, sechage_recouvrable_h = (v_ligne ->> 'sechage_h')::numeric,
        fournisseur = nullif(trim(v_ligne ->> 'fournisseur'), ''), fiche_technique_url = nullif(trim(v_ligne ->> 'fiche_technique_url'), ''),
        statut_verification = 'a_verifier', verifie_le = null, source_verification = null, actif = true
      where id = v_id;
      v_maj := v_maj + 1;
    end if;
    for v_format in select * from jsonb_array_elements(coalesce(v_ligne -> 'formats', '[]')) loop
      insert into public.conditionnements (organisation_id, produit_id, contenance, prix_achat_ht_cents)
      values (p_organisation_id, v_id, (v_format ->> 'contenance')::integer, (v_format ->> 'prix_cents')::bigint)
      on conflict (produit_id, contenance) do update
        set prix_achat_ht_cents = coalesce(excluded.prix_achat_ht_cents, public.conditionnements.prix_achat_ht_cents), actif = true;
    end loop;
  end loop;
  return jsonb_build_object('crees', v_crees, 'mis_a_jour', v_maj);
end;
$$;
revoke execute on function public.importer_produits(uuid, jsonb) from public, anon;
grant execute on function public.importer_produits(uuid, jsonb) to authenticated;

-- 5. Alerte de prix ---------------------------------------------------------------
-- Devis en cours (brouillon ou envoyé) dont un achat a été chiffré à un prix
-- différent du prix d'achat actuel du format. Vue en security_invoker : la RLS
-- des tables lues s'applique.
create view public.v_alertes_prix with (security_invoker = true) as
select d.organisation_id, d.id as devis_id, d.numero, d.statut, d.objet,
       p.id as produit_id, p.marque, p.designation, c.id as conditionnement_id, c.contenance, p.unite_mesure,
       a.prix_achat_retenu_cents, c.prix_achat_ht_cents as prix_actuel_cents
from public.devis_achats a
join public.devis d on d.id = a.devis_id and d.organisation_id = a.organisation_id
join public.conditionnements c on c.id = a.conditionnement_id and c.organisation_id = a.organisation_id
join public.produits p on p.id = c.produit_id and p.organisation_id = c.organisation_id
where d.statut in ('brouillon', 'envoye')
  and a.prix_achat_retenu_cents is distinct from c.prix_achat_ht_cents;
revoke all on public.v_alertes_prix from public, anon;
grant select on public.v_alertes_prix to authenticated;
