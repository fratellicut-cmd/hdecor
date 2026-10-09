-- =============================================================================
-- H'DECOR, phase 4 : écrans des devis.
-- Déplacement d'une ligne (échange d'ordre avec sa voisine) en une seule
-- transaction : la contrainte unique (devis_id, ordre) n'est pas différable.
-- SECURITY INVOKER : RLS et gel des devis émis (trigger) s'appliquent.
-- =============================================================================

create or replace function public.deplacer_ligne_devis(p_ligne_id uuid, p_sens integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ligne  public.devis_lignes%rowtype;
  v_voisin public.devis_lignes%rowtype;
begin
  if p_sens not in (-1, 1) then
    raise exception 'Sens invalide.' using errcode = 'P0001';
  end if;
  select * into v_ligne from public.devis_lignes where id = p_ligne_id for update;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.devis where id = v_ligne.devis_id and statut <> 'brouillon') then
    raise exception 'Les lignes d''un devis envoyé sont figées.' using errcode = 'P0001';
  end if;
  select * into v_voisin from public.devis_lignes
  where devis_id = v_ligne.devis_id
    and case when p_sens < 0 then ordre < v_ligne.ordre else ordre > v_ligne.ordre end
  order by case when p_sens < 0 then -ordre else ordre end
  limit 1
  for update;
  if not found then
    return;   -- déjà en tête (ou en fin) : rien à faire
  end if;
  update public.devis_lignes set ordre = -1 - v_ligne.ordre where id = v_ligne.id;
  update public.devis_lignes set ordre = v_ligne.ordre where id = v_voisin.id;
  update public.devis_lignes set ordre = v_voisin.ordre where id = v_ligne.id;
end;
$$;
revoke execute on function public.deplacer_ligne_devis(uuid, integer) from public, anon;
grant execute on function public.deplacer_ligne_devis(uuid, integer) to authenticated;
