-- =============================================================================
-- H'DECOR : socle
-- Organisations, membres, fonctions d'appartenance, journal d'audit,
-- numérotation atomique des documents.
--
-- Principes appliqués dans toutes les migrations :
--   * chaque table métier porte organisation_id et a la RLS activée ;
--   * les clés étrangères entre tables métier sont COMPOSITES
--     (organisation_id, id) : une ligne ne peut jamais référencer une ligne
--     d'une autre organisation, même si l'identifiant a fui (les contrôles de
--     clé étrangère ignorent la RLS) ;
--   * l'argent est en centimes (bigint), les taux en points de base
--     (2000 = 20 %, 550 = 5,5 %), les longueurs en millimètres (integer) ;
--   * les fonctions SECURITY DEFINER fixent search_path = '' et qualifient
--     tous les objets.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------

create or replace function public.maj_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Date du jour à Paris : la date d'émission d'un document est la date légale
-- française, pas la date UTC du serveur.
create or replace function public.aujourd_hui_paris()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Paris')::date;
$$;

-- -----------------------------------------------------------------------------
-- Organisations et membres
-- Un seul utilisateur aujourd'hui (Yorick), mais le modèle est multi-entreprise.
-- Aucune inscription libre : l'organisation et le compte sont créés par un
-- script d'administration (clé de service, hors navigateur).
-- -----------------------------------------------------------------------------

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (length(nom) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.membres (
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  user_id         uuid not null references auth.users (id) on delete restrict,
  role            text not null default 'proprietaire' check (role in ('proprietaire')),
  created_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
);
create index membres_user_idx on public.membres (user_id);

-- Appartenance : SECURITY DEFINER pour ne pas dépendre de la RLS de membres
-- (évite la récursion), STABLE pour être évaluée une fois par requête.
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
  );
$$;

alter table public.organisations enable row level security;
alter table public.membres enable row level security;

create policy organisations_lecture on public.organisations
  for select to authenticated using (public.est_membre(id));
create policy organisations_maj on public.organisations
  for update to authenticated using (public.est_membre(id)) with check (public.est_membre(id));

-- Un membre voit sa propre appartenance ; personne ne s'ajoute lui-même.
create policy membres_lecture on public.membres
  for select to authenticated using (user_id = (select auth.uid()));

create trigger organisations_updated_at before update on public.organisations
  for each row execute function public.maj_updated_at();

-- -----------------------------------------------------------------------------
-- Politique RLS standard : membre de l'organisation de la ligne.
-- Les tables à règles particulières (documents émis, journal, paiements)
-- reçoivent des politiques écrites à la main.
-- -----------------------------------------------------------------------------

create or replace function public.appliquer_rls_standard(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy membre_lecture on %s for select to authenticated using (public.est_membre(organisation_id))',
    p_table);
  execute format(
    'create policy membre_ajout on %s for insert to authenticated with check (public.est_membre(organisation_id))',
    p_table);
  execute format(
    'create policy membre_maj on %s for update to authenticated using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id))',
    p_table);
  execute format(
    'create policy membre_suppr on %s for delete to authenticated using (public.est_membre(organisation_id))',
    p_table);
end;
$$;

-- -----------------------------------------------------------------------------
-- Journal d'audit : qui, quoi, quand, avant / après.
-- Alimenté uniquement par trigger. Ni modifiable ni supprimable.
-- -----------------------------------------------------------------------------

create table public.journal_audit (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  user_id          uuid,             -- null : action système (cron, lien public)
  action           text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_nom        text not null,
  ligne_id         uuid,
  avant            jsonb,
  apres            jsonb,
  cree_le          timestamptz not null default now()
);
create index journal_audit_org_idx on public.journal_audit (organisation_id, cree_le desc);
create index journal_audit_ligne_idx on public.journal_audit (table_nom, ligne_id);

alter table public.journal_audit enable row level security;
create policy journal_lecture on public.journal_audit
  for select to authenticated using (public.est_membre(organisation_id));
-- Aucune politique INSERT / UPDATE / DELETE : seul le trigger (definer) écrit.

create or replace function public.interdire_modification_journal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Seule exception : la purge de conservation, par purger_journal_audit()
  -- (rôle service), qui ne supprime que des entrées échues.
  -- Le plancher d'un an est imposé ICI, pas seulement dans la fonction.
  if tg_op = 'DELETE' and current_setting('hdecor.purge_journal', true) = 'on'
     and current_user not in ('authenticated', 'anon')
     and old.cree_le < now() - interval '1 year' then
    return old;
  end if;
  raise exception 'Le journal d''audit ne peut être ni modifié ni supprimé.'
    using errcode = 'P0001';
end;
$$;

create trigger journal_audit_immuable
  before update or delete on public.journal_audit
  for each row execute function public.interdire_modification_journal();

