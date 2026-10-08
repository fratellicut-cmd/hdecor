-- =============================================================================
-- H'DECOR (Phase 1) : la double authentification est imposée PAR LA BASE.
--
-- Sans cela, un utilisateur qui a activé le code TOTP mais ne s'est connecté
-- qu'avec son mot de passe (session « aal1 ») pourrait appeler l'API de
-- données directement et tout lire : la vérification de l'application ne
-- suffit pas. Règle : si le compte a au moins un facteur VÉRIFIÉ, la session
-- doit être de niveau aal2 pour être reconnue membre de son organisation.
-- Comme toutes les politiques RLS et les fonctions métier passent par
-- est_membre(), la règle s'applique partout d'un coup.
-- =============================================================================
create or replace function public.niveau_auth_suffisant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status::text = 'verified');
$$;
revoke execute on function public.niveau_auth_suffisant() from public, anon, authenticated;

create or replace function public.est_membre(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membres m
    where m.organisation_id = p_organisation_id
      and m.user_id = (select auth.uid())
  ) and public.niveau_auth_suffisant();
$$;
