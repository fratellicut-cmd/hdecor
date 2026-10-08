-- =============================================================================
-- H'DECOR (Phase 1) : création atomique d'une organisation pour un compte.
-- Appelée par scripts/creer-compte.ts avec la clé de service (rôle serveur
-- uniquement). Tout ou rien : organisation, membre, paramètres et taux de TVA
-- proposés (tous À VÉRIFIER).
-- =============================================================================
create or replace function public.initialiser_organisation(
  p_user_id uuid, p_raison_sociale text, p_nom_dirigeant text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Compte inconnu.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.membres where user_id = p_user_id) then
    raise exception 'Ce compte est déjà rattaché à une organisation.' using errcode = 'P0001';
  end if;
  if coalesce(length(trim(p_raison_sociale)), 0) = 0 then
    raise exception 'Raison sociale requise.' using errcode = 'P0001';
  end if;

  insert into public.organisations (nom) values (trim(p_raison_sociale)) returning id into v_org;
  insert into public.membres (organisation_id, user_id, role) values (v_org, p_user_id, 'proprietaire');
  insert into public.parametres_entreprise (organisation_id, raison_sociale, nom_dirigeant, email)
  values (v_org, trim(p_raison_sociale), nullif(trim(p_nom_dirigeant), ''), nullif(trim(p_email), ''));
  insert into public.taux_tva (organisation_id, taux_bp, libelle, attestation_requise, a_verifier) values
    (v_org, 0,    '0 % (franchise en base ou exonération)', false, true),
    (v_org, 550,  '5,5 %', true,  true),
    (v_org, 1000, '10 %',  true,  true),
    (v_org, 2000, '20 %',  false, true);
  return v_org;
end;
$$;
revoke execute on function public.initialiser_organisation(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.initialiser_organisation(uuid, text, text, text) to service_role;
