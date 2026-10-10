-- Phase 8 (recette) : logo de l'entreprise et textes légaux modifiables.
--
-- 1. Logo : déposé par le serveur dans l'espace privé « marque », sous
--    <organisation>/logo/<uuid>.(png|jpg). Les documents émis gardent le logo
--    de leur date (leur PDF est figé à l'émission).
-- 2. Textes légaux des documents (rétractation, exécution anticipée, « devis
--    reçu », médiateur, rappel de la réception, autoliquidation) : modifiables
--    dans les Paramètres. Absents = texte par défaut de l'application. Tant que
--    le comptable ne les a pas validés (date), ils restent « À VÉRIFIER ».

alter table public.parametres_entreprise
  add constraint logo_chemin_range check (
    logo_chemin is null
    or logo_chemin ~ '^[0-9a-f-]{36}/logo/[0-9a-f-]{36}\.(png|jpg)$'
  );

create or replace function public.textes_legaux_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key not in ('retractation', 'execution_anticipee', 'devis_recu', 'mediateur', 'rappel_reception', 'autoliquidation')
         or jsonb_typeof(e.value) <> 'string'
         or length(btrim(e.value #>> '{}')) not between 1 and 3000
         -- Caractères de contrôle interdits, sauf le retour à la ligne.
         or (e.value #>> '{}') ~ '[\x01-\x09\x0b-\x1f\x7f]'
    );
$$;
revoke execute on function public.textes_legaux_valides(jsonb) from public, anon;
grant execute on function public.textes_legaux_valides(jsonb) to authenticated, service_role;

alter table public.parametres_entreprise
  add column textes_legaux jsonb not null default '{}'::jsonb,
  add column textes_legaux_valides_le date,
  add constraint textes_legaux_forme check (public.textes_legaux_valides(textes_legaux));

-- 3. Acompte : cumul des acomptes précédents sur lequel son montant a été
--    calculé (base en cumulé). À l'émission, il doit être celui des acomptes
--    ÉMIS : sinon (acompte précédent supprimé ou pas encore émis), le montant
--    s'écarterait d'un centime de l'échéancier du devis. Fixé à la création.
alter table public.factures
  add column acompte_cumul_avant_bp integer check (acompte_cumul_avant_bp between 0 and 9999),
  add constraint acompte_cumul_type check (acompte_cumul_avant_bp is null or type = 'acompte');
grant insert (acompte_cumul_avant_bp) on public.factures to authenticated;
