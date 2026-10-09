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
  -- Un code de teinte est une référence : « vérifié » exige une date et une source, comme un produit.
  add column verifie_le date,
  add column source_verification text,
  add constraint teintes_nom check (length(trim(nom)) between 1 and 100),
  add constraint teintes_verification check (statut_verification <> 'verifie' or (verifie_le is not null and source_verification is not null));

-- Un format de moins de 100 ml (ou 100 g) est une erreur de saisie (« 0,001 » au lieu de « 1 ») : 10 000 pots.
alter table public.conditionnements add constraint conditionnements_contenance_min check (contenance >= 100);
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
-- la base revalident les bornes. Clé : marque + référence fabricant, sinon
-- marque + désignation. Une clé (colonne) ABSENTE de la ligne = valeur
-- conservée : un fichier « marque, référence, prix » ne vide pas le reste de
-- la fiche ; de même un prix vide garde le prix actuel. Le statut « vérifié »
-- n'est retiré que si une valeur technique change réellement ; un produit
-- créé par import est « À VÉRIFIER ». Un produit archivé réimporté revient au
-- catalogue. SECURITY INVOKER : la RLS de la session s'applique.
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
  v_avant public.produits;
  v_apres public.produits;
  v_crees integer := 0;
  v_maj integer := 0;
  v_marque text;
  v_ref text;
  v_designation text;
  v_usages text[];
  v_nb integer;
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
    -- Décimaux exacts : aucun arrondi silencieux par la colonne numeric.
    if (v_ligne ? 'rendement' and (v_ligne ->> 'rendement')::numeric <> round((v_ligne ->> 'rendement')::numeric, 2))
       or (v_ligne ? 'sechage_h' and (v_ligne ->> 'sechage_h')::numeric <> round((v_ligne ->> 'sechage_h')::numeric, 1)) then
      raise exception 'Import : « % » : décimales en trop.', v_designation using errcode = 'P0001';
    end if;
    v_usages := case when v_ligne ? 'usages' then
      array(select distinct u from jsonb_array_elements_text(v_ligne -> 'usages') u order by u) end;

    select count(*), min(id::text)::uuid into v_nb, v_id from public.produits
    where organisation_id = p_organisation_id and lower(trim(marque)) = lower(v_marque)
      and case when v_ref is not null then lower(trim(reference_fabricant)) = lower(v_ref)
               else reference_fabricant is null and lower(trim(designation)) = lower(v_designation) end;
    if v_nb > 1 then
      raise exception 'Import : plusieurs produits « % % » sans référence : ajoutez la référence fabricant.', v_marque, v_designation using errcode = 'P0001';
    end if;

    if v_id is null then
      insert into public.produits (organisation_id, marque, gamme, reference_fabricant, designation, type, usages, finition,
        unite_mesure, rendement_m2_par_unite, couches_recommandees, sechage_recouvrable_h, fournisseur, fiche_technique_url, statut_verification)
      values (p_organisation_id, v_marque, v_ligne ->> 'gamme', v_ref, v_designation, v_ligne ->> 'type',
        coalesce(v_usages, '{}'), v_ligne ->> 'finition',
        coalesce(v_ligne ->> 'unite_mesure', case when v_ligne ->> 'type' = 'enduit' then 'kg' else 'L' end),
        (v_ligne ->> 'rendement')::numeric, (v_ligne ->> 'couches')::smallint, (v_ligne ->> 'sechage_h')::numeric,
        v_ligne ->> 'fournisseur', v_ligne ->> 'fiche_technique_url', 'a_verifier')
      returning id into v_id;
      v_crees := v_crees + 1;
    else
      select * into v_avant from public.produits where id = v_id;
      if v_ligne ? 'unite_mesure' and v_ligne ->> 'unite_mesure' <> v_avant.unite_mesure
         and exists (select 1 from public.conditionnements where produit_id = v_id) then
        raise exception 'Import : « % » : changement d''unité refusé (ses formats sont en %).', v_designation, v_avant.unite_mesure using errcode = 'P0001';
      end if;
      update public.produits set
        designation = v_designation,
        type = v_ligne ->> 'type',
        gamme = case when v_ligne ? 'gamme' then v_ligne ->> 'gamme' else gamme end,
        usages = coalesce(v_usages, usages),
        finition = case when v_ligne ? 'finition' then v_ligne ->> 'finition' else finition end,
        unite_mesure = coalesce(v_ligne ->> 'unite_mesure', unite_mesure),
        rendement_m2_par_unite = case when v_ligne ? 'rendement' then (v_ligne ->> 'rendement')::numeric else rendement_m2_par_unite end,
        couches_recommandees = case when v_ligne ? 'couches' then (v_ligne ->> 'couches')::smallint else couches_recommandees end,
        sechage_recouvrable_h = case when v_ligne ? 'sechage_h' then (v_ligne ->> 'sechage_h')::numeric else sechage_recouvrable_h end,
        fournisseur = case when v_ligne ? 'fournisseur' then v_ligne ->> 'fournisseur' else fournisseur end,
        fiche_technique_url = case when v_ligne ? 'fiche_technique_url' then v_ligne ->> 'fiche_technique_url' else fiche_technique_url end,
        actif = true
      where id = v_id
      returning * into v_apres;
      -- Valeur technique changée : la vérification ne vaut plus.
      if (v_apres.designation, v_apres.type, (select array_agg(u order by u) from unnest(v_apres.usages) u), v_apres.finition,
          v_apres.unite_mesure, v_apres.rendement_m2_par_unite, v_apres.couches_recommandees, v_apres.sechage_recouvrable_h, v_apres.gamme)
         is distinct from
         (v_avant.designation, v_avant.type, (select array_agg(u order by u) from unnest(v_avant.usages) u), v_avant.finition,
          v_avant.unite_mesure, v_avant.rendement_m2_par_unite, v_avant.couches_recommandees, v_avant.sechage_recouvrable_h, v_avant.gamme) then
        update public.produits set statut_verification = 'a_verifier', verifie_le = null, source_verification = null where id = v_id;
      end if;
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