-- Minimisation RGPD : le journal ne garde que ce qui est sur LISTE BLANCHE
-- (identifiants, statuts, numéros, montants, taux, quantités, dates,
-- empreintes). Aucun texte libre, aucun nom, aucune adresse, aucune IP.
-- En UPDATE, seules les colonnes modifiées sont enregistrées.
create or replace function public.audit_sans_donnees_perso(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(p)
  where key in ('id', 'organisation_id', 'statut', 'numero', 'version', 'type', 'unite', 'regime_tva',
                'mode', 'ordre', 'methode', 'finalite', 'document_type', 'quantite_e4', 'optionnelle',
                'autoliquidation', 'hors_etablissement', 'avec_reserves', 'actif', 'contenance',
                'ventilation_tva', 'ventilation_acceptee', 'options_acceptees', 'minutes')
     or key ~ '(_id|_cents|_bp|_jours|_le|_sha256)$'
     or key ~ '^date_';
$$;

create or replace function public.tracer_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ligne jsonb;
  v_avant jsonb;
  v_apres jsonb;
begin
  v_ligne := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
      into v_avant, v_apres
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value and n.key <> 'updated_at';
    v_avant := public.audit_sans_donnees_perso(coalesce(v_avant, '{}'::jsonb));
    v_apres := public.audit_sans_donnees_perso(coalesce(v_apres, '{}'::jsonb));
  elsif tg_op = 'INSERT' then
    v_apres := public.audit_sans_donnees_perso(to_jsonb(new));
  else
    v_avant := public.audit_sans_donnees_perso(to_jsonb(old));
  end if;
  insert into public.journal_audit (organisation_id, user_id, action, table_nom, ligne_id, avant, apres)
  values ((v_ligne ->> 'organisation_id')::uuid, (select auth.uid()), tg_op, tg_table_name,
          (v_ligne ->> 'id')::uuid, v_avant, v_apres);
  return null;
end;
$$;

-- Purge de conservation : rôle service uniquement (cron). La durée est
-- passée par l'appelant depuis la configuration (À VÉRIFIER : durée retenue).
create or replace function public.purger_journal_audit(p_avant timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  if p_avant > now() - interval '1 year' then
    raise exception 'Purge refusée : date trop récente.' using errcode = 'P0001';
  end if;
  perform set_config('hdecor.purge_journal', 'on', true);
  delete from public.journal_audit where cree_le < p_avant;
  get diagnostics n = row_count;
  perform set_config('hdecor.purge_journal', 'off', true);
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Numérotation : DEV-AAAA-0001, FAC-AAAA-0001, AVO-AAAA-0001.
-- Pas de SEQUENCE PostgreSQL : une séquence ne revient pas en arrière quand la
-- transaction échoue, ce qui crée des trous. Ici, le compteur est une ligne
-- verrouillée par l'UPDATE ; si la transaction d'émission échoue, le compteur
-- revient avec elle. Résultat : ni trou ni doublon, même en concurrence.
-- Le numéro n'est attribué qu'à l'émission (un brouillon n'a pas de numéro).
-- -----------------------------------------------------------------------------

create table public.sequences_documents (
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  type            text not null check (type in ('DEV', 'FAC', 'AVO')),
  annee           integer not null check (annee between 2000 and 2999),
  dernier         integer not null check (dernier >= 0),
  primary key (organisation_id, type, annee)
);
alter table public.sequences_documents enable row level security;
create policy sequences_lecture on public.sequences_documents
  for select to authenticated using (public.est_membre(organisation_id));
-- Écriture : uniquement via prochain_numero(), appelée par les fonctions d'émission.

create or replace function public.prochain_numero(p_organisation_id uuid, p_type text, p_annee integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.sequences_documents as s (organisation_id, type, annee, dernier)
  values (p_organisation_id, p_type, p_annee, 1)
  on conflict (organisation_id, type, annee)
  do update set dernier = s.dernier + 1
  returning s.dernier into v_n;

  return p_type || '-' || p_annee::text || '-' || lpad(v_n::text, 4, '0');
end;
$$;

-- prochain_numero n'est jamais appelable directement depuis l'API.
revoke execute on function public.prochain_numero(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.appliquer_rls_standard(regclass) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Formes strictes des JSON de montants : aucune clé libre (sinon du texte
-- arbitraire, éventuellement personnel, pourrait être figé dans un document
-- émis et dans le journal).
-- -----------------------------------------------------------------------------
create or replace function public.ventilation_bien_formee(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> 'object'
          or (select array_agg(k order by k) from jsonb_object_keys(e) k)
             is distinct from array['base_ht_cents', 'taux_bp', 'tva_cents']
          or jsonb_typeof(e -> 'taux_bp') <> 'number'
          or jsonb_typeof(e -> 'base_ht_cents') <> 'number'
          or jsonb_typeof(e -> 'tva_cents') <> 'number'
          or (e ->> 'taux_bp') !~ '^[0-9]+$'
          or (e ->> 'base_ht_cents') !~ '^-?[0-9]+$'
          or (e ->> 'tva_cents') !~ '^-?[0-9]+$');
$$;

create or replace function public.deductions_bien_formees(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'array'
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> 'object'
          or (select array_agg(k order by k) from jsonb_object_keys(e) k)
             is distinct from array['facture_id', 'ht', 'numero', 'ttc', 'tva']
          or (e ->> 'facture_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or (e ->> 'numero') !~ '^FAC-[0-9]{4}-[0-9]{4,}$'
          or jsonb_typeof(e -> 'ht') <> 'number' or jsonb_typeof(e -> 'tva') <> 'number'
          or jsonb_typeof(e -> 'ttc') <> 'number'
          or (e ->> 'ht') !~ '^[0-9]+$' or (e ->> 'tva') !~ '^[0-9]+$' or (e ->> 'ttc') !~ '^[0-9]+$');
$$;
