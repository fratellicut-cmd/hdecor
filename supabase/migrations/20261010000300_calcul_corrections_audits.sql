-- =============================================================================
-- H'DECOR (Phase 2) : corrections demandées par l'audit métier peinture.
--   1. Référentiel : une ligne par type de produit (rendement vide = à
--      renseigner) ; séchage avant recouvrement par type.
--   2. Étapes de préparation : matière associée par TYPE de produit (calculée
--      même sans catalogue) et indication « consomme de la matière ».
--   3. Poste : intérieur / extérieur.
--   4. Paramètres : seuil d'alerte de hauteur ; formats de sacs (kg).
--   5. Élément « façade » (pan de mur compté en m²).
-- Toute valeur ajoutée est « À VÉRIFIER » ; aucun rendement ni temps inventé.
-- =============================================================================

-- 1. Référentiel -------------------------------------------------------------
alter table public.referentiel_calcul alter column rendement_min drop not null;
alter table public.referentiel_calcul alter column rendement_max drop not null;
alter table public.referentiel_calcul drop constraint referentiel_calcul_rendement_min_check;
alter table public.referentiel_calcul drop constraint referentiel_calcul_check;
alter table public.referentiel_calcul
  add constraint referentiel_rendements check (
    (rendement_min is null and rendement_max is null)
    or (rendement_min > 0 and rendement_max >= rendement_min)),
  -- Séchage avant recouvrement (heures), par type : vide = non pris en compte (signalé).
  add column sechage_recouvrable_h numeric(5, 1) check (sechage_recouvrable_h is null or sechage_recouvrable_h >= 0);

-- 2. Étapes de préparation ----------------------------------------------------
alter table public.etapes_preparation
  add column type_produit text check (type_produit is null or type_produit in (
    'sous_couche', 'impression', 'acrylique', 'glycero', 'laque', 'facade', 'lasure', 'vernis', 'enduit',
    'anti_humidite', 'anti_rouille', 'sous_couche_bloquante', 'autre')),
  add column couches smallint not null default 1 check (couches between 1 and 5),
  -- L'étape consomme de la matière (enduit, impression, décapant…) : si rien ne permet
  -- de la chiffrer, le calcul le signale. Lessive et abrasif relèvent des consommables.
  add column avec_matiere boolean not null default false;

-- 3. Poste ---------------------------------------------------------------------
alter table public.postes_travaux add column exterieur boolean not null default false;

-- 4. Paramètres ----------------------------------------------------------------
alter table public.parametres_entreprise
  add column hauteur_alerte_mm integer not null default 3000 check (hauteur_alerte_mm between 2000 and 20000),
  -- Formats proposés pour les produits au kg (enduits) quand aucun produit n'est choisi (g).
  add column formats_sacs_g integer[] not null default array[5000, 15000, 25000]
    check (cardinality(formats_sacs_g) between 1 and 10 and 0 < all (formats_sacs_g) and 100000 >= all (formats_sacs_g));

-- 5. Élément façade -------------------------------------------------------------
alter table public.elements drop constraint elements_type_check;
alter table public.elements add constraint elements_type_check check (type in (
  'plinthe', 'corniche', 'porte', 'fenetre', 'radiateur', 'volet', 'escalier', 'rambarde', 'facade', 'autre'));

-- Valeurs de départ (organisations existantes et nouvelles) ----------------------
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
         (p_organisation_id, 'enduit', 1, 1),
         -- Pas de fourchette dans le cahier des charges : à renseigner.
         (p_organisation_id, 'facade', null, null), (p_organisation_id, 'anti_humidite', null, null),
         (p_organisation_id, 'anti_rouille', null, null), (p_organisation_id, 'sous_couche_bloquante', null, null),
         (p_organisation_id, 'autre', null, null)
  on conflict do nothing;
  insert into public.coefficients_support (organisation_id, support)
  select p_organisation_id, s from unnest(array['platre_neuf', 'ancienne_peinture', 'beton', 'enduit', 'bois_brut',
    'bois_vernis', 'metal', 'papier_peint', 'carrelage', 'autre']) s
  on conflict do nothing;
  insert into public.etapes_preparation (organisation_id, code, libelle, ordre, type_produit, couches, avec_matiere)
  values (p_organisation_id, 'protection', 'Protection du chantier (bâches, adhésifs)', 1, null, 1, false),
         (p_organisation_id, 'depose_papier_peint', 'Dépose de papier peint', 2, null, 1, false),
         (p_organisation_id, 'decapage', 'Décapage', 3, null, 1, true),
         (p_organisation_id, 'lessivage', 'Lessivage', 4, null, 1, false),
         (p_organisation_id, 'rebouchage', 'Rebouchage', 5, null, 1, true),
         (p_organisation_id, 'bande_joint', 'Bande à joint', 6, null, 1, true),
         (p_organisation_id, 'enduit_1_passe', 'Enduit (une passe)', 7, 'enduit', 1, true),
         (p_organisation_id, 'enduit_2_passes', 'Enduit (deux passes)', 8, 'enduit', 2, true),
         (p_organisation_id, 'poncage', 'Ponçage', 9, null, 1, false),
         (p_organisation_id, 'impression', 'Impression ou sous-couche', 10, 'impression', 1, true),
         (p_organisation_id, 'sous_couche_bloquante', 'Sous-couche bloquante (taches)', 11, 'sous_couche_bloquante', 1, true)
  on conflict do nothing;
