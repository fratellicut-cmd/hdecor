-- =============================================================================
-- H'DECOR (Phase 2) : opérations atomiques du métré, en SECURITY INVOKER
-- (la RLS de la session s'applique à chaque lecture et écriture).
-- =============================================================================

-- Duplication d'une pièce avec ses ouvertures, éléments, postes et préparations.
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
    insert into public.postes_travaux (organisation_id, piece_id, cible, element_id, support, zone_humide, taches, produit_id,
      teinte_id, finition, couches, rendement_force, marge_perte_bp, type_produit, majoration_temps_bp, ordre)
    values (v_poste.organisation_id, v_nouvelle, v_poste.cible,
      case when v_poste.element_id is null then null else (v_correspondance ->> v_poste.element_id::text)::uuid end,
      v_poste.support, v_poste.zone_humide, v_poste.taches, v_poste.produit_id, v_poste.teinte_id, v_poste.finition,
      v_poste.couches, v_poste.rendement_force, v_poste.marge_perte_bp, v_poste.type_produit, v_poste.majoration_temps_bp, v_poste.ordre)
    returning id into v_nouveau_poste;
    insert into public.postes_preparations (organisation_id, poste_id, etape_id)
    select organisation_id, v_nouveau_poste, etape_id from public.postes_preparations where poste_id = v_poste.id;
  end loop;
  return v_nouvelle;
end;
$$;
revoke execute on function public.dupliquer_piece(uuid, text) from public, anon;
grant execute on function public.dupliquer_piece(uuid, text) to authenticated;

-- Étapes de préparation d'un poste : remplacement en une transaction.
create or replace function public.definir_preparations(p_poste_id uuid, p_etapes uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.postes_travaux where id = p_poste_id;
  if v_org is null then raise exception 'Poste introuvable.' using errcode = 'P0002'; end if;
  delete from public.postes_preparations where poste_id = p_poste_id;
  insert into public.postes_preparations (organisation_id, poste_id, etape_id)
  select v_org, p_poste_id, e from unnest(coalesce(p_etapes, '{}')) e;
end;
$$;
revoke execute on function public.definir_preparations(uuid, uuid[]) from public, anon;
grant execute on function public.definir_preparations(uuid, uuid[]) to authenticated;
