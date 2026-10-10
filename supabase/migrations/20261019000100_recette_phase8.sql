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

-- 4. Contrôles d'émission ajoutés en recette (sous les verrous d'emettre_facture :
--    devis pour un acompte, facture d'origine pour un avoir).
--    a. Acompte : le cumul sur lequel son montant a été calculé doit être celui
--       des acomptes ÉMIS du devis (sinon écart d'un centime avec l'échéancier).
--    b. Avoir : par taux, le cumul des avoirs (base ET TVA) ne dépasse jamais le
--       net de la facture d'origine ; l'avoir qui la solde la solde EXACTEMENT
--       (TVA créditée = TVA facturée, taux par taux).

-- Net par taux d'une facture : sa ventilation moins celle des factures qu'elle déduit.
create or replace function public.ventilation_nette(p_ventilation jsonb, p_deductions jsonb)
returns table (taux_bp integer, base bigint, tva bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t, sum(b)::bigint, sum(v)::bigint from (
    select (x ->> 'taux_bp')::integer t, (x ->> 'base_ht_cents')::bigint b, (x ->> 'tva_cents')::bigint v
    from jsonb_array_elements(p_ventilation) x
    union all
    select (x ->> 'taux_bp')::integer, -(x ->> 'base_ht_cents')::bigint, -(x ->> 'tva_cents')::bigint
    from jsonb_array_elements(coalesce(p_deductions, '[]')) d
    join public.factures f on f.id = (d ->> 'facture_id')::uuid,
    jsonb_array_elements(f.ventilation_tva) x
  ) n group by t;
$$;
revoke execute on function public.ventilation_nette(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.controler_emission_recette()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cumul integer;
  v_origine public.factures%rowtype;
  v_avoirs bigint;
  v_negatif integer;
  v_reste_non_nul integer;
begin
  if not (old.statut = 'brouillon' and new.statut = 'emise') then return new; end if;

  if new.type = 'acompte' and new.acompte_cumul_avant_bp is not null and new.devis_id is not null then
    select coalesce(sum(acompte_pct_bp), 0) into v_cumul from public.factures
    where devis_id = new.devis_id and type = 'acompte' and statut = 'emise' and id <> new.id;
    if v_cumul <> new.acompte_cumul_avant_bp then
      raise exception 'Acompte calculé après d''autres acomptes qui ne sont pas (ou plus) tous émis : supprimez ce brouillon et recréez-le.'
        using errcode = 'P0001';
    end if;
  end if;

  if new.type = 'avoir' then
    select * into v_origine from public.factures where id = new.facture_origine_id;
    select coalesce(sum(net_a_payer_cents), 0) into v_avoirs from public.factures
    where facture_origine_id = new.facture_origine_id and type = 'avoir' and statut = 'emise' and id <> new.id;
    with reste as (
      select t, sum(b) b, sum(v) v from (
        select taux_bp t, base b, tva v from public.ventilation_nette(v_origine.ventilation_tva, v_origine.deductions)
        union all
        select n.taux_bp, -n.base, -n.tva from public.factures a, lateral public.ventilation_nette(a.ventilation_tva, a.deductions) n
        where a.facture_origine_id = new.facture_origine_id and a.type = 'avoir' and a.statut = 'emise' and a.id <> new.id
        union all
        select taux_bp, -base, -tva from public.ventilation_nette(new.ventilation_tva, new.deductions)
      ) x group by t)
    select count(*) filter (where b < 0 or v < 0), count(*) filter (where b <> 0 or v <> 0)
      into v_negatif, v_reste_non_nul from reste;
    if v_negatif > 0 then
      raise exception 'Avoir : pour un taux de TVA, le total des avoirs dépasserait la facture d''origine.' using errcode = 'P0001';
    end if;
    if v_avoirs + new.net_a_payer_cents = v_origine.net_a_payer_cents and v_reste_non_nul > 0 then
      raise exception 'Avoir : il solde la facture sans solder exactement chaque taux de TVA.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.controler_emission_recette() from public, anon, authenticated;
create trigger factures_controle_recette before update of statut on public.factures
  for each row execute function public.controler_emission_recette();

-- 5. Logo : écrit par le SERVEUR seulement (contenu vérifié, métadonnées retirées,
--    dimensions bornées). Plus d'écriture directe dans l'espace « marque » ni de
--    modification de logo_chemin par une session.
drop policy if exists hdecor_ajout on storage.objects;
drop policy if exists hdecor_maj on storage.objects;
drop policy if exists hdecor_suppr on storage.objects;
do $$
declare v_colonnes text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_colonnes
  from information_schema.columns
  where table_schema = 'public' and table_name = 'parametres_entreprise' and column_name not in ('organisation_id', 'logo_chemin');
  execute 'revoke update on public.parametres_entreprise from authenticated';
  execute format('grant update (%s) on public.parametres_entreprise to authenticated', v_colonnes);
end $$;