$$;
revoke execute on function public.initialiser_calcul(uuid) from public, anon, authenticated;

-- Organisations existantes : lignes manquantes, puis matière des étapes livrées.
select public.initialiser_calcul(id) from public.organisations;
update public.etapes_preparation e set type_produit = v.t, couches = v.c, avec_matiere = v.m
from (values ('decapage', null, 1, true), ('lessivage', null, 1, false), ('rebouchage', null, 1, true),
             ('bande_joint', null, 1, true), ('enduit_1_passe', 'enduit', 1, true), ('enduit_2_passes', 'enduit', 2, true),
             ('poncage', null, 1, false), ('impression', 'impression', 1, true), ('sous_couche_bloquante', 'sous_couche_bloquante', 1, true))
  as v(code, t, c, m)
where e.code = v.code;

-- -----------------------------------------------------------------------------
-- Corrections demandées par la relecture du code
-- -----------------------------------------------------------------------------
-- Durée d'une journée de travail (estimation en jours) : paramétrable.
alter table public.parametres_entreprise
  add column minutes_par_jour integer not null default 420 check (minutes_par_jour between 60 and 1440);

-- Version d'un poste (conflit avec un brouillon gardé sur le téléphone).
alter table public.postes_travaux add column updated_at timestamptz not null default now();
create trigger postes_travaux_updated_at before update on public.postes_travaux
  for each row execute function public.maj_updated_at();

-- Lectures par pièce.
create index if not exists ouvertures_piece_idx on public.ouvertures (organisation_id, piece_id);
create index if not exists elements_piece_idx on public.elements (organisation_id, piece_id);

-- Suppression d'un chantier : les dépenses rattachées l'empêchent aussi.
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
     or exists (select 1 from public.pv_reception where chantier_id = p_chantier_id)
     or exists (select 1 from public.depenses where chantier_id = p_chantier_id) then
    raise exception 'Ce chantier a des devis, factures, dépenses ou un PV : il ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
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

-- -----------------------------------------------------------------------------
-- Corrections demandées par le test terrain
-- -----------------------------------------------------------------------------
-- Teinte en texte libre (« blanc », « RAL 9010 ») tant que le catalogue des
-- teintes n'existe pas : sans elle, la liste d'achat est inutilisable chez le fournisseur.
alter table public.postes_travaux
  add column teinte_libre text check (teinte_libre is null or length(trim(teinte_libre)) between 1 and 80);

-- Duplication d'une pièce : recopie aussi « extérieur » et la teinte libre.
create or replace function public.dupliquer_piece(p_piece_id uuid, p_nom text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nouvelle uuid := gen_random_uuid();
  v_correspondance jsonb := '{}';
  v_element record;
  v_poste record;
  v_nouvel_element uuid;
  v_nouveau_poste uuid;
begin
  if p_nom is null or length(trim(p_nom)) not between 1 and 100 then
    raise exception 'Nom de pièce invalide.' using errcode = 'P0001';
  end if;
  insert into public.pieces (id, organisation_id, chantier_id, nom, etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre)
  select v_nouvelle, organisation_id, chantier_id, trim(p_nom), etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre + 1
  from public.pieces where id = p_piece_id;
  if not found then raise exception 'Pièce introuvable.' using errcode = 'P0002'; end if;

  insert into public.ouvertures (organisation_id, piece_id, type, largeur_mm, hauteur_mm, surface_directe_mm2, quantite)
  select organisation_id, v_nouvelle, type, largeur_mm, hauteur_mm, surface_directe_mm2, quantite
  from public.ouvertures where piece_id = p_piece_id;

  for v_element in select * from public.elements where piece_id = p_piece_id loop
    insert into public.elements (organisation_id, piece_id, type, unite, quantite_e4, faces, notes, developpe_mm, surface_unitaire_mm2)
    values (v_element.organisation_id, v_nouvelle, v_element.type, v_element.unite, v_element.quantite_e4, v_element.faces,
            v_element.notes, v_element.developpe_mm, v_element.surface_unitaire_mm2)
    returning id into v_nouvel_element;
    v_correspondance := v_correspondance || jsonb_build_object(v_element.id::text, v_nouvel_element);
  end loop;

  for v_poste in select * from public.postes_travaux where piece_id = p_piece_id loop
    insert into public.postes_travaux (organisation_id, piece_id, cible, element_id, support, zone_humide, taches, exterieur, produit_id,
      teinte_id, teinte_libre, finition, couches, rendement_force, marge_perte_bp, type_produit, majoration_temps_bp, ordre)
    values (v_poste.organisation_id, v_nouvelle, v_poste.cible,
      case when v_poste.element_id is null then null else (v_correspondance ->> v_poste.element_id::text)::uuid end,
      v_poste.support, v_poste.zone_humide, v_poste.taches, v_poste.exterieur, v_poste.produit_id, v_poste.teinte_id, v_poste.teinte_libre,
      v_poste.finition, v_poste.couches, v_poste.rendement_force, v_poste.marge_perte_bp, v_poste.type_produit, v_poste.majoration_temps_bp, v_poste.ordre)
    returning id into v_nouveau_poste;
    insert into public.postes_preparations (organisation_id, poste_id, etape_id)
    select organisation_id, v_nouveau_poste, etape_id from public.postes_preparations where poste_id = v_poste.id;
  end loop;
  return v_nouvelle;
end;
$$;

-- Même poste (murs ou plafond) sur d'autres pièces du chantier, en une fois.
-- Identifiant de chaque copie dérivé du poste et de la pièce : un nouvel envoi
-- (réseau coupé après l'enregistrement) ne crée pas de doublon.
create or replace function public.copier_poste(p_poste_id uuid, p_pieces uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_poste public.postes_travaux;
  v_chantier uuid;
  v_piece uuid;
  v_copie uuid;
  n integer := 0;
begin
  select * into v_poste from public.postes_travaux where id = p_poste_id;
  if not found then raise exception 'Poste introuvable.' using errcode = 'P0002'; end if;
  if v_poste.cible = 'element' then raise exception 'Un poste sur un élément ne se copie pas vers une autre pièce.' using errcode = 'P0001'; end if;
  select chantier_id into v_chantier from public.pieces where id = v_poste.piece_id;
  if cardinality(coalesce(p_pieces, '{}')) > 100 then raise exception 'Trop de pièces.' using errcode = 'P0001'; end if;
  foreach v_piece in array coalesce(p_pieces, '{}') loop
    if v_piece = v_poste.piece_id then continue; end if;
    if not exists (select 1 from public.pieces where id = v_piece and chantier_id = v_chantier) then
      raise exception 'Pièce introuvable dans ce chantier.' using errcode = 'P0002';
    end if;
    v_copie := md5(p_poste_id::text || ':' || v_piece::text)::uuid;
    insert into public.postes_travaux (id, organisation_id, piece_id, cible, element_id, support, zone_humide, taches, exterieur, produit_id,
      teinte_id, teinte_libre, finition, couches, rendement_force, marge_perte_bp, type_produit, majoration_temps_bp, ordre)
    values (v_copie, v_poste.organisation_id, v_piece, v_poste.cible, null, v_poste.support, v_poste.zone_humide, v_poste.taches,
      v_poste.exterieur, v_poste.produit_id, v_poste.teinte_id, v_poste.teinte_libre, v_poste.finition, v_poste.couches,
      v_poste.rendement_force, v_poste.marge_perte_bp, v_poste.type_produit, v_poste.majoration_temps_bp, v_poste.ordre)
    on conflict (id) do nothing;
    if found then
      insert into public.postes_preparations (organisation_id, poste_id, etape_id)
      select organisation_id, v_copie, etape_id from public.postes_preparations where poste_id = p_poste_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.copier_poste(uuid, uuid[]) from public, anon;
grant execute on function public.copier_poste(uuid, uuid[]) to authenticated;
