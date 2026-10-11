-- =============================================================================
-- H'DECOR : déploiement initial du schéma (Supabase, SQL Editor)
-- FICHIER GÉNÉRÉ par scripts/deploiement/generer-migrations.sh : ne pas modifier.
--
-- Contenu : les migrations de supabase/migrations, dans l'ordre, en UNE seule
-- transaction (tout passe ou rien ne change), puis leur enregistrement dans
-- supabase_migrations.schema_migrations (mêmes colonnes et mêmes valeurs que
-- `supabase db push` 2.120.0). Pas de seed.sql (il n'y en a pas).
--
-- À exécuter UNE fois, sur un projet VIDE, dans SQL Editor (rôle postgres).
-- Une seconde exécution est refusée dès la première ligne.
-- =============================================================================

begin;

do $garde$
declare
  v_deja boolean := to_regclass('public.organisations') is not null;
begin
  -- Requête dynamique : la table d'historique peut ne pas exister encore.
  if not v_deja and to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select exists (select 1 from supabase_migrations.schema_migrations where version <= ''20261019000100'')' into v_deja;
  end if;
  if v_deja then
    raise exception 'Schéma H''DECOR déjà présent : ce script ne s''applique qu''à un projet vide.';
  end if;
end
$garde$;


-- =============================================================================
-- Migration 20261008000100_socle.sql
-- =============================================================================

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


-- =============================================================================
-- Migration 20261008000200_parametres_clients.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : paramètres de l'entreprise, assurances, taux de TVA, clients.
-- Aucune valeur légale ou fiscale n'est posée en dur comme « vraie » : les
-- valeurs par défaut non confirmées portent un drapeau a_verifier = true,
-- affiché « À VÉRIFIER » dans l'interface.
-- =============================================================================

create type public.regime_tva as enum ('franchise', 'assujetti');

create table public.parametres_entreprise (
  organisation_id         uuid primary key references public.organisations (id) on delete restrict,

  -- Identité (saisie dans les Paramètres, jamais en dur dans le code)
  raison_sociale          text,
  forme_juridique         text not null default 'EI',
  nom_dirigeant           text,
  siret                   text check (siret is null or siret ~ '^[0-9]{14}$'),
  immatriculation         text,          -- RNE / RM : libellé exact À VÉRIFIER (comptable)
  adresse_ligne1          text,
  adresse_ligne2          text,
  code_postal             text check (code_postal is null or code_postal ~ '^[0-9]{5}$'),
  ville                   text,
  telephone               text,
  email                   text,
  logo_chemin             text,          -- objet du bucket privé « marque »
  iban                    text,
  bic                     text,

  -- Statut fiscal : pilote tout le moteur de documents
  regime_tva              public.regime_tva not null default 'franchise',
  mention_franchise       text not null default 'TVA non applicable, art. 293 B du CGI',
  mention_franchise_a_verifier boolean not null default true,
  numero_tva_intra        text,

  -- Médiateur de la consommation
  mediateur_nom           text,
  mediateur_coordonnees   text,
  mediateur_site          text,

  -- Conditions par défaut (toutes À VÉRIFIER tant que Yorick / le comptable
  -- ne les a pas confirmées)
  -- Plafonds légaux de délai : paramétrables, À VÉRIFIER (aucun plafond codé en dur).
  delai_paiement_jours    integer not null default 30 check (delai_paiement_jours between 0 and 365),
  delai_paiement_max_jours integer not null default 60 check (delai_paiement_max_jours between 0 and 365),
  taux_penalites_bp       integer check (taux_penalites_bp is null or taux_penalites_bp between 0 and 10000),
  indemnite_recouvrement_cents bigint not null default 4000 check (indemnite_recouvrement_cents >= 0),
  escompte_texte          text not null default 'Pas d''escompte pour paiement anticipé.',
  validite_devis_jours    integer not null default 30 check (validite_devis_jours between 1 and 365),
  acompte_pct_defaut_bp   integer not null default 3000 check (acompte_pct_defaut_bp between 0 and 10000),
  -- Valeurs encore À VÉRIFIER, confirmables une par une (codes des colonnes).
  valeurs_a_verifier      text[] not null default array[
    'delai_paiement_jours', 'delai_paiement_max_jours', 'indemnite_recouvrement_cents',
    'escompte_texte', 'validite_devis_jours', 'acompte_pct_defaut_bp', 'taux_penalites_bp'],

  -- Calcul
  marge_perte_bp          integer not null default 1000 check (marge_perte_bp between 0 and 5000),
  coef_marge_bp           integer not null default 10000 check (coef_marge_bp between 10000 and 50000),
  taux_horaire_cents      bigint check (taux_horaire_cents is null or taux_horaire_cents >= 0),

  -- Relances
  relance_devis_active    boolean not null default true,
  relance_devis_jours     integer not null default 7 check (relance_devis_jours between 1 and 90),

  -- Seuils micro-entreprise : AUCUNE valeur par défaut. La jauge reste masquée
  -- tant que les seuils n'ont pas été saisis et confirmés (À VÉRIFIER).
  seuil_ca_micro_cents    bigint check (seuil_ca_micro_cents is null or seuil_ca_micro_cents > 0),
  seuil_franchise_tva_cents bigint check (seuil_franchise_tva_cents is null or seuil_franchise_tva_cents > 0),
  seuils_confirmes_le     date,
  -- Paliers d'alerte de la jauge (cahier des charges : 80 % et 95 %)
  seuil_alerte_1_bp       integer not null default 8000 check (seuil_alerte_1_bp between 0 and 10000),
  seuil_alerte_2_bp       integer not null default 9500 check (seuil_alerte_2_bp between 0 and 10000),
  check (seuil_alerte_1_bp <= seuil_alerte_2_bp),

  mentions_pied           text,
  avis_google_url         text,

  updated_at              timestamptz not null default now()
);
select public.appliquer_rls_standard('public.parametres_entreprise');
create trigger parametres_updated_at before update on public.parametres_entreprise
  for each row execute function public.maj_updated_at();
create trigger parametres_audit after insert or update or delete on public.parametres_entreprise
  for each row execute function public.tracer_audit();

create table public.assurances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in ('decennale', 'rc_pro')),
  assureur          text not null,
  numero_contrat    text not null,
  debut             date not null,
  fin               date,
  zone_couverte     text not null,
  attestation_chemin text,
  created_at        timestamptz not null default now(),
  unique (organisation_id, id),
  check (fin is null or fin >= debut)
);
select public.appliquer_rls_standard('public.assurances');

-- Taux de TVA proposés dans l'interface (paramétrables).
create table public.taux_tva (
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  taux_bp          integer not null check (taux_bp between 0 and 10000),
  libelle          text not null,
  -- Taux réduit soumis à attestation du client : paramétrable, À VÉRIFIER.
  attestation_requise boolean not null default false,
  a_verifier       boolean not null default true,
  actif            boolean not null default true,
  primary key (organisation_id, taux_bp)
);
select public.appliquer_rls_standard('public.taux_tva');

-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------

create type public.type_client as enum ('particulier', 'professionnel');

create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  type                public.type_client not null default 'particulier',
  civilite            text,
  nom                 text not null check (length(nom) between 1 and 200),
  prenom              text,
  raison_sociale      text,
  siret               text check (siret is null or siret ~ '^[0-9]{14}$'),
  tva_intra           text,
  email               text,
  telephone           text,
  fact_ligne1         text,
  fact_ligne2         text,
  fact_code_postal    text,
  fact_ville          text,
  fact_pays           text not null default 'France',
  notes               text,
  source              text,
  consentement_le     timestamptz,
  anonymise_le        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, id),
  check (type = 'particulier' or raison_sociale is not null or anonymise_le is not null)
);
create index clients_recherche_idx on public.clients
  using gin (to_tsvector('simple', coalesce(nom, '') || ' ' || coalesce(prenom, '') || ' ' || coalesce(raison_sociale, '')));
create index clients_org_nom_idx on public.clients (organisation_id, nom);
select public.appliquer_rls_standard('public.clients');
create trigger clients_updated_at before update on public.clients
  for each row execute function public.maj_updated_at();

-- L'anonymisation (anonymiser_client) est définie en fin de schéma (0800),
-- car elle touche aussi chantiers, devis, envois, photos et documents.


-- =============================================================================
-- Migration 20261008000300_catalogue.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : catalogue (produits, conditionnements, historique des prix,
-- teintes, prestations, étapes de préparation).
-- Règle : aucune référence ni aucun prix n'est présenté comme vérifié sans
-- source. Les lignes d'exemple livrées sont marquées « fictif ».
-- =============================================================================

create type public.statut_verification as enum ('verifie', 'a_verifier', 'fictif');

create table public.produits (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  marque                text not null,
  gamme                 text,
  reference_fabricant   text,
  designation           text not null,
  type                  text not null check (type in (
                          'sous_couche', 'impression', 'acrylique', 'glycero', 'laque', 'facade',
                          'lasure', 'vernis', 'enduit', 'anti_humidite', 'anti_rouille',
                          'sous_couche_bloquante', 'autre')),
  usages                text[] not null default '{}'
                          check (usages <@ array['mur', 'plafond', 'boiserie', 'metal', 'exterieur', 'sol']::text[]),
  finition              text check (finition is null or finition in ('mat', 'velours', 'satin', 'brillant')),
  unite_mesure          text not null default 'L' check (unite_mesure in ('L', 'kg')),
  -- Rendement en m² par litre (ou par kg), 2 décimales, par couche
  rendement_m2_par_unite numeric(6, 2) check (rendement_m2_par_unite is null or rendement_m2_par_unite > 0),
  couches_recommandees  smallint check (couches_recommandees is null or couches_recommandees between 1 and 5),
  sechage_recouvrable_h numeric(5, 1) check (sechage_recouvrable_h is null or sechage_recouvrable_h >= 0),
  fournisseur           text,
  fiche_technique_url   text,
  statut_verification   public.statut_verification not null default 'a_verifier',
  verifie_le            date,
  source_verification   text,
  actif                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id),
  -- « vérifié » exige une date et une source
  check (statut_verification <> 'verifie' or (verifie_le is not null and source_verification is not null))
);
create index produits_org_idx on public.produits (organisation_id, marque, designation);
select public.appliquer_rls_standard('public.produits');
create trigger produits_updated_at before update on public.produits
  for each row execute function public.maj_updated_at();

-- Formats disponibles. Volume en millilitres (ou grammes) entiers.
create table public.conditionnements (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  produit_id            uuid not null,
  contenance            integer not null check (contenance > 0),  -- ml ou g
  prix_achat_ht_cents   bigint check (prix_achat_ht_cents is null or prix_achat_ht_cents >= 0),
  actif                 boolean not null default true,
  unique (organisation_id, id),
  unique (produit_id, contenance),
  -- Un produit ou un format ne se supprime pas (il s'archive avec actif = false) :
  -- l'historique des prix doit survivre.
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.conditionnements');

create table public.historique_prix (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  conditionnement_id    uuid not null,
  prix_achat_ht_cents   bigint not null check (prix_achat_ht_cents >= 0),
  date_effet            date not null default public.aujourd_hui_paris(),
  created_at            timestamptz not null default now(),
  foreign key (organisation_id, conditionnement_id) references public.conditionnements (organisation_id, id) on delete restrict
);
create index historique_prix_idx on public.historique_prix (conditionnement_id, date_effet desc);
select public.appliquer_rls_standard('public.historique_prix');

-- Toute modification de prix laisse une trace datée.
-- SECURITY DEFINER : l'historique n'est écrit que par ce trigger (l'API n'a
-- aucun droit d'écriture sur historique_prix).
create or replace function public.historiser_prix()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.prix_achat_ht_cents is not null
     and (tg_op = 'INSERT' or new.prix_achat_ht_cents is distinct from old.prix_achat_ht_cents) then
    insert into public.historique_prix (organisation_id, conditionnement_id, prix_achat_ht_cents)
    values (new.organisation_id, new.id, new.prix_achat_ht_cents);
  end if;
  return null;
end;
$$;
create trigger conditionnements_historique after insert or update on public.conditionnements
  for each row execute function public.historiser_prix();

create table public.teintes (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  nom               text not null,
  marque            text,
  code_ral          text,
  code_ncs          text,
  code_fabricant    text,
  apercu_hex        text check (apercu_hex is null or apercu_hex ~ '^#[0-9A-Fa-f]{6}$'),
  statut_verification public.statut_verification not null default 'a_verifier',
  created_at        timestamptz not null default now(),
  unique (organisation_id, id)
);
select public.appliquer_rls_standard('public.teintes');

-- Bibliothèque de prestations réutilisables
create table public.prestations (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  libelle               text not null,
  description           text,
  unite                 text not null check (unite in ('m2', 'ml', 'u', 'h', 'forfait')),
  prix_unitaire_ht_cents bigint not null check (prix_unitaire_ht_cents >= 0),
  taux_tva_bp           integer not null check (taux_tva_bp between 0 and 10000),
  actif                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id)
);
select public.appliquer_rls_standard('public.prestations');
create trigger prestations_updated_at before update on public.prestations
  for each row execute function public.maj_updated_at();

-- Étapes de préparation paramétrables (temps et matière par m²).
-- Valeurs livrées : toutes « a_verifier ».
create table public.etapes_preparation (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  code                    text not null,
  libelle                 text not null,
  minutes_par_m2          numeric(6, 2) not null default 0 check (minutes_par_m2 >= 0),
  produit_id              uuid,
  consommation_par_m2     numeric(8, 4) check (consommation_par_m2 is null or consommation_par_m2 >= 0), -- L ou kg / m²
  statut_verification     public.statut_verification not null default 'a_verifier',
  ordre                   smallint not null default 0,
  actif                   boolean not null default true,
  unique (organisation_id, id),
  unique (organisation_id, code),
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.etapes_preparation');

-- Rendements et temps de pose par défaut, par type de produit (paramétrables).
create table public.referentiel_calcul (
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  type_produit            text not null,
  rendement_min           numeric(6, 2) not null check (rendement_min > 0),
  rendement_max           numeric(6, 2) not null check (rendement_max >= rendement_min),
  minutes_par_m2_couche   numeric(6, 2) check (minutes_par_m2_couche is null or minutes_par_m2_couche >= 0),
  statut_verification     public.statut_verification not null default 'a_verifier',
  primary key (organisation_id, type_produit)
);
select public.appliquer_rls_standard('public.referentiel_calcul');

-- Coefficient de rendement par support (support poreux = rendement réduit).
create table public.coefficients_support (
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  support                 text not null,
  coef_rendement_bp       integer not null default 10000 check (coef_rendement_bp between 1000 and 15000),
  statut_verification     public.statut_verification not null default 'a_verifier',
  primary key (organisation_id, support)
);
select public.appliquer_rls_standard('public.coefficients_support');


-- =============================================================================
-- Migration 20261008000400_chantiers_metre.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : chantiers, pièces, ouvertures, éléments, postes de travaux.
-- Les dimensions sont stockées en millimètres entiers : les surfaces se
-- calculent alors exactement en mm² (31,9268 m² = 31 926 800 mm²), sans
-- erreur de virgule flottante. Les calculs eux-mêmes vivent dans
-- src/domain (une seule implémentation, testée) ; la base ne stocke que la
-- saisie.
-- =============================================================================

-- « facturé » et « payé » sont DÉRIVÉS des factures (vue v_chantiers), pas stockés.
create type public.statut_chantier as enum ('a_planifier', 'en_cours', 'termine');

create table public.chantiers (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  client_id             uuid not null,
  nom                   text not null,
  adresse_ligne1        text,
  adresse_ligne2        text,
  code_postal           text,
  ville                 text,
  statut                public.statut_chantier not null default 'a_planifier',
  date_debut_prevue     date,
  duree_estimee_jours   numeric(5, 1) check (duree_estimee_jours is null or duree_estimee_jours >= 0),
  teinte_id             uuid,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict
);
create index chantiers_client_idx on public.chantiers (organisation_id, client_id);
create index chantiers_statut_idx on public.chantiers (organisation_id, statut);
select public.appliquer_rls_standard('public.chantiers');
create trigger chantiers_updated_at before update on public.chantiers
  for each row execute function public.maj_updated_at();

create table public.pieces (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  chantier_id       uuid not null,
  nom               text not null,
  etage             text,
  mode_saisie       text not null default 'rectangle' check (mode_saisie in ('rectangle', 'murs')),
  longueur_mm       integer check (longueur_mm is null or longueur_mm between 1 and 100000),
  largeur_mm        integer check (largeur_mm is null or largeur_mm between 1 and 100000),
  murs_mm           integer[],                 -- mode « murs » : longueur de chaque mur
  surface_sol_mm2   bigint check (surface_sol_mm2 is null or surface_sol_mm2 > 0), -- plafond non rectangulaire
  hauteur_mm        integer not null check (hauteur_mm between 1 and 20000),
  etat_support      text,
  multiplicateur    smallint not null default 1 check (multiplicateur between 1 and 50), -- « x chambres identiques »
  teinte_id         uuid,
  notes             text,
  ordre             smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict,
  check (
    (mode_saisie = 'rectangle' and longueur_mm is not null and largeur_mm is not null)
    or (mode_saisie = 'murs' and murs_mm is not null and cardinality(murs_mm) between 3 and 30
        and 0 < all (murs_mm))
  )
);
create index pieces_chantier_idx on public.pieces (organisation_id, chantier_id, ordre);
select public.appliquer_rls_standard('public.pieces');
create trigger pieces_updated_at before update on public.pieces
  for each row execute function public.maj_updated_at();

-- Ouvertures à déduire : dimensions OU surface directe.
create table public.ouvertures (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  piece_id              uuid not null,
  type                  text not null check (type in ('porte', 'fenetre', 'baie', 'autre')),
  largeur_mm            integer check (largeur_mm is null or largeur_mm > 0),
  hauteur_mm            integer check (hauteur_mm is null or hauteur_mm > 0),
  surface_directe_mm2   bigint check (surface_directe_mm2 is null or surface_directe_mm2 > 0),
  quantite              smallint not null default 1 check (quantite between 1 and 100),
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade,
  check ((largeur_mm is not null and hauteur_mm is not null) <> (surface_directe_mm2 is not null))
);
select public.appliquer_rls_standard('public.ouvertures');

-- Éléments : plinthes, corniches (ml), menuiseries, radiateurs, etc.
create table public.elements (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  piece_id          uuid not null,
  type              text not null check (type in (
                      'plinthe', 'corniche', 'porte', 'fenetre', 'radiateur', 'volet',
                      'escalier', 'rambarde', 'autre')),
  unite             text not null check (unite in ('ml', 'm2', 'u')),
  quantite_e4       bigint not null check (quantite_e4 > 0),  -- quantité × 10 000 (4 décimales exactes)
  faces             smallint not null default 1 check (faces between 1 and 2),
  notes             text,
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade
);
select public.appliquer_rls_standard('public.elements');

-- Poste de travaux : une surface (ou un élément) + support + préparation + finition.
create table public.postes_travaux (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  piece_id              uuid not null,
  cible                 text not null check (cible in ('murs', 'plafond', 'element')),
  element_id            uuid,
  support               text not null check (support in (
                          'platre_neuf', 'ancienne_peinture', 'beton', 'enduit', 'bois_brut',
                          'bois_vernis', 'metal', 'papier_peint', 'carrelage', 'autre')),
  zone_humide           boolean not null default false,
  taches                boolean not null default false,
  produit_id            uuid,
  teinte_id             uuid,
  finition              text check (finition is null or finition in ('mat', 'velours', 'satin', 'brillant')),
  couches               smallint not null default 2 check (couches between 1 and 5),
  rendement_force       numeric(6, 2) check (rendement_force is null or rendement_force > 0),
  marge_perte_bp        integer check (marge_perte_bp is null or marge_perte_bp between 0 and 5000),
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade,
  foreign key (organisation_id, element_id) references public.elements (organisation_id, id) on delete cascade,
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict,
  check ((cible = 'element') = (element_id is not null))
);
select public.appliquer_rls_standard('public.postes_travaux');

create table public.postes_preparations (
  organisation_id   uuid not null,
  poste_id          uuid not null,
  etape_id          uuid not null,
  primary key (poste_id, etape_id),
  foreign key (organisation_id, poste_id) references public.postes_travaux (organisation_id, id) on delete cascade,
  foreign key (organisation_id, etape_id) references public.etapes_preparation (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.postes_preparations');

-- Temps réellement passé (rentabilité réelle vs prévu, §5.8 / §5.10).
create table public.temps_passes (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  jour              date not null,
  minutes           integer not null check (minutes between 1 and 1440),
  tache             text,
  note              text,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
);
create index temps_passes_chantier_idx on public.temps_passes (organisation_id, chantier_id, jour);
select public.appliquer_rls_standard('public.temps_passes');


-- =============================================================================
-- Migration 20261008000500_devis.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : devis, lignes, signatures, liens publics.
--
-- Cycle de vie :
--   brouillon  --emettre_devis()-->  envoye  --signature-->  accepte
--                                       |--refuser_devis()--> refuse
--                                       |--nouvelle_version_devis()--> remplace
-- « consulté » et « expiré » sont des états DÉRIVÉS (consulte_le, date de
-- validité) exposés par la vue v_devis, pas des statuts stockés.
--
-- Immuabilité : dès que le devis quitte « brouillon », son contenu et ses
-- lignes sont figés par trigger. Les colonnes de cycle de vie ne sont pas
-- modifiables par l'API (privilèges de colonne) : seules les fonctions
-- dédiées les changent.
-- =============================================================================

create type public.statut_devis as enum ('brouillon', 'envoye', 'accepte', 'refuse', 'remplace');

create table public.devis (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  client_id               uuid not null,
  chantier_id             uuid,

  -- Cycle de vie (colonnes réservées aux fonctions)
  numero                  text,
  version                 smallint not null default 1 check (version between 1 and 99),
  devis_precedent_id      uuid,
  statut                  public.statut_devis not null default 'brouillon',
  date_emission           date,
  envoye_le               timestamptz,
  consulte_le             timestamptz,
  accepte_le              timestamptz,
  refuse_le               timestamptz,
  motif_refus             text,
  signature_id            uuid,

  -- Contenu (modifiable tant que brouillon)
  objet                   text,
  validite_jours          integer not null check (validite_jours between 1 and 365),
  date_debut_travaux      date,
  delai_debut_texte       text,
  duree_estimee_jours     numeric(5, 1) check (duree_estimee_jours is null or duree_estimee_jours > 0),
  acompte_pct_bp          integer not null default 0 check (acompte_pct_bp between 0 and 10000),
  conditions_paiement     text,
  hors_etablissement      boolean not null default true,
  regime_tva              public.regime_tva not null,
  remise_globale_bp       integer not null default 0 check (remise_globale_bp between 0 and 10000),
  notes_client            text,

  -- Totaux calculés par src/domain, contrôlés à l'émission
  total_ht_cents          bigint not null default 0 check (total_ht_cents >= 0),
  total_tva_cents         bigint not null default 0 check (total_tva_cents >= 0),
  total_ttc_cents         bigint not null default 0 check (total_ttc_cents >= 0),
  ventilation_tva         jsonb not null default '[]'::jsonb,  -- [{taux_bp, base_ht_cents, tva_cents}]
  -- Totaux après choix des options par le client (fixés à la signature)
  total_accepte_ht_cents  bigint,
  total_accepte_tva_cents bigint,
  total_accepte_ttc_cents bigint,
  ventilation_acceptee    jsonb,
  check (total_accepte_ht_cents is null or (total_accepte_ht_cents >= 0 and total_accepte_tva_cents >= 0
         and total_accepte_ttc_cents = total_accepte_ht_cents + total_accepte_tva_cents)),

  -- Copies figées à l'émission : le document reste identique même si les
  -- paramètres ou la fiche client changent ensuite.
  copie_emetteur          jsonb,
  copie_client            jsonb,
  copie_chantier          jsonb,
  pdf_chemin              text,
  pdf_sha256              text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (organisation_id, id),
  unique (organisation_id, numero, version),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, devis_precedent_id) references public.devis (organisation_id, id) on delete restrict,
  check (total_ttc_cents = total_ht_cents + total_tva_cents),
  check (regime_tva = 'assujetti' or total_tva_cents = 0),
  check (statut = 'brouillon' or (numero is not null and date_emission is not null and pdf_sha256 is not null)),
  check (public.ventilation_bien_formee(ventilation_tva)),
  check (ventilation_acceptee is null or public.ventilation_bien_formee(ventilation_acceptee))
);
create index devis_client_idx on public.devis (organisation_id, client_id);
create index devis_statut_idx on public.devis (organisation_id, statut, date_emission desc);

create type public.type_ligne as enum ('section', 'ligne', 'sous_total', 'texte');

create table public.devis_lignes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  devis_id              uuid not null,
  ordre                 integer not null,
  type                  public.type_ligne not null default 'ligne',
  designation           text not null,
  description           text,
  quantite_e4           bigint check (quantite_e4 is null or quantite_e4 >= 0),  -- quantité × 10 000
  unite                 text check (unite is null or unite in ('m2', 'ml', 'u', 'h', 'forfait', 'L', 'kg')),
  prix_unitaire_ht_cents bigint check (prix_unitaire_ht_cents is null or prix_unitaire_ht_cents >= 0),
  remise_bp             integer not null default 0 check (remise_bp between 0 and 10000),
  taux_tva_bp           integer check (taux_tva_bp is null or taux_tva_bp between 0 and 10000),
  total_ht_cents        bigint check (total_ht_cents is null or total_ht_cents >= 0),
  optionnelle           boolean not null default false,
  origine               jsonb,      -- trace du calcul (pièce, poste, surface) pour le détail
  -- Prévu, figé avec le devis : base de la marge réelle vs prévue (§5.8)
  cout_matiere_prevu_cents bigint check (cout_matiere_prevu_cents is null or cout_matiere_prevu_cents >= 0),
  minutes_prevues       integer check (minutes_prevues is null or minutes_prevues >= 0),
  unique (organisation_id, id),
  unique (devis_id, ordre),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  check (type <> 'ligne' or (quantite_e4 is not null and unite is not null
                             and prix_unitaire_ht_cents is not null and taux_tva_bp is not null
                             and total_ht_cents is not null)),
  -- R4 : total de ligne = arrondi demi-supérieur(quantité x PU x (1 - remise)).
  check (type <> 'ligne' or total_ht_cents = floor(
    (quantite_e4::numeric * prix_unitaire_ht_cents * (10000 - remise_bp) + 50000000) / 100000000))
);

select public.appliquer_rls_standard('public.devis');
select public.appliquer_rls_standard('public.devis_lignes');

-- Colonnes de cycle de vie : hors de portée de l'API.
revoke insert, update on public.devis from authenticated;
grant insert (id, organisation_id, client_id, chantier_id, objet, validite_jours, date_debut_travaux,
              delai_debut_texte, duree_estimee_jours, acompte_pct_bp, conditions_paiement,
              hors_etablissement, regime_tva, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  on public.devis to authenticated;
grant update (client_id, chantier_id, objet, validite_jours, date_debut_travaux,
              delai_debut_texte, duree_estimee_jours, acompte_pct_bp, conditions_paiement,
              hors_etablissement, regime_tva, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  on public.devis to authenticated;

create trigger devis_updated_at before update on public.devis
  for each row execute function public.maj_updated_at();
create trigger devis_audit after insert or update or delete on public.devis
  for each row execute function public.tracer_audit();
create trigger devis_lignes_audit after insert or update or delete on public.devis_lignes
  for each row execute function public.tracer_audit();

-- Gel du devis après émission.
create or replace function public.proteger_devis()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_modifiables text[] := array[
    'statut', 'consulte_le', 'accepte_le', 'refuse_le', 'motif_refus', 'signature_id',
    'total_accepte_ht_cents', 'total_accepte_tva_cents', 'total_accepte_ttc_cents',
    'ventilation_acceptee', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Un devis envoyé ne peut pas être supprimé.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.statut = 'brouillon' then
    return new;
  end if;

  -- Anonymisation RGPD d'un devis jamais accepté (pas d'obligation de
  -- conservation comptable) : uniquement via anonymiser_client().
  -- Seules les valeurs anonymisées CONSTANTES sont admises, et seulement sur
  -- un devis qui ne peut plus être signé (refusé ou remplacé).
  if current_setting('hdecor.anonymisation', true) = 'on'
     and current_user not in ('authenticated', 'anon') and old.statut in ('refuse', 'remplace')
     and new.statut = old.statut
     and new.copie_client = '{"nom_affiche": "Client anonymisé"}'::jsonb
     and new.copie_chantier = '{}'::jsonb and new.objet is null
     and new.notes_client is null and new.conditions_paiement is null and new.delai_debut_texte is null
     and (new.motif_refus is not distinct from (case when old.statut = 'refuse' then 'Anonymisation (RGPD)' end)) then
    v_modifiables := v_modifiables || array['copie_client', 'copie_chantier', 'objet', 'notes_client',
                                            'conditions_paiement', 'delai_debut_texte'];
  end if;
  if (to_jsonb(new) - v_modifiables) is distinct from (to_jsonb(old) - v_modifiables) then
    raise exception 'Un devis envoyé est figé : créez une nouvelle version.' using errcode = 'P0001';
  end if;

  if new.statut is distinct from old.statut and not (
       (old.statut = 'envoye' and new.statut in ('accepte', 'refuse', 'remplace'))
  ) then
    raise exception 'Changement de statut de devis interdit : % -> %.', old.statut, new.statut
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger devis_protection before update or delete on public.devis
  for each row execute function public.proteger_devis();

create or replace function public.proteger_devis_lignes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Anonymisation RGPD des lignes d'un devis jamais accepté : seul le texte
  -- est remplacé par une valeur constante, rien d'autre ne change.
  -- (IF imbriqués : le trigger sert aussi à devis_achats et devis_echeances,
  -- qui n'ont pas de colonne designation.)
  if tg_op = 'UPDATE' and tg_table_name in ('devis_lignes', 'devis_echeances')
     and current_setting('hdecor.anonymisation', true) = 'on'
     and current_user not in ('authenticated', 'anon')
     and exists (select 1 from public.devis d where d.id = old.devis_id and d.statut in ('refuse', 'remplace')) then
    if tg_table_name = 'devis_lignes'
       and to_jsonb(new) ->> 'designation' = 'Prestation (anonymisée)'
       and to_jsonb(new) -> 'description' = 'null'::jsonb and to_jsonb(new) -> 'origine' = 'null'::jsonb
       and (to_jsonb(new) - array['designation', 'description', 'origine'])
           = (to_jsonb(old) - array['designation', 'description', 'origine']) then
      return new;
    end if;
    if tg_table_name = 'devis_echeances'
       and to_jsonb(new) ->> 'libelle' = 'Échéance (anonymisée)'
       and (to_jsonb(new) - 'libelle') = (to_jsonb(old) - 'libelle') then
      return new;
    end if;
  end if;
  -- On contrôle l'ancien ET le nouveau devis : déplacer une ligne d'un
  -- brouillon vers un devis envoyé est aussi interdit. Un devis supprimé dans
  -- la même opération (cascade d'un brouillon) n'a plus rien à protéger.
  if exists (
    select 1 from public.devis d
    where d.statut <> 'brouillon'
      and d.id in (case when tg_op <> 'INSERT' then old.devis_id end,
                   case when tg_op <> 'DELETE' then new.devis_id end)
  ) then
    raise exception 'Les lignes d''un devis envoyé sont figées.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger devis_lignes_protection before insert or update or delete on public.devis_lignes
  for each row execute function public.proteger_devis_lignes();

-- Achats retenus pour le devis : conditionnement et prix d'achat au moment du
-- chiffrage. Sert à l'alerte « le prix a changé depuis le devis » (§5.5) et au
-- coût matière prévu. Figés avec le devis (même trigger que les lignes).
create table public.devis_achats (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null,
  devis_id                uuid not null,
  conditionnement_id      uuid not null,
  teinte_id               uuid,
  nombre                  integer not null check (nombre between 1 and 10000),
  prix_achat_retenu_cents bigint check (prix_achat_retenu_cents is null or prix_achat_retenu_cents >= 0),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  foreign key (organisation_id, conditionnement_id) references public.conditionnements (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict
);
create index devis_achats_devis_idx on public.devis_achats (organisation_id, devis_id);
create index devis_achats_cond_idx on public.devis_achats (organisation_id, conditionnement_id);
select public.appliquer_rls_standard('public.devis_achats');
create trigger devis_achats_protection before insert or update or delete on public.devis_achats
  for each row execute function public.proteger_devis_lignes();

-- Échéancier d'acompte et de paiement (§5.6), figé avec le devis.
-- Alimente la trésorerie prévisionnelle (« acomptes attendus »).
create table public.devis_echeances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  devis_id          uuid not null,
  ordre             smallint not null,
  libelle           text not null,
  pourcentage_bp    integer not null check (pourcentage_bp between 1 and 10000),
  declencheur       text not null check (declencheur in ('signature', 'debut_travaux', 'mi_chantier', 'fin_travaux', 'date')),
  date_prevue       date,
  unique (devis_id, ordre),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  check ((declencheur = 'date') = (date_prevue is not null))
);
select public.appliquer_rls_standard('public.devis_echeances');
create trigger devis_echeances_protection before insert or update or delete on public.devis_echeances
  for each row execute function public.proteger_devis_lignes();

-- -----------------------------------------------------------------------------
-- Contrôle des totaux (garde-fou en base ; le calcul lui-même est dans
-- src/domain). Vérifie : somme des lignes, ventilation par taux, arrondi de la
-- TVA par taux (demi au-dessus), TTC = HT + TVA.
-- -----------------------------------------------------------------------------

create or replace function public.controler_ventilation(
  p_ventilation jsonb, p_total_ht bigint, p_total_tva bigint, p_regime public.regime_tva)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_base_somme bigint := 0;
  v_tva_somme  bigint := 0;
  v_item       jsonb;
  v_base       bigint;
  v_tva        bigint;
  v_taux       integer;
begin
  for v_item in select * from jsonb_array_elements(p_ventilation) loop
    v_taux := (v_item ->> 'taux_bp')::integer;
    v_base := (v_item ->> 'base_ht_cents')::bigint;
    v_tva  := (v_item ->> 'tva_cents')::bigint;
    if v_base is null or v_tva is null or v_taux is null or v_base < 0 or v_tva < 0 then
      raise exception 'Ventilation invalide (valeur manquante ou négative).' using errcode = 'P0001';
    end if;
    if p_regime = 'franchise' and v_tva <> 0 then
      raise exception 'Franchise en base : aucune TVA ne doit être facturée.' using errcode = 'P0001';
    end if;
    if p_regime = 'assujetti' and v_tva <> floor((v_base * v_taux + 5000) / 10000.0)::bigint then
      raise exception 'TVA incohérente pour le taux % : % au lieu de %.',
        v_taux, v_tva, floor((v_base * v_taux + 5000) / 10000.0)::bigint using errcode = 'P0001';
    end if;
    v_base_somme := v_base_somme + v_base;
    v_tva_somme  := v_tva_somme + v_tva;
  end loop;
  if v_base_somme <> p_total_ht or v_tva_somme <> p_total_tva then
    raise exception 'Totaux incohérents avec la ventilation de TVA.' using errcode = 'P0001';
  end if;
end;
$$;

-- Ventilation ATTENDUE, calculée par la base à partir des lignes (règle R5) :
--   remise totale = arrondi demi-supérieur(somme HT x taux de remise) ;
--   remise de chaque taux = partie entière(lignes du taux x remise totale / somme),
--   puis les centimes restants vont, un par un, aux taux de plus fort reste
--   (à reste égal : taux de TVA le plus élevé d'abord) ;
--   base = lignes du taux - remise du taux ; TVA = arrondi demi-supérieur(base x taux).
-- src/domain implémente la même règle ; la base exige l'ÉGALITÉ STRICTE.
create or replace function public.ventilation_attendue(
  p_lignes_par_taux jsonb, p_remise_bp integer, p_regime public.regime_tva)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with l as (
    select (e ->> 'taux_bp')::integer as taux, (e ->> 'somme_ht_cents')::bigint as somme
    from jsonb_array_elements(p_lignes_par_taux) e
  ),
  tot as (
    select sum(somme)::bigint as somme,
           floor((sum(somme) * p_remise_bp + 5000) / 10000.0)::bigint as remise
    from l
  ),
  parts as (
    select l.taux, l.somme,
           case when tot.somme = 0 then 0 else (l.somme * tot.remise) / tot.somme end as remise_base,
           case when tot.somme = 0 then 0 else (l.somme * tot.remise) % tot.somme end as reste,
           tot.remise as remise_totale
    from l, tot
  ),
  rang as (
    select p.*, row_number() over (order by p.reste desc, p.taux desc) as rg,
           p.remise_totale - sum(p.remise_base) over () as a_repartir
    from parts p
  ),
  bases as (
    select taux, somme - remise_base - case when rg <= a_repartir then 1 else 0 end as base
    from rang
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'taux_bp', taux, 'base_ht_cents', base,
           'tva_cents', case when p_regime = 'franchise' then 0
                             else floor((base * taux + 5000) / 10000.0)::bigint end)
         order by taux), '[]'::jsonb)
  from bases;
$$;

-- Contrôle strict : la ventilation fournie doit être exactement l'attendue
-- (mêmes taux, mêmes bases, mêmes TVA), et les totaux en découler.
create or replace function public.controler_totaux_lignes(
  p_lignes_par_taux jsonb, p_remise_bp integer, p_regime public.regime_tva,
  p_ventilation jsonb, p_total_ht bigint, p_total_tva bigint)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_attendue jsonb := public.ventilation_attendue(p_lignes_par_taux, p_remise_bp, p_regime);
  v_fournie  jsonb;
begin
  if jsonb_array_length(p_lignes_par_taux) = 0 then
    raise exception 'Aucune ligne chiffrée.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'taux_bp', (e ->> 'taux_bp')::integer, 'base_ht_cents', (e ->> 'base_ht_cents')::bigint,
           'tva_cents', (e ->> 'tva_cents')::bigint) order by (e ->> 'taux_bp')::integer), '[]'::jsonb)
    into v_fournie
  from jsonb_array_elements(p_ventilation) e;
  if v_fournie is distinct from v_attendue then
    raise exception 'Ventilation incohérente avec les lignes : % au lieu de %.', v_fournie, v_attendue
      using errcode = 'P0001';
  end if;
  if p_total_ht is distinct from (select sum((e ->> 'base_ht_cents')::bigint) from jsonb_array_elements(v_attendue) e)
     or p_total_tva is distinct from (select sum((e ->> 'tva_cents')::bigint) from jsonb_array_elements(v_attendue) e) then
    raise exception 'Totaux incohérents avec les lignes et la remise.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.lignes_devis_par_taux(p_devis_id uuid, p_options uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('taux_bp', taux_bp, 'somme_ht_cents', s)), '[]'::jsonb)
  from (
    select taux_bp_ligne as taux_bp, sum(total_ht_cents)::bigint as s
    from (select l.taux_tva_bp as taux_bp_ligne, l.total_ht_cents
          from public.devis_lignes l
          where l.devis_id = p_devis_id and l.type = 'ligne'
            and (not l.optionnelle or l.id = any (coalesce(p_options, '{}')))) x
    group by taux_bp_ligne
    having sum(total_ht_cents) > 0
  ) t;
$$;

-- -----------------------------------------------------------------------------
-- Émission d'un devis : numéro, date, copies figées, empreinte du PDF.
-- Le PDF est généré par le serveur AVANT l'appel ; son empreinte est figée ici.
-- -----------------------------------------------------------------------------

create or replace function public.emettre_devis(
  p_devis_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devis   public.devis%rowtype;
  v_numero  text;
  v_somme_lignes bigint;
  v_date    date := public.aujourd_hui_paris();
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'brouillon' then
    raise exception 'Ce devis a déjà été émis.' using errcode = 'P0001';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme_lignes
  from public.devis_lignes
  where devis_id = p_devis_id and type = 'ligne' and not optionnelle;
  if v_somme_lignes = 0 then
    raise exception 'Un devis sans ligne chiffrée ne peut pas être émis.' using errcode = 'P0001';
  end if;
  -- FOR SHARE : un changement simultané du client du chantier attend la fin
  -- de cette émission (puis est refusé par proteger_client_chantier).
  perform 1 from public.chantiers where id = v_devis.chantier_id for share;
  if v_devis.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_devis.chantier_id and c.client_id <> v_devis.client_id) then
    raise exception 'Le chantier du devis appartient à un autre client.' using errcode = 'P0001';
  end if;
  perform public.controler_totaux_lignes(public.lignes_devis_par_taux(p_devis_id, '{}'),
    v_devis.remise_globale_bp, v_devis.regime_tva, v_devis.ventilation_tva,
    v_devis.total_ht_cents, v_devis.total_tva_cents);
  perform public.controler_ventilation(v_devis.ventilation_tva, v_devis.total_ht_cents,
                                        v_devis.total_tva_cents, v_devis.regime_tva);
  if (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances where devis_id = p_devis_id) > 10000 then
    raise exception 'L''échéancier dépasse 100 %% du devis.' using errcode = 'P0001';
  end if;
  -- Une seule source pour l'acompte : s'il y a un échéancier, l'acompte du
  -- devis est la somme des échéances dues à la signature.
  if exists (select 1 from public.devis_echeances where devis_id = p_devis_id)
     and v_devis.acompte_pct_bp <> (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances
                                    where devis_id = p_devis_id and declencheur = 'signature') then
    raise exception 'L''acompte du devis ne correspond pas à l''échéancier.' using errcode = 'P0001';
  end if;

  if v_devis.devis_precedent_id is null then
    v_numero := public.prochain_numero(v_devis.organisation_id, 'DEV', extract(year from v_date)::integer);
  else
    select numero into v_numero from public.devis where id = v_devis.devis_precedent_id;
  end if;

  update public.devis set
    numero = v_numero,
    statut = 'envoye',
    date_emission = v_date,
    envoye_le = now(),
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_devis_id;

  return v_numero;
end;
$$;

create or replace function public.refuser_devis(p_devis_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  update public.devis set statut = 'refuse', refuse_le = now(), motif_refus = p_motif
  where id = p_devis_id;   -- le trigger refuse toute transition invalide
end;
$$;

-- Nouvelle version : copie le contenu et les lignes dans un brouillon v+1,
-- l'ancienne version passe à « remplace ».
create or replace function public.nouvelle_version_devis(p_devis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ancien  public.devis%rowtype;
  v_nouveau uuid := gen_random_uuid();
begin
  select * into v_ancien from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_ancien.organisation_id) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  if v_ancien.statut <> 'envoye' then
    raise exception 'Seul un devis envoyé, ni accepté ni refusé, peut être remplacé.' using errcode = 'P0001';
  end if;

  insert into public.devis (id, organisation_id, client_id, chantier_id, version, devis_precedent_id,
    objet, validite_jours, date_debut_travaux, delai_debut_texte, duree_estimee_jours, acompte_pct_bp,
    conditions_paiement, hors_etablissement, regime_tva, remise_globale_bp, notes_client,
    total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  values (v_nouveau, v_ancien.organisation_id, v_ancien.client_id, v_ancien.chantier_id,
    v_ancien.version + 1, v_ancien.id, v_ancien.objet, v_ancien.validite_jours,
    v_ancien.date_debut_travaux, v_ancien.delai_debut_texte, v_ancien.duree_estimee_jours,
    v_ancien.acompte_pct_bp, v_ancien.conditions_paiement, v_ancien.hors_etablissement,
    v_ancien.regime_tva, v_ancien.remise_globale_bp, v_ancien.notes_client,
    v_ancien.total_ht_cents, v_ancien.total_tva_cents, v_ancien.total_ttc_cents, v_ancien.ventilation_tva);

  insert into public.devis_lignes (organisation_id, devis_id, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues)
  select organisation_id, v_nouveau, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues
  from public.devis_lignes where devis_id = p_devis_id;

  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents)
  select organisation_id, v_nouveau, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents
  from public.devis_achats where devis_id = p_devis_id;

  insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur, date_prevue)
  select organisation_id, v_nouveau, ordre, libelle, pourcentage_bp, declencheur, date_prevue
  from public.devis_echeances where devis_id = p_devis_id;

  update public.devis set statut = 'remplace' where id = p_devis_id;
  return v_nouveau;
end;
$$;

-- -----------------------------------------------------------------------------
-- Signatures (devis, PV de réception, attestation de TVA).
-- Signature électronique simple : tracé, nom, horodatage serveur, IP,
-- navigateur, empreinte SHA-256 du PDF présenté. Ligne non modifiable, sauf
-- l'ajout unique du PDF signé archivé.
-- -----------------------------------------------------------------------------

create table public.signatures (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  document_type         text not null check (document_type in ('devis', 'pv_reception', 'attestation_tva')),
  document_id           uuid not null,
  methode               text not null check (methode in ('sur_place', 'lien')),
  signataire_nom        text not null check (length(signataire_nom) between 2 and 200),
  mention               text not null,                  -- ex. « Bon pour accord »
  image_chemin          text not null,
  document_sha256       text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  options_acceptees     uuid[] not null default '{}',
  ip                    inet,
  user_agent            text,
  signe_le              timestamptz not null default now(),
  pdf_signe_chemin      text,
  pdf_signe_sha256      text check (pdf_signe_sha256 is null or pdf_signe_sha256 ~ '^[0-9a-f]{64}$'),
  unique (organisation_id, id),
  unique (document_type, document_id)   -- une seule signature par document
);
alter table public.signatures enable row level security;
create policy signatures_lecture on public.signatures
  for select to authenticated using (public.est_membre(organisation_id));
-- Écriture : uniquement via les fonctions de signature.
create trigger signatures_audit after insert or update on public.signatures
  for each row execute function public.tracer_audit();

create or replace function public.proteger_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Une signature ne peut pas être supprimée.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['pdf_signe_chemin', 'pdf_signe_sha256'])
       is distinct from (to_jsonb(old) - array['pdf_signe_chemin', 'pdf_signe_sha256'])
     or old.pdf_signe_sha256 is not null then
    raise exception 'Une signature est définitive.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger signatures_protection before update or delete on public.signatures
  for each row execute function public.proteger_signature();

-- Signature d'un devis : fonction commune aux deux méthodes.
create or replace function public.signer_devis_interne(
  p_devis_id uuid, p_methode text, p_nom text, p_mention text, p_image_chemin text,
  p_document_sha256 text, p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devis public.devis%rowtype;
  v_sig   uuid;
  v_vent  jsonb;
  v_ht    bigint;
  v_tva   bigint;
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'envoye' then
    raise exception 'Ce devis ne peut plus être signé.' using errcode = 'P0001';
  end if;
  if v_devis.date_emission + v_devis.validite_jours < public.aujourd_hui_paris() then
    raise exception 'Ce devis a expiré.' using errcode = 'P0001';
  end if;
  if p_document_sha256 <> v_devis.pdf_sha256 then
    raise exception 'Le document signé ne correspond pas au devis émis.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_options) o
    where not exists (select 1 from public.devis_lignes l
                      where l.id = o and l.devis_id = p_devis_id and l.optionnelle)
  ) then
    raise exception 'Option inconnue.' using errcode = 'P0001';
  end if;

  -- Le montant accepté est CALCULÉ ici (lignes fermes + options choisies,
  -- remise, règle R5) : rien n'est fourni par l'appelant.
  v_vent := public.ventilation_attendue(public.lignes_devis_par_taux(p_devis_id, p_options),
                                        v_devis.remise_globale_bp, v_devis.regime_tva);
  select sum((e ->> 'base_ht_cents')::bigint), sum((e ->> 'tva_cents')::bigint)
    into v_ht, v_tva
  from jsonb_array_elements(v_vent) e;

  insert into public.signatures (organisation_id, document_type, document_id, methode, signataire_nom,
    mention, image_chemin, document_sha256, options_acceptees, ip, user_agent)
  values (v_devis.organisation_id, 'devis', p_devis_id, p_methode, p_nom, p_mention, p_image_chemin,
    p_document_sha256, coalesce(p_options, '{}'), p_ip, p_user_agent)
  returning id into v_sig;

  update public.devis set
    statut = 'accepte', accepte_le = now(), signature_id = v_sig,
    total_accepte_ht_cents = v_ht, total_accepte_tva_cents = v_tva,
    total_accepte_ttc_cents = v_ht + v_tva, ventilation_acceptee = v_vent
  where id = p_devis_id;
  return v_sig;
end;
$$;
revoke execute on function public.signer_devis_interne(uuid, text, text, text, text, text, uuid[], inet, text)
  from public, anon, authenticated;

-- Sur place, sur le téléphone de Yorick (session authentifiée).
create or replace function public.signer_devis_sur_place(
  p_devis_id uuid, p_nom text, p_mention text, p_image_chemin text, p_document_sha256 text,
  p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  return public.signer_devis_interne(p_devis_id, 'sur_place', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_options, p_ip, p_user_agent);
end;
$$;

-- Vue avec les états dérivés (consulté, expiré). security_invoker : la RLS
-- des tables sous-jacentes s'applique.
create view public.v_devis with (security_invoker = true) as
select d.*,
  case
    when d.statut = 'envoye' and d.date_emission + d.validite_jours < public.aujourd_hui_paris() then 'expire'
    when d.statut = 'envoye' and d.consulte_le is not null then 'consulte'
    else d.statut::text
  end as statut_affiche,
  d.date_emission + d.validite_jours as valide_jusqu_au
from public.devis d;


-- =============================================================================
-- Migration 20261008000600_factures_paiements.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : factures (acompte, situation, finale, libre), avoirs, paiements.
--
-- Statut stocké : brouillon -> emise -> annulee (par avoir total).
-- « envoyée », « partiellement payée », « payée », « en retard » sont DÉRIVÉS
-- (envoyee_le, somme des paiements, échéance) dans la vue v_factures : pas de
-- statut qui diverge de la réalité des encaissements.
--
-- Montants : toujours positifs ; le sens d'un avoir est donné par son type.
-- Une facture émise n'est ni modifiable ni supprimable, même par appel direct.
-- =============================================================================

create type public.type_facture as enum ('acompte', 'situation', 'finale', 'libre', 'avoir');
create type public.statut_facture as enum ('brouillon', 'emise', 'annulee');

create table public.factures (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  type                    public.type_facture not null,
  client_id               uuid not null,
  chantier_id             uuid,
  devis_id                uuid,
  facture_origine_id      uuid,              -- avoir : facture corrigée
  -- Nature de l'avoir : « correction » (erreur, annulation : la somme reste
  -- à facturer) ou « reduction » (geste commercial : la somme est abandonnée,
  -- elle diminue définitivement le montant à facturer du devis).
  nature_avoir            text check (nature_avoir in ('correction', 'reduction')),

  -- Cycle de vie (colonnes réservées aux fonctions)
  numero                  text,
  statut                  public.statut_facture not null default 'brouillon',
  date_emission           date,
  date_echeance           date,
  envoyee_le              timestamptz,
  annulee_le              timestamptz,

  -- Contenu
  date_prestation_debut   date,
  date_prestation_fin     date,
  delai_paiement_jours    integer not null check (delai_paiement_jours between 0 and 365),
  regime_tva              public.regime_tva not null,
  autoliquidation         boolean not null default false,
  avancement_bp           integer check (avancement_bp is null or avancement_bp between 0 and 10000),
  acompte_pct_bp          integer check (acompte_pct_bp is null or acompte_pct_bp between 0 and 10000),
  remise_globale_bp       integer not null default 0 check (remise_globale_bp between 0 and 10000),
  notes_client            text,

  total_ht_cents          bigint not null default 0 check (total_ht_cents >= 0),
  total_tva_cents         bigint not null default 0 check (total_tva_cents >= 0),
  total_ttc_cents         bigint not null default 0 check (total_ttc_cents >= 0),
  ventilation_tva         jsonb not null default '[]'::jsonb,
  -- Facture finale / situation : acomptes déduits, ventilés par taux
  deductions              jsonb not null default '[]'::jsonb,  -- [{facture_id, numero, ht, tva, ttc}]
  net_a_payer_cents       bigint not null default 0 check (net_a_payer_cents >= 0),

  copie_emetteur          jsonb,
  copie_client            jsonb,
  copie_chantier          jsonb,
  pdf_chemin              text,
  pdf_sha256              text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  facturx_chemin          text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (organisation_id, id),
  unique (organisation_id, numero),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, facture_origine_id) references public.factures (organisation_id, id) on delete restrict,
  check (total_ttc_cents = total_ht_cents + total_tva_cents),
  check (regime_tva = 'assujetti' or (total_tva_cents = 0 and not autoliquidation)),
  check (not autoliquidation or total_tva_cents = 0),
  check ((type = 'avoir') = (facture_origine_id is not null)),
  check ((type = 'avoir') = (nature_avoir is not null)),
  -- Un avoir n'est rattaché QUE par sa facture d'origine : ni devis ni chantier
  -- propres (sinon il pourrait libérer du « déjà facturé » sur un autre devis).
  check (type <> 'avoir' or (devis_id is null and chantier_id is null)),
  check (public.ventilation_bien_formee(ventilation_tva)),
  check (public.deductions_bien_formees(deductions)),
  check (type not in ('acompte', 'situation', 'finale') or devis_id is not null),
  check (type <> 'situation' or avancement_bp is not null),
  check (statut = 'brouillon' or (numero is not null and date_emission is not null
                                  and date_echeance is not null and pdf_sha256 is not null))
);
create index factures_client_idx on public.factures (organisation_id, client_id);
create index factures_devis_idx on public.factures (organisation_id, devis_id);
create index factures_echeance_idx on public.factures (organisation_id, statut, date_echeance);

create table public.facture_lignes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  facture_id            uuid not null,
  ordre                 integer not null,
  type                  public.type_ligne not null default 'ligne',
  designation           text not null,
  description           text,
  quantite_e4           bigint check (quantite_e4 is null or quantite_e4 >= 0),
  unite                 text check (unite is null or unite in ('m2', 'ml', 'u', 'h', 'forfait', 'L', 'kg')),
  prix_unitaire_ht_cents bigint check (prix_unitaire_ht_cents is null or prix_unitaire_ht_cents >= 0),
  remise_bp             integer not null default 0 check (remise_bp between 0 and 10000),
  taux_tva_bp           integer check (taux_tva_bp is null or taux_tva_bp between 0 and 10000),
  avancement_bp         integer check (avancement_bp is null or avancement_bp between 0 and 10000),
  total_ht_cents        bigint check (total_ht_cents is null or total_ht_cents >= 0),
  devis_ligne_id        uuid,
  unique (organisation_id, id),
  unique (facture_id, ordre),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete cascade,
  foreign key (organisation_id, devis_ligne_id) references public.devis_lignes (organisation_id, id) on delete restrict,
  check (type <> 'ligne' or (quantite_e4 is not null and unite is not null
                             and prix_unitaire_ht_cents is not null and taux_tva_bp is not null
                             and total_ht_cents is not null)),
  -- R4 : arrondi demi-supérieur, en une seule fois, de
  -- quantité x PU x (1 - remise) x avancement (situation ; 100 % sinon).
  check (type <> 'ligne' or total_ht_cents = floor(
    (quantite_e4::numeric * prix_unitaire_ht_cents * (10000 - remise_bp) * coalesce(avancement_bp, 10000)
     + 500000000000) / 1000000000000))
);

select public.appliquer_rls_standard('public.factures');
select public.appliquer_rls_standard('public.facture_lignes');

revoke insert, update on public.factures from authenticated;
grant insert (id, organisation_id, type, client_id, chantier_id, devis_id, facture_origine_id, nature_avoir,
              date_prestation_debut, date_prestation_fin, delai_paiement_jours, regime_tva,
              autoliquidation, avancement_bp, acompte_pct_bp, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
  on public.factures to authenticated;
grant update (client_id, chantier_id, nature_avoir, date_prestation_debut, date_prestation_fin, delai_paiement_jours,
              regime_tva, autoliquidation, avancement_bp, acompte_pct_bp, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
  on public.factures to authenticated;

create trigger factures_updated_at before update on public.factures
  for each row execute function public.maj_updated_at();
create trigger factures_audit after insert or update or delete on public.factures
  for each row execute function public.tracer_audit();
create trigger facture_lignes_audit after insert or update or delete on public.facture_lignes
  for each row execute function public.tracer_audit();

create or replace function public.proteger_facture()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_modifiables constant text[] := array['statut', 'envoyee_le', 'annulee_le', 'facturx_chemin', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    if old.statut <> 'brouillon' then
      raise exception 'Une facture émise ne peut pas être supprimée : établissez un avoir.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  if old.statut = 'brouillon' then
    return new;
  end if;

  if (to_jsonb(new) - v_modifiables) is distinct from (to_jsonb(old) - v_modifiables) then
    raise exception 'Une facture émise ne peut pas être modifiée : établissez un avoir.'
      using errcode = 'P0001';
  end if;
  if new.statut is distinct from old.statut and not (old.statut = 'emise' and new.statut = 'annulee') then
    raise exception 'Changement de statut de facture interdit : % -> %.', old.statut, new.statut
      using errcode = 'P0001';
  end if;
  if old.envoyee_le is not null and new.envoyee_le is distinct from old.envoyee_le then
    raise exception 'La date d''envoi est déjà fixée.' using errcode = 'P0001';
  end if;
  if old.facturx_chemin is not null and new.facturx_chemin is distinct from old.facturx_chemin then
    raise exception 'Le fichier Factur-X est déjà fixé.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger factures_protection before update or delete on public.factures
  for each row execute function public.proteger_facture();

create or replace function public.proteger_facture_lignes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Ancien ET nouveau parent (voir proteger_devis_lignes).
  if exists (
    select 1 from public.factures f
    where f.statut <> 'brouillon'
      and f.id in (case when tg_op <> 'INSERT' then old.facture_id end,
                   case when tg_op <> 'DELETE' then new.facture_id end)
  ) then
    raise exception 'Les lignes d''une facture émise sont figées.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger facture_lignes_protection before insert or update or delete on public.facture_lignes
  for each row execute function public.proteger_facture_lignes();

-- Une ligne reprise d'un devis ne peut venir que du devis de SA facture (donc
-- du même client) : aucune référence croisée qui bloquerait un effacement.
create or replace function public.controler_ligne_reprise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.devis_ligne_id is not null and not exists (
       select 1 from public.devis_lignes dl
       join public.factures f on f.id = new.facture_id
       where dl.id = new.devis_ligne_id and dl.devis_id = f.devis_id) then
    raise exception 'Une ligne reprise doit provenir du devis de la facture.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger facture_lignes_reprise before insert or update on public.facture_lignes
  for each row execute function public.controler_ligne_reprise();

-- -----------------------------------------------------------------------------
-- Émission d'une facture ou d'un avoir.
-- -----------------------------------------------------------------------------

create or replace function public.emettre_facture(
  p_facture_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f        public.factures%rowtype;
  v_numero   text;
  v_date     date := public.aujourd_hui_paris();
  v_somme    bigint;
  v_devis    public.devis%rowtype;
  v_deja     bigint;
  v_origine  public.factures%rowtype;
  v_avoirs   bigint;
  v_deductions_ttc bigint;
begin
  select * into v_f from public.factures where id = p_facture_id for update;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;
  if v_f.statut <> 'brouillon' then
    raise exception 'Cette facture a déjà été émise.' using errcode = 'P0001';
  end if;
  if v_f.delai_paiement_jours > coalesce(
       (select delai_paiement_max_jours from public.parametres_entreprise where organisation_id = v_f.organisation_id), 0) then
    raise exception 'Délai de paiement supérieur au maximum paramétré.' using errcode = 'P0001';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme
  from public.facture_lignes where facture_id = p_facture_id and type = 'ligne';
  if v_somme = 0 then
    raise exception 'Une facture sans ligne chiffrée ne peut pas être émise.' using errcode = 'P0001';
  end if;
  -- Même règle que le devis : totaux recontrôlés contre les lignes et la remise.
  perform public.controler_totaux_lignes(
    (select coalesce(jsonb_agg(jsonb_build_object('taux_bp', t, 'somme_ht_cents', m)), '[]'::jsonb)
     from (select taux_tva_bp as t, sum(total_ht_cents)::bigint as m
           from public.facture_lignes where facture_id = p_facture_id and type = 'ligne'
           group by taux_tva_bp having sum(total_ht_cents) > 0) x),
    v_f.remise_globale_bp,
    -- Autoliquidation : aucune TVA facturée (mention dédiée sur le PDF).
    case when v_f.autoliquidation then 'franchise'::public.regime_tva else v_f.regime_tva end,
    v_f.ventilation_tva, v_f.total_ht_cents, v_f.total_tva_cents);

  -- Verrou du devis AVANT tout contrôle de cumul : deux émissions
  -- simultanées sur le même devis sont sérialisées (pas de sur-facturation,
  -- pas de double déduction).
  if v_f.devis_id is not null then
    select * into v_devis from public.devis where id = v_f.devis_id for update;
  end if;
  -- Verrou des acomptes déduits (ordre stable) : un avoir émis au même
  -- instant sur l'un d'eux (qui, lui, verrouille l'acompte) est sérialisé
  -- avec cette émission, et l'un des deux est refusé.
  perform 1 from public.factures
  where id in (select (d ->> 'facture_id')::uuid from jsonb_array_elements(v_f.deductions) d)
  order by id
  for update;
  perform public.controler_ventilation(v_f.ventilation_tva, v_f.total_ht_cents, v_f.total_tva_cents,
    case when v_f.autoliquidation then 'franchise'::public.regime_tva else v_f.regime_tva end);

  -- Rattachements cohérents (cause racine des refus de passes 3 et 4 : tout
  -- lien qui alimente un cumul doit être contraint) :
  --   * facture liée à un devis : même client, et même chantier que le devis ;
  --   * facture liée à un chantier : chantier du même client ;
  --   * avoir : même client que sa facture d'origine, qui n'est pas un avoir.
  -- FOR SHARE sur le(s) chantier(s) concerné(s) : voir emettre_devis.
  perform 1 from public.chantiers
  where id = v_f.chantier_id or id = (select chantier_id from public.devis where id = v_f.devis_id)
  order by id for share;
  if v_f.devis_id is not null and exists (
       select 1 from public.devis d where d.id = v_f.devis_id
       and (d.client_id <> v_f.client_id
            or (v_f.chantier_id is not null and d.chantier_id is distinct from v_f.chantier_id))) then
    raise exception 'La facture doit avoir le client et le chantier de son devis.' using errcode = 'P0001';
  end if;
  if v_f.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_f.chantier_id and c.client_id <> v_f.client_id) then
    raise exception 'Le chantier de la facture appartient à un autre client.' using errcode = 'P0001';
  end if;
  if v_f.type = 'avoir' and exists (
       select 1 from public.factures o where o.id = v_f.facture_origine_id
       and (o.client_id <> v_f.client_id or o.type = 'avoir')) then
    raise exception 'Un avoir corrige une facture (pas un avoir) du même client.' using errcode = 'P0001';
  end if;

  -- Une ligne reprise d'un devis doit venir du devis ACCEPTÉ de cette facture.
  if exists (
       select 1 from public.facture_lignes fl
       join public.devis_lignes dl on dl.id = fl.devis_ligne_id
       join public.devis d on d.id = dl.devis_id
       where fl.facture_id = p_facture_id
         and (d.statut <> 'accepte' or d.id is distinct from v_f.devis_id)) then
    raise exception 'Une ligne reprise doit provenir du devis accepté de la facture.' using errcode = 'P0001';
  end if;

  -- Situation : chaque ligne porte son avancement (pas de 100 % implicite).
  if v_f.type = 'situation' and exists (
       select 1 from public.facture_lignes where facture_id = p_facture_id and type = 'ligne' and avancement_bp is null) then
    raise exception 'Facture de situation : avancement manquant sur une ligne.' using errcode = 'P0001';
  end if;

  -- Acomptes déduits : chacun doit être une facture d'acompte ou de situation
  -- ÉMISE, du même devis, déduite pour son montant exact, une seule fois.
  -- (Un avoir qui annule une facture reprend ses déductions : contrôlé plus bas.)
  if jsonb_array_length(v_f.deductions) > 0 and v_f.type <> 'avoir' then
    if v_f.type not in ('finale', 'situation') then
      raise exception 'Seules une facture finale ou de situation déduisent des acomptes.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_f.deductions) d
      left join public.factures a on a.id = (d ->> 'facture_id')::uuid
      where a.id is null
         or v_f.devis_id is null
         or a.organisation_id <> v_f.organisation_id
         or a.devis_id is distinct from v_f.devis_id
         or a.type not in ('acompte', 'situation')
         or a.statut <> 'emise'
         or (d ->> 'numero') is distinct from a.numero
         or (d ->> 'ht')::bigint is distinct from a.total_ht_cents
         or (d ->> 'tva')::bigint is distinct from a.total_tva_cents
         or (d ->> 'ttc')::bigint is distinct from a.total_ttc_cents
    ) then
      raise exception 'Acompte déduit introuvable ou montant différent de la facture d''acompte.'
        using errcode = 'P0001';
    end if;
    if (select count(*) from jsonb_array_elements(v_f.deductions))
       <> (select count(distinct (d ->> 'facture_id')::uuid) from jsonb_array_elements(v_f.deductions) d) then
      raise exception 'Un acompte ne peut être déduit qu''une fois.' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.factures autre, jsonb_array_elements(autre.deductions) d
      where autre.organisation_id = v_f.organisation_id and autre.statut = 'emise'   -- une facture annulée libère ses acomptes
        and autre.type <> 'avoir'                                                    -- l'avoir d'annulation les reprend sans les déduire
        and autre.id <> v_f.id
        and (d ->> 'facture_id')::uuid in (select (e ->> 'facture_id')::uuid from jsonb_array_elements(v_f.deductions) e)
    ) then
      raise exception 'Cet acompte a déjà été déduit sur une autre facture.' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(sum((d ->> 'ttc')::bigint), 0) into v_deductions_ttc
  from jsonb_array_elements(v_f.deductions) d;
  if v_f.net_a_payer_cents <> v_f.total_ttc_cents - v_deductions_ttc then
    raise exception 'Net à payer incohérent avec les acomptes déduits.' using errcode = 'P0001';
  end if;

  -- Factures liées à un devis : uniquement un devis accepté, et jamais plus
  -- que son total accepté (somme des factures émises, avoirs déduits).
  if v_f.devis_id is not null then
    if v_devis.statut <> 'accepte' then
      raise exception 'Le devis lié n''est pas accepté.' using errcode = 'P0001';
    end if;
    -- Cumul calculé par la SOURCE UNIQUE solde_devis() (voir plus bas).
    select engage_cents into v_deja from public.solde_devis(v_f.devis_id);
    if v_deja + v_f.net_a_payer_cents > v_devis.total_accepte_ttc_cents then
      raise exception 'Le total facturé dépasserait le devis accepté.' using errcode = 'P0001';
    end if;
  end if;

  if v_f.type = 'avoir' then
    select * into v_origine from public.factures where id = v_f.facture_origine_id for update;
    if v_origine.statut <> 'emise' then
      raise exception 'Un avoir ne peut corriger qu''une facture émise et non annulée.' using errcode = 'P0001';
    end if;
    -- Un avoir porte sur ce qui est DÛ : le net à payer de la facture
    -- d'origine (acomptes déjà déduits), moins les avoirs déjà émis. Le
    -- montant d'un avoir est son NET (égal à son TTC, sauf avoir d'annulation
    -- qui reprend les lignes ET les déductions de l'origine : TVA nette exacte par taux).
    select avoirs_cents into v_avoirs from public.solde_facture(v_origine.id);
    if v_avoirs + v_f.net_a_payer_cents > v_origine.net_a_payer_cents then
      raise exception 'Le total des avoirs dépasserait le net à payer de la facture d''origine.' using errcode = 'P0001';
    end if;
    if jsonb_array_length(v_f.deductions) > 0 and (
         v_avoirs <> 0 or v_f.net_a_payer_cents <> v_origine.net_a_payer_cents
         or v_f.deductions <> v_origine.deductions
         or v_f.total_ttc_cents <> v_origine.total_ttc_cents
         or v_f.ventilation_tva <> v_origine.ventilation_tva) then
      raise exception 'Un avoir qui reprend les acomptes déduits annule toute la facture d''origine.' using errcode = 'P0001';
    end if;
    -- Acompte ou situation : un avoir de CORRECTION l'annule en totalité (une
    -- correction partielle ne pourrait plus être déduite exactement ensuite).
    if v_origine.type in ('acompte', 'situation') and v_f.nature_avoir = 'correction'
       and v_avoirs + v_f.net_a_payer_cents <> v_origine.net_a_payer_cents then
      raise exception 'Une facture d''acompte ou de situation se corrige par un avoir total (puis une nouvelle facture).' using errcode = 'P0001';
    end if;
    -- Un acompte déduit par une facture encore valable ne se corrige pas
    -- directement : il faut d'abord annuler la facture qui le déduit.
    if exists (
      select 1 from public.factures autre, jsonb_array_elements(autre.deductions) d
      where autre.organisation_id = v_f.organisation_id and autre.statut = 'emise' and autre.type <> 'avoir'
        and (d ->> 'facture_id')::uuid = v_origine.id) then
      raise exception 'Cet acompte est déduit sur une facture en cours : annulez d''abord cette facture.'
        using errcode = 'P0001';
    end if;
    v_numero := public.prochain_numero(v_f.organisation_id, 'AVO', extract(year from v_date)::integer);
  else
    v_numero := public.prochain_numero(v_f.organisation_id, 'FAC', extract(year from v_date)::integer);
  end if;

  update public.factures set
    numero = v_numero,
    statut = 'emise',
    date_emission = v_date,
    date_echeance = v_date + v_f.delai_paiement_jours,
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_facture_id;

  -- Avoirs = net à payer : la facture d'origine est annulée (ses acomptes
  -- déduits sont alors libérés pour la facture qui la remplacera).
  if v_f.type = 'avoir' and v_avoirs + v_f.net_a_payer_cents = v_origine.net_a_payer_cents then
    update public.factures set statut = 'annulee', annulee_le = now() where id = v_origine.id;
  end if;

  return v_numero;
end;
$$;

create or replace function public.marquer_facture_envoyee(p_facture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.factures where id = p_facture_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;
  update public.factures set envoyee_le = coalesce(envoyee_le, now())
  where id = p_facture_id and statut <> 'brouillon';
end;
$$;

-- -----------------------------------------------------------------------------
-- Paiements : registre en ajout seul. Une erreur se corrige par une écriture
-- d'annulation (montant opposé) qui référence le paiement annulé.
-- Un paiement rattaché à un AVOIR est un remboursement versé au client : il
-- apparaît en négatif dans le livre des recettes.
-- -----------------------------------------------------------------------------

create type public.mode_paiement as enum ('virement', 'cheque', 'especes', 'carte', 'stripe');

create table public.paiements (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  facture_id            uuid not null,
  date_paiement         date not null,
  montant_cents         bigint not null check (montant_cents <> 0),
  mode                  public.mode_paiement not null,
  reference             text,
  notes                 text,
  annule_paiement_id    uuid unique,
  stripe_evenement_id   text unique,                 -- idempotence des webhooks
  cree_par              uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict,
  foreign key (organisation_id, annule_paiement_id) references public.paiements (organisation_id, id) on delete restrict,
  check ((montant_cents < 0) = (annule_paiement_id is not null))
);
create index paiements_facture_idx on public.paiements (organisation_id, facture_id);
create index paiements_date_idx on public.paiements (organisation_id, date_paiement);

alter table public.paiements enable row level security;
create policy paiements_lecture on public.paiements
  for select to authenticated using (public.est_membre(organisation_id));
create policy paiements_ajout on public.paiements
  for insert to authenticated with check (public.est_membre(organisation_id));
-- Ni UPDATE ni DELETE : aucune politique, et trigger en défense.
create trigger paiements_audit after insert on public.paiements
  for each row execute function public.tracer_audit();

-- =============================================================================
-- SOURCE UNIQUE DES CUMULS (refonte phase 0, cause racine des refus 3 à 5).
-- Tous les montants cumulés (dû, payé, remboursé, reste, trop-perçu, déjà
-- facturé, reste à facturer) sont calculés ICI et nulle part ailleurs :
-- emettre_facture, controler_paiement, v_factures et v_chantiers les lisent.
-- Base commune : le NET À PAYER (une finale ne recompte jamais les acomptes
-- qu'elle déduit), les avoirs étant plafonnés à ce net.
-- =============================================================================

-- Solde d'une facture (hors avoir).
--   dû          = net à payer - avoirs émis
--   reste       = dû - payé                       (jamais négatif)
--   trop-perçu  = payé - dû                       (jamais négatif)
--   à rembourser = trop-perçu - déjà remboursé sur ses avoirs
create or replace function public.solde_facture(p_facture_id uuid)
returns table (du_cents bigint, avoirs_cents bigint, paye_cents bigint, rembourse_cents bigint,
               reste_a_payer_cents bigint, trop_percu_cents bigint, reste_a_rembourser_cents bigint)
language sql
stable
set search_path = ''
as $$
  with f as (select net_a_payer_cents as net from public.factures where id = p_facture_id and type <> 'avoir'),
  a as (select coalesce(sum(net_a_payer_cents), 0)::bigint as s from public.factures
        where facture_origine_id = p_facture_id and statut <> 'brouillon'),
  p as (select coalesce(sum(montant_cents), 0)::bigint as s from public.paiements where facture_id = p_facture_id),
  r as (select coalesce(sum(pp.montant_cents), 0)::bigint as s
        from public.paiements pp join public.factures av on av.id = pp.facture_id
        where av.facture_origine_id = p_facture_id)
  select greatest(0, f.net - a.s)::bigint, a.s, p.s, r.s,
         greatest(0, f.net - a.s - p.s)::bigint,
         greatest(0, p.s - (f.net - a.s))::bigint,
         greatest(0, greatest(0, p.s - (f.net - a.s)) - r.s)::bigint
  from f, a, p, r;
$$;

-- Solde d'un devis.
--   engagé = somme des nets des factures émises du devis (annulées comprises)
--            - avoirs de CORRECTION sur ces factures.
--   Un avoir de RÉDUCTION (geste commercial) ne libère rien : la somme
--   abandonnée ne se refacture pas.
--   reste à facturer = total accepté - engagé (jamais négatif).
create or replace function public.solde_devis(p_devis_id uuid)
returns table (accepte_ttc_cents bigint, engage_cents bigint, reste_a_facturer_cents bigint)
language sql
stable
set search_path = ''
as $$
  with d as (select coalesce(total_accepte_ttc_cents, 0)::bigint as accepte from public.devis where id = p_devis_id),
  fac as (select id, net_a_payer_cents from public.factures
          where devis_id = p_devis_id and statut <> 'brouillon' and type <> 'avoir'),
  e as (select coalesce((select sum(net_a_payer_cents) from fac), 0)
             - coalesce((select sum(av.net_a_payer_cents) from public.factures av
                         where av.facture_origine_id in (select id from fac)
                           and av.statut <> 'brouillon' and av.nature_avoir = 'correction'), 0) as engage)
  select d.accepte, e.engage::bigint, greatest(0, d.accepte - e.engage)::bigint
  from d, e;
$$;

-- Solde d'un avoir : remboursé sur CET avoir, et reste à rembourser
-- (plafonné à l'avoir et au trop-perçu réel de la facture d'origine).
create or replace function public.solde_avoir(p_avoir_id uuid)
returns table (rembourse_cents bigint, reste_a_rembourser_cents bigint)
language sql
stable
set search_path = ''
as $$
  with a as (select net_a_payer_cents, facture_origine_id from public.factures where id = p_avoir_id and type = 'avoir'),
  p as (select coalesce(sum(montant_cents), 0)::bigint as s from public.paiements where facture_id = p_avoir_id)
  select p.s,
         greatest(0, least(a.net_a_payer_cents - p.s, so.reste_a_rembourser_cents))::bigint
  from a, p, lateral public.solde_facture(a.facture_origine_id) so;
$$;

create or replace function public.controler_paiement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_f       public.factures%rowtype;
  v_s       record;
  v_annule  public.paiements%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Un paiement enregistré ne se modifie pas : saisissez une annulation.'
      using errcode = 'P0001';
  end if;

  select * into v_f from public.factures where id = new.facture_id for update;
  if v_f.statut = 'brouillon' then
    raise exception 'Un paiement ne peut être rattaché qu''à une facture émise.' using errcode = 'P0001';
  end if;

  -- Annulation d'une écriture erronée : possible même sur une facture annulée,
  -- sauf si elle rendait « trop remboursé » ce qui a déjà été remboursé.
  if new.annule_paiement_id is not null then
    select * into v_annule from public.paiements where id = new.annule_paiement_id;
    if v_annule.facture_id <> new.facture_id or v_annule.montant_cents <> -new.montant_cents
       or v_annule.montant_cents <= 0 then
      raise exception 'L''annulation doit reprendre exactement le paiement annulé.' using errcode = 'P0001';
    end if;
    if v_f.type <> 'avoir' then
      select * into v_s from public.solde_facture(v_f.id);
      if v_s.rembourse_cents > greatest(0, v_s.paye_cents + new.montant_cents - v_s.du_cents) then
        raise exception 'Annulation impossible : le client a déjà été remboursé de ce montant. Annulez d''abord le remboursement.'
          using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  if v_f.statut <> 'emise' then
    raise exception 'Un paiement ne peut être rattaché qu''à une facture émise.' using errcode = 'P0001';
  end if;

  if v_f.type = 'avoir' then
    -- Remboursement : plafonné à l'avoir ET au trop-perçu réel de l'origine.
    perform 1 from public.factures where id = v_f.facture_origine_id for update;
    select * into v_s from public.solde_avoir(v_f.id);
    if new.montant_cents > v_s.reste_a_rembourser_cents then
      raise exception 'Ce remboursement dépasse ce que le client a payé en trop (ou le montant de l''avoir).'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  select * into v_s from public.solde_facture(v_f.id);
  if new.montant_cents > v_s.reste_a_payer_cents then
    raise exception 'Ce paiement dépasse le reste à payer.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger paiements_controle before insert or update or delete on public.paiements
  for each row execute function public.controler_paiement();

-- Vue avec les états dérivés, lus dans la source unique.
create view public.v_factures with (security_invoker = true) as
select f.*,
  case when f.type = 'avoir' then sa.rembourse_cents else s.paye_cents end as paye_cents,
  coalesce(s.avoirs_cents, 0) as avoirs_cents,
  coalesce(s.reste_a_payer_cents, 0) as reste_a_payer_cents,
  case when f.type = 'avoir' then sa.reste_a_rembourser_cents else 0::bigint end as reste_a_rembourser_cents,
  case
    when f.statut <> 'emise' then f.statut::text
    when f.type = 'avoir' then 'emise'
    when s.reste_a_payer_cents = 0 then 'payee'
    when f.date_echeance < public.aujourd_hui_paris() then 'en_retard'
    when s.paye_cents > 0 then 'partiellement_payee'
    when f.envoyee_le is not null then 'envoyee'
    else 'emise'
  end as statut_affiche
from public.factures f
left join lateral public.solde_facture(f.id) s on f.type <> 'avoir'
left join lateral public.solde_avoir(f.id) sa on f.type = 'avoir';


-- =============================================================================
-- Migration 20261008000650_liens_publics.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : liens publics (consultation / signature à distance du devis,
-- consultation de facture).
--
-- * Seule l'empreinte SHA-256 du jeton est stockée : une fuite de la base ne
--   donne aucun lien utilisable. Jeton : 32 octets aléatoires (256 bits).
-- * Le document est référencé par devis_id OU facture_id, avec clé étrangère
--   COMPOSITE (organisation_id, …) : un lien ne peut viser qu'un document de
--   sa propre organisation (correctif audit sécurité phase 0, critique 1).
-- * Les fonctions par jeton ne sont exécutables que par le rôle service : le
--   serveur Next les appelle après avoir relevé l'IP réelle de la requête.
-- * Durée maximale d'un lien : 90 jours (limite de sécurité, pas une règle
--   métier ; la durée choisie dans l'interface est plus courte).
-- =============================================================================

create table public.liens_publics (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  devis_id          uuid,
  facture_id        uuid,
  finalite          text not null check (finalite in ('consultation', 'signature')),
  jeton_sha256      text not null unique check (jeton_sha256 ~ '^[0-9a-f]{64}$'),
  expire_le         timestamptz not null,
  utilise_le        timestamptz,
  revoque_le        timestamptz,
  cree_le           timestamptz not null default now(),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict,
  check ((devis_id is null) <> (facture_id is null)),
  check (finalite = 'consultation' or devis_id is not null),
  check (expire_le > cree_le and expire_le <= cree_le + interval '90 days')
);
create index liens_publics_devis_idx on public.liens_publics (devis_id);
create index liens_publics_facture_idx on public.liens_publics (facture_id);

alter table public.liens_publics enable row level security;
create policy liens_lecture on public.liens_publics
  for select to authenticated using (public.est_membre(organisation_id));
create policy liens_ajout on public.liens_publics
  for insert to authenticated with check (public.est_membre(organisation_id));
create policy liens_revocation on public.liens_publics
  for update to authenticated using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id));

-- L'API ne choisit ni cree_le, ni utilise_le, ni revoque_le à la création, et
-- ne peut modifier que revoque_le.
revoke insert, update, delete, truncate on public.liens_publics from authenticated;
grant insert (organisation_id, devis_id, facture_id, finalite, jeton_sha256, expire_le)
  on public.liens_publics to authenticated;
grant update (revoque_le) on public.liens_publics to authenticated;

create or replace function public.proteger_lien_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Un brouillon n'a pas de lien public.
    if exists (select 1 from public.devis where id = new.devis_id and statut = 'brouillon')
       or exists (select 1 from public.factures where id = new.facture_id and statut = 'brouillon') then
      raise exception 'Un brouillon ne peut pas être partagé.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.revoque_le is not null and new.revoque_le is distinct from old.revoque_le then
    raise exception 'Une révocation est définitive.' using errcode = 'P0001';
  end if;
  if old.utilise_le is not null and new.utilise_le is distinct from old.utilise_le then
    raise exception 'Un lien utilisé le reste.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['revoque_le', 'utilise_le']) is distinct from (to_jsonb(old) - array['revoque_le', 'utilise_le']) then
    raise exception 'Un lien public ne se modifie pas.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger liens_publics_protection before insert or update on public.liens_publics
  for each row execute function public.proteger_lien_public();

create or replace function public.lien_valide(p_jeton text, p_finalite text)
returns public.liens_publics
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
begin
  if p_jeton is null or length(p_jeton) < 43 then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  select * into v_lien from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
    and finalite = p_finalite;
  if not found or v_lien.revoque_le is not null or v_lien.expire_le < now()
     or (v_lien.finalite = 'signature' and v_lien.utilise_le is not null) then
    -- Même message dans tous les cas : aucune information sur la cause.
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  return v_lien;
end;
$$;

create or replace function public.devis_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien  public.liens_publics%rowtype;
  v_devis public.devis%rowtype;
begin
  begin
    v_lien := public.lien_valide(p_jeton, 'signature');
  exception when sqlstate 'P0002' then
    v_lien := public.lien_valide(p_jeton, 'consultation');
  end;
  -- Défense en profondeur : même organisation que le lien (déjà garanti par la FK).
  select * into v_devis from public.devis
  where id = v_lien.devis_id and organisation_id = v_lien.organisation_id;
  if not found or v_devis.statut = 'brouillon' then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  if v_devis.consulte_le is null then
    update public.devis set consulte_le = now() where id = v_devis.id;
  end if;
  return jsonb_build_object(
    'devis_id', v_devis.id, 'numero', v_devis.numero, 'version', v_devis.version,
    'statut', v_devis.statut, 'pdf_chemin', v_devis.pdf_chemin, 'pdf_sha256', v_devis.pdf_sha256,
    'peut_signer', v_lien.finalite = 'signature' and v_devis.statut = 'envoye',
    'organisation_id', v_devis.organisation_id);
end;
$$;

create or replace function public.signer_devis_par_jeton(
  p_jeton text, p_nom text, p_mention text, p_image_chemin text, p_document_sha256 text,
  p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_sig  uuid;
begin
  perform 1 from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
  for update;                                   -- usage unique, même en double clic
  v_lien := public.lien_valide(p_jeton, 'signature');
  if not exists (select 1 from public.devis
                 where id = v_lien.devis_id and organisation_id = v_lien.organisation_id) then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  v_sig := public.signer_devis_interne(v_lien.devis_id, 'lien', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_options, p_ip, p_user_agent);
  update public.liens_publics set utilise_le = now() where id = v_lien.id;
  return v_sig;
end;
$$;

create or replace function public.facture_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_f    public.v_factures%rowtype;
begin
  v_lien := public.lien_valide(p_jeton, 'consultation');
  select * into v_f from public.v_factures
  where id = v_lien.facture_id and organisation_id = v_lien.organisation_id;
  if not found or v_f.statut = 'brouillon' then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'facture_id', v_f.id, 'numero', v_f.numero, 'type', v_f.type,
    'pdf_chemin', v_f.pdf_chemin, 'pdf_sha256', v_f.pdf_sha256,
    'date_echeance', v_f.date_echeance, 'reste_a_payer_cents', v_f.reste_a_payer_cents,
    'organisation_id', v_f.organisation_id);
end;
$$;

revoke execute on function public.lien_valide(text, text) from public, anon, authenticated;
revoke execute on function public.devis_par_jeton(text) from public, anon, authenticated;
revoke execute on function public.facture_par_jeton(text) from public, anon, authenticated;
revoke execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  from public, anon, authenticated;
grant execute on function public.devis_par_jeton(text) to service_role;
grant execute on function public.facture_par_jeton(text) to service_role;
grant execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  to service_role;


-- =============================================================================
-- Migration 20261008000700_pilotage_documents.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : relances, comptabilité simplifiée, planning, documents de chantier,
-- PV de réception, photos.
-- =============================================================================

-- Modèles de messages (relances devis, impayés niveaux 1 à 3, avis client)
create table public.modeles_messages (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null check (code in ('relance_devis', 'impaye_1', 'impaye_2', 'impaye_3',
                                                  'envoi_devis', 'envoi_facture', 'demande_avis')),
  sujet             text not null,
  corps             text not null,
  delai_jours       integer check (delai_jours is null or delai_jours between 0 and 365),
  actif             boolean not null default true,
  unique (organisation_id, code)
);
select public.appliquer_rls_standard('public.modeles_messages');

-- Historique des envois (email ou message), y compris relances.
create table public.envois (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  document_type     text not null check (document_type in ('devis', 'facture', 'pv_reception', 'liste_achat')),
  document_id       uuid not null,
  nature            text not null check (nature in ('envoi', 'relance_devis', 'impaye_1', 'impaye_2', 'impaye_3', 'demande_avis')),
  canal             text not null check (canal in ('email', 'manuel')),
  destinataire      text,
  fournisseur_id    text,              -- identifiant Resend
  statut            text not null default 'envoye' check (statut in ('envoye', 'echec')),
  erreur            text,
  envoye_le         timestamptz not null default now()
);
create index envois_doc_idx on public.envois (document_type, document_id, envoye_le desc);
alter table public.envois enable row level security;
create policy envois_lecture on public.envois
  for select to authenticated using (public.est_membre(organisation_id));
create policy envois_ajout on public.envois
  for insert to authenticated with check (public.est_membre(organisation_id));

-- Registre des achats
create table public.categories_depenses (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  libelle           text not null,
  unique (organisation_id, id),
  unique (organisation_id, libelle)
);
select public.appliquer_rls_standard('public.categories_depenses');

create table public.depenses (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  date_depense        date not null,
  fournisseur         text not null,
  libelle             text,
  categorie_id        uuid,
  chantier_id         uuid,
  montant_ht_cents    bigint not null check (montant_ht_cents >= 0),
  tva_cents           bigint not null default 0 check (tva_cents >= 0),
  montant_ttc_cents   bigint not null check (montant_ttc_cents >= 0),
  mode_paiement       public.mode_paiement,
  justificatif_chemin text,
  created_at          timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, categorie_id) references public.categories_depenses (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  check (montant_ttc_cents = montant_ht_cents + tva_cents)
);
create index depenses_date_idx on public.depenses (organisation_id, date_depense);
select public.appliquer_rls_standard('public.depenses');
create trigger depenses_audit after insert or update or delete on public.depenses
  for each row execute function public.tracer_audit();

create table public.materiel (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  libelle           text not null,
  date_achat        date,
  valeur_cents      bigint check (valeur_cents is null or valeur_cents >= 0),
  depense_id        uuid,
  notes             text,
  foreign key (organisation_id, depense_id) references public.depenses (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.materiel');

-- Planning et rappels
create table public.evenements (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid,
  type              text not null check (type in ('chantier', 'sechage', 'rappel', 'rendez_vous')),
  titre             text not null,
  debut             timestamptz not null,
  fin               timestamptz not null,
  journee_entiere   boolean not null default false,
  notes             text,
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  check (fin >= debut)
);
create index evenements_periode_idx on public.evenements (organisation_id, debut);
select public.appliquer_rls_standard('public.evenements');

-- Rappels et notifications (§5.9) : début de chantier, séchage entre couches,
-- relance devis, échéance facture. Envoyés par le cron ; le canal est une
-- décision humaine en attente (application seule par défaut).
create table public.rappels (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in ('debut_chantier', 'sechage', 'relance_devis', 'echeance_facture', 'libre')),
  echeance          timestamptz not null,
  titre             text not null,
  canal             text not null default 'application' check (canal in ('application', 'email', 'push')),
  chantier_id       uuid,
  evenement_id      uuid,
  document_type     text check (document_type is null or document_type in ('devis', 'facture')),
  document_id       uuid,
  envoye_le         timestamptz,
  lu_le             timestamptz,
  statut            text not null default 'a_envoyer' check (statut in ('a_envoyer', 'envoye', 'echec', 'annule')),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, evenement_id) references public.evenements (organisation_id, id) on delete cascade,
  check ((document_type is null) = (document_id is null))
);
create index rappels_echeance_idx on public.rappels (statut, echeance);
select public.appliquer_rls_standard('public.rappels');

-- Photos et documents de chantier
create table public.photos (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  piece_id          uuid,
  moment            text not null default 'autre' check (moment in ('avant', 'pendant', 'apres', 'autre')),
  chemin            text not null,
  annotations       jsonb,
  legende           text,
  prise_le          timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete set null (piece_id)
);
select public.appliquer_rls_standard('public.photos');

create table public.documents_chantier (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  type              text not null check (type in ('fiche_technique', 'attestation', 'assurance', 'plan', 'autre')),
  nom               text not null,
  chemin            text not null,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
);
select public.appliquer_rls_standard('public.documents_chantier');

create table public.checklists_fin_chantier (
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  items             jsonb not null default '[]'::jsonb,   -- [{libelle, fait, fait_le}]
  primary key (organisation_id, chantier_id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
);
select public.appliquer_rls_standard('public.checklists_fin_chantier');

-- PV de réception
create table public.pv_reception (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  date_reception    date not null,
  avec_reserves     boolean not null default false,
  reserves          jsonb not null default '[]'::jsonb,   -- [{description, photo_id, levee_le}]
  signature_id      uuid,
  pdf_chemin        text,
  pdf_sha256        text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, signature_id) references public.signatures (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.pv_reception');
create trigger pv_reception_audit after insert or update or delete on public.pv_reception
  for each row execute function public.tracer_audit();

-- Attestations simplifiées de TVA à taux réduit (assujetti uniquement).
create table public.attestations_tva (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  devis_id          uuid not null,
  -- Le taux doit exister dans taux_tva avec attestation_requise (contrôlé par
  -- le serveur) ; aucun taux légal codé en dur.
  taux_bp           integer not null,
  signature_id      uuid,
  pdf_chemin        text,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, taux_bp) references public.taux_tva (organisation_id, taux_bp) on delete restrict,
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, signature_id) references public.signatures (organisation_id, id) on delete restrict
);
select public.appliquer_rls_standard('public.attestations_tva');

-- -----------------------------------------------------------------------------
-- PV de réception et attestations de TVA : documents SIGNÉS figés.
-- * l'API ne pose ni signature_id, ni pdf_chemin, ni pdf_sha256 (privilèges
--   de colonne) : seules les fonctions de signature (Phase 7) le feront ;
-- * la signature rattachée doit être celle de CE document (type et id) ;
-- * dès qu'une signature est posée : ni modification, ni suppression.
-- -----------------------------------------------------------------------------
revoke insert, update on public.pv_reception from authenticated;
grant insert (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves)
  on public.pv_reception to authenticated;
grant update (date_reception, avec_reserves, reserves) on public.pv_reception to authenticated;
revoke insert, update on public.attestations_tva from authenticated;
grant insert (id, organisation_id, devis_id, taux_bp) on public.attestations_tva to authenticated;
grant update (taux_bp) on public.attestations_tva to authenticated;

create or replace function public.proteger_document_signe()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text := case tg_table_name when 'pv_reception' then 'pv_reception' else 'attestation_tva' end;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.signature_id is not null then
    raise exception 'Un document signé ne se modifie ni ne se supprime.' using errcode = 'P0001';
  end if;
  -- Une attestation ne se signe que pour un devis émis (envoyé ou accepté) :
  -- jamais sur un brouillon, qui doit rester supprimable (effacement RGPD).
  if tg_table_name = 'attestations_tva' and tg_op in ('INSERT', 'UPDATE') and new.signature_id is not null
     and not exists (select 1 from public.devis d where d.id = (to_jsonb(new) ->> 'devis_id')::uuid
                     and d.statut in ('envoye', 'accepte')) then
    raise exception 'Une attestation ne se signe que pour un devis envoyé ou accepté.' using errcode = 'P0001';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.signature_id is not null and not exists (
       select 1 from public.signatures s
       where s.id = new.signature_id and s.organisation_id = new.organisation_id
         and s.document_type = v_type and s.document_id = new.id) then
    raise exception 'Cette signature ne correspond pas à ce document.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger pv_reception_signe before insert or update or delete on public.pv_reception
  for each row execute function public.proteger_document_signe();
create trigger attestations_tva_signee before insert or update or delete on public.attestations_tva
  for each row execute function public.proteger_document_signe();

-- -----------------------------------------------------------------------------
-- Livre des recettes : généré depuis les encaissements (vue, jamais saisi).
-- -----------------------------------------------------------------------------
create view public.v_livre_recettes with (security_invoker = true) as
select p.organisation_id, p.date_paiement,
       case when f.type = 'avoir' then -p.montant_cents else p.montant_cents end as montant_cents,
       case when f.type = 'avoir' then 'remboursement' else 'encaissement' end as nature,
       p.mode, p.reference,
       f.numero as facture_numero, f.id as facture_id,
       coalesce(f.copie_client ->> 'nom_affiche', '') as client
from public.paiements p
join public.factures f on f.id = p.facture_id;

-- Références polymorphes (envois, rappels) : le document visé doit exister
-- dans la MÊME organisation (pas de FK possible sur une colonne polymorphe).
create or replace function public.verifier_document_meme_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if new.document_id is null then
    return new;
  end if;
  v_ok := case new.document_type
    when 'devis' then exists (select 1 from public.devis where id = new.document_id and organisation_id = new.organisation_id)
    when 'facture' then exists (select 1 from public.factures where id = new.document_id and organisation_id = new.organisation_id)
    when 'pv_reception' then exists (select 1 from public.pv_reception where id = new.document_id and organisation_id = new.organisation_id)
    when 'liste_achat' then exists (select 1 from public.chantiers where id = new.document_id and organisation_id = new.organisation_id)
    else false end;
  if not v_ok then
    raise exception 'Document introuvable.' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
create trigger envois_document before insert or update on public.envois
  for each row execute function public.verifier_document_meme_org();
create trigger rappels_document before insert or update on public.rappels
  for each row execute function public.verifier_document_meme_org();

-- Statut de chantier, lu dans la SOURCE UNIQUE (solde_devis, solde_facture) :
--   * reste à facturer = somme des restes à facturer des devis ACCEPTÉS du
--     chantier. Une facture « libre » (travaux supplémentaires) ne solde pas
--     un devis (décision P23) ;
--   * reste à payer = somme des restes des factures émises du chantier
--     (liées au devis ou au chantier).
--   « terminé » (à facturer) tant qu'un devis n'est pas entièrement facturé
--   ou que rien n'est facturé ; « facturé » tant qu'il reste à payer ;
--   « payé » sinon.
create view public.v_chantiers with (security_invoker = true) as
with dv as (
  select d.chantier_id, sd.accepte_ttc_cents, sd.engage_cents, sd.reste_a_facturer_cents
  from public.devis d, lateral public.solde_devis(d.id) sd
  where d.statut = 'accepte' and d.chantier_id is not null
),
fa as (
  select c.id as ch_id, f.id, sf.reste_a_payer_cents
  from public.chantiers c
  join public.factures f
    on f.statut = 'emise' and f.type <> 'avoir'
   and (f.chantier_id = c.id or f.devis_id in (select d.id from public.devis d where d.chantier_id = c.id))
  cross join lateral public.solde_facture(f.id) sf
)
select c.*,
  coalesce((select sum(accepte_ttc_cents) from dv where dv.chantier_id = c.id), 0)::bigint as accepte_ttc_cents,
  coalesce((select sum(engage_cents) from dv where dv.chantier_id = c.id), 0)::bigint as engage_cents,
  coalesce((select sum(reste_a_facturer_cents) from dv where dv.chantier_id = c.id), 0)::bigint as reste_a_facturer_cents,
  coalesce((select sum(reste_a_payer_cents) from fa where fa.ch_id = c.id), 0)::bigint as reste_a_payer_cents,
  case
    when c.statut <> 'termine' then c.statut::text
    when coalesce((select sum(reste_a_facturer_cents) from dv where dv.chantier_id = c.id), 0) > 0 then 'termine'
    when not exists (select 1 from public.factures f
                     where f.statut <> 'brouillon' and f.type <> 'avoir'
                       and (f.chantier_id = c.id or f.devis_id in (select d.id from public.devis d where d.chantier_id = c.id)))
      then 'termine'
    when coalesce((select sum(reste_a_payer_cents) from fa where fa.ch_id = c.id), 0) > 0 then 'facture'
    else 'paye'
  end as statut_affiche
from public.chantiers c;


-- -----------------------------------------------------------------------------
-- Client d'un chantier FIGÉ dès qu'un document non brouillon y est rattaché
-- (devis émis ou facture émise, directement ou via un devis du chantier) :
-- les cumuls par chantier et l'anonymisation reposent sur ce lien.
-- -----------------------------------------------------------------------------
create or replace function public.proteger_client_chantier()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is distinct from old.client_id and (
       exists (select 1 from public.devis d where d.chantier_id = old.id and d.statut <> 'brouillon')
       or exists (select 1 from public.factures f where f.chantier_id = old.id and f.statut <> 'brouillon')) then
    raise exception 'Ce chantier porte des documents émis : son client ne peut plus changer.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger chantiers_client_fige before update on public.chantiers
  for each row execute function public.proteger_client_chantier();


-- =============================================================================
-- Migration 20261008000800_stockage_droits.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR : stockage des fichiers et droits finaux.
--
-- Tous les buckets sont PRIVÉS. Convention de chemin :
--   <organisation_id>/<...>/<uuid aléatoire>.<ext>
-- Le premier segment détermine l'accès. Les PDF émis et les signatures ne
-- sont jamais ni remplacés ni supprimés (aucune politique UPDATE / DELETE).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('documents',     'documents',     false, 10485760, array['application/pdf', 'application/xml']),
  ('signatures',    'signatures',    false,   524288, array['image/png']),
  ('photos',        'photos',        false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('justificatifs', 'justificatifs', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  -- Pas de SVG (contenu actif) : PNG / JPEG seulement, signature binaire
  -- vérifiée par le serveur avant dépôt.
  ('marque',        'marque',        false,  2097152, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create or replace function public.organisation_du_chemin(p_nom text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(p_nom, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Lecture : tous les buckets de l'organisation.
create policy hdecor_lecture on storage.objects for select to authenticated
  using (bucket_id in ('documents', 'signatures', 'photos', 'justificatifs', 'marque')
         and public.est_membre(public.organisation_du_chemin(name)));

-- Ajout : tous les buckets de l'organisation.
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in ('documents', 'signatures', 'photos', 'justificatifs', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));

-- Remplacement / suppression : uniquement photos, justificatifs, logo.
-- Jamais les documents émis ni les signatures.
create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id in ('photos', 'justificatifs', 'marque')
         and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id in ('photos', 'justificatifs', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));
create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id in ('photos', 'justificatifs', 'marque')
         and public.est_membre(public.organisation_du_chemin(name)));

-- -----------------------------------------------------------------------------
-- Chemins de fichiers : toujours sous le dossier de l'organisation de la
-- ligne. Empêche de faire servir le fichier d'une autre organisation par une
-- page publique (URL signée avec la clé de service).
-- -----------------------------------------------------------------------------
create or replace function public.chemin_de_l_organisation(p_chemin text, p_organisation_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_chemin is null
      or (p_chemin like p_organisation_id::text || '/%' and position('..' in p_chemin) = 0);
$$;

alter table public.parametres_entreprise add constraint logo_chemin_org check (public.chemin_de_l_organisation(logo_chemin, organisation_id));
alter table public.assurances add constraint attestation_chemin_org check (public.chemin_de_l_organisation(attestation_chemin, organisation_id));
alter table public.devis add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id));
alter table public.factures add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id));
alter table public.factures add constraint facturx_chemin_org check (public.chemin_de_l_organisation(facturx_chemin, organisation_id));
alter table public.signatures add constraint image_chemin_org check (public.chemin_de_l_organisation(image_chemin, organisation_id));
alter table public.signatures add constraint pdf_signe_chemin_org check (public.chemin_de_l_organisation(pdf_signe_chemin, organisation_id));
alter table public.pv_reception add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id));
alter table public.attestations_tva add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id));
alter table public.photos add constraint chemin_org check (public.chemin_de_l_organisation(chemin, organisation_id));
alter table public.documents_chantier add constraint chemin_org check (public.chemin_de_l_organisation(chemin, organisation_id));
alter table public.depenses add constraint justificatif_chemin_org check (public.chemin_de_l_organisation(justificatif_chemin, organisation_id));

-- -----------------------------------------------------------------------------
-- Paiements : l'API ne choisit ni l'auteur, ni l'identifiant Stripe ; le mode
-- « stripe » est réservé au webhook signé (rôle service).
-- -----------------------------------------------------------------------------
revoke insert on public.paiements from authenticated;
grant insert (organisation_id, facture_id, date_paiement, montant_cents, mode, reference, notes, annule_paiement_id)
  on public.paiements to authenticated;

create or replace function public.paiement_origine()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.mode = 'stripe' then
      raise exception 'Un paiement Stripe n''est enregistré que par le webhook.' using errcode = 'P0001';
    end if;
    new.cree_par := auth.uid();
  end if;
  return new;
end;
$$;
create trigger paiements_origine before insert on public.paiements
  for each row execute function public.paiement_origine();

-- Historique des prix : écrit uniquement par le trigger (definer).
revoke insert, update, delete, truncate on public.historique_prix from authenticated;

-- -----------------------------------------------------------------------------
-- Anonymisation d'un client (droit à l'effacement), dans les limites de
-- l'obligation de conservation :
--   * EFFACÉ : fiche client ; chantiers (nom, adresse, notes) ; pièces
--     (notes) ; planning, rappels, temps passés, check-lists (textes) ;
--     envois (destinataire) ; PV de réception non signés ; brouillons de
--     devis et de factures (supprimés : ils n'ont pas de numéro) ;
--   * devis émis JAMAIS acceptés : copies, objet et textes des lignes
--     remplacés par des valeurs constantes, liens publics révoqués, devis
--     encore « envoyé » passé à « refusé » (il ne peut plus être signé) ;
--     leurs PDF sont renvoyés pour suppression du stockage ;
--   * photos et documents de chantier : lignes supprimées, chemins renvoyés ;
--   * CONSERVÉ : factures émises, devis acceptés, signatures, PV signés
--     (obligation légale, durée À VÉRIFIER par le comptable).
-- Le journal d'audit ne contient aucun texte libre (liste blanche) : rien à
-- y expurger.
-- Renvoie la liste des fichiers que le serveur doit supprimer du stockage.
-- -----------------------------------------------------------------------------
create or replace function public.anonymiser_client(p_client_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_chantiers uuid[];
  v_devis_non_acceptes uuid[];
begin
  select organisation_id into v_org from public.clients where id = p_client_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Client introuvable.' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into v_chantiers from public.chantiers where client_id = p_client_id;

  update public.clients set
    civilite = null, nom = 'Client anonymisé', prenom = null, raison_sociale = null,
    siret = null, tva_intra = null, email = null, telephone = null,
    fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
    notes = null, source = null, anonymise_le = now()
  where id = p_client_id;

  update public.chantiers set
    nom = 'Chantier anonymisé', adresse_ligne1 = null, adresse_ligne2 = null,
    code_postal = null, ville = null, notes = null
  where id = any (v_chantiers);
  update public.pieces set notes = null, nom = 'Pièce', etage = null where chantier_id = any (v_chantiers);
  update public.elements set notes = null
  where piece_id in (select id from public.pieces where chantier_id = any (v_chantiers));
  update public.evenements set titre = 'Événement', notes = null where chantier_id = any (v_chantiers);
  update public.rappels set titre = 'Rappel'
  where chantier_id = any (v_chantiers)
     or evenement_id in (select id from public.evenements where chantier_id = any (v_chantiers))
     or (document_type = 'devis' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = 'facture' and document_id in (select id from public.factures where client_id = p_client_id));
  update public.temps_passes set tache = null, note = null where chantier_id = any (v_chantiers);
  update public.checklists_fin_chantier set items = '[]'::jsonb where chantier_id = any (v_chantiers);
  update public.envois set destinataire = null, erreur = null
  where (document_type = 'pv_reception' and document_id in (select id from public.pv_reception where chantier_id = any (v_chantiers)))
     or (document_type = 'devis' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = 'facture' and document_id in (select id from public.factures where client_id = p_client_id))
     or (document_type = 'liste_achat' and document_id = any (v_chantiers));

  -- PV non signés et attestations de devis jamais acceptés : supprimés,
  -- leurs PDF renvoyés pour suppression du stockage.
  return query delete from public.pv_reception
    where chantier_id = any (v_chantiers) and signature_id is null and pdf_chemin is not null returning pdf_chemin;
  delete from public.pv_reception where chantier_id = any (v_chantiers) and signature_id is null;
  -- (Une attestation SIGNÉE est conservée comme preuve : elle est figée, et
  -- sa durée de conservation est À VÉRIFIER par le comptable.)
  return query delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and signature_id is null and pdf_chemin is not null returning pdf_chemin;
  delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and signature_id is null;

  -- Brouillons : supprimés (aucun numéro attribué, aucune obligation).
  delete from public.factures where client_id = p_client_id and statut = 'brouillon';
  delete from public.devis d where d.client_id = p_client_id and d.statut = 'brouillon'
    and not exists (select 1 from public.devis v where v.devis_precedent_id = d.id);

  -- Devis émis jamais acceptés.
  select coalesce(array_agg(id), '{}') into v_devis_non_acceptes
  from public.devis where client_id = p_client_id and statut in ('envoye', 'refuse', 'remplace');

  -- Tous les liens publics des documents du client sont révoqués (devis ET
  -- factures) : plus aucune consultation de PDF nominatif par lien.
  update public.liens_publics set revoque_le = now()
  where revoque_le is null
    and (devis_id in (select id from public.devis where client_id = p_client_id)
         or facture_id in (select id from public.factures where client_id = p_client_id));

  -- 1) un devis encore « envoyé » passe à « refusé » (il ne peut plus être signé) ;
  -- 2) puis les devis refusés / remplacés perdent tous leurs textes libres.
  update public.devis set statut = 'refuse', refuse_le = now(), motif_refus = 'Anonymisation (RGPD)'
  where id = any (v_devis_non_acceptes) and statut = 'envoye';
  perform set_config('hdecor.anonymisation', 'on', true);
  update public.devis set
    copie_client = '{"nom_affiche": "Client anonymisé"}'::jsonb, copie_chantier = '{}'::jsonb, objet = null,
    notes_client = null, conditions_paiement = null, delai_debut_texte = null,
    motif_refus = case when statut = 'refuse' then 'Anonymisation (RGPD)' end
  where id = any (v_devis_non_acceptes);
  update public.devis_lignes set designation = 'Prestation (anonymisée)', description = null, origine = null
  where devis_id = any (v_devis_non_acceptes);
  update public.devis_echeances set libelle = 'Échéance (anonymisée)'
  where devis_id = any (v_devis_non_acceptes);
  perform set_config('hdecor.anonymisation', 'off', true);

  return query select pdf_chemin from public.devis where id = any (v_devis_non_acceptes) and pdf_chemin is not null;
  return query delete from public.photos where chantier_id = any (v_chantiers) returning chemin;
  return query delete from public.documents_chantier where chantier_id = any (v_chantiers) returning chemin;
end;
$$;

-- -----------------------------------------------------------------------------
-- Droits : le rôle anonyme n'a accès à rien dans le schéma public.
-- Les pages publiques passent par le serveur et les fonctions par jeton.
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : on le retire, puis on
-- accorde explicitement, puis on retire les fonctions internes.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- Toute FUTURE fonction est fermée par défaut : chaque migration accorde
-- explicitement ce qui doit être appelable depuis l'API.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
-- EXECUTE à PUBLIC est un défaut GLOBAL (pas par schéma) : il faut le retirer
-- aussi à ce niveau, sinon authenticated en hérite via PUBLIC.
alter default privileges revoke execute on functions from public;
-- Les privilèges par défaut ne valent que pour le rôle qui les pose : on les
-- pose aussi pour le propriétaire réel des objets sur Supabase (postgres).
-- Filet de sécurité permanent : le test de la liste exacte des fonctions
-- SECURITY DEFINER appelables par une session, exécuté en CI.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- (ventilation_attendue reste appelable : fonction pure, sans accès aux
-- données, utile pour vérifier un aperçu.)
-- Internes (triggers, contrôles, numérotation) et réservées au serveur
-- (liens publics) : jamais appelables par une session utilisateur.
revoke execute on function
  public.maj_updated_at(),
  public.appliquer_rls_standard(regclass),
  public.interdire_modification_journal(),
  public.tracer_audit(),
  public.prochain_numero(uuid, text, integer),
  public.historiser_prix(),
  public.proteger_devis(),
  public.proteger_devis_lignes(),
  public.controler_ventilation(jsonb, bigint, bigint, public.regime_tva),
  public.proteger_signature(),
  public.signer_devis_interne(uuid, text, text, text, text, text, uuid[], inet, text),
  public.lien_valide(text, text),
  public.devis_par_jeton(text),
  public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text),
  public.facture_par_jeton(text),
  public.proteger_lien_public(),
  public.controler_totaux_lignes(jsonb, integer, public.regime_tva, jsonb, bigint, bigint),
  public.lignes_devis_par_taux(uuid, uuid[]),
  public.audit_sans_donnees_perso(jsonb),
  public.purger_journal_audit(timestamptz),
  public.paiement_origine(),
  public.proteger_client_chantier(),
  public.proteger_document_signe(),
  public.controler_ligne_reprise(),
  public.verifier_document_meme_org(),
  public.proteger_facture(),
  public.proteger_facture_lignes(),
  public.controler_paiement()
from authenticated;

-- Tables en ajout seul : on retire le privilège lui-même, pas seulement la
-- politique RLS (défense en profondeur ; une erreur explicite vaut mieux
-- qu'une mise à jour silencieusement sans effet).
revoke insert, update, delete, truncate on public.signatures, public.journal_audit, public.sequences_documents
  from authenticated;
revoke update, delete, truncate on public.paiements from authenticated;
-- envois : en ajout seul (seule l'anonymisation, en definer, efface le destinataire).
revoke update, delete, truncate on public.envois from authenticated;
revoke delete, truncate on public.liens_publics from authenticated;
revoke truncate on all tables in schema public from authenticated, service_role;


-- =============================================================================
-- Migration 20261009000100_initialisation_organisation.sql
-- =============================================================================

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


-- =============================================================================
-- Migration 20261009000200_double_authentification_rls.sql
-- =============================================================================

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


-- =============================================================================
-- Migration 20261009000300_clients_recherche_conservation.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 1) : recherche de clients et conservation des prospects.
-- =============================================================================

-- Texte « à plat » pour la recherche : minuscules, sans accents.
create or replace function public.texte_recherche(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Ligatures développées (« Lætitia » est trouvée par « laetitia »).
  select translate(replace(replace(lower(coalesce(p, '')), 'œ', 'oe'), 'æ', 'ae'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ',
    'aaaaaaceeeeiiiinooooouuuuyy');
$$;

-- Recherche instantanée (nom, prénom, raison sociale, email, téléphone,
-- ville). SECURITY INVOKER : la RLS s'applique. Le texte saisi n'est jamais
-- interprété comme une syntaxe de filtre (paramètre de fonction).
create or replace function public.rechercher_clients(
  p_texte text default null,
  p_type public.type_client default null,
  p_inclure_anonymises boolean default false,
  p_limite integer default 50,
  p_decalage integer default 0)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.clients c
  where (p_inclure_anonymises or c.anonymise_le is null)
    and (p_type is null or c.type = p_type)
    and (
      coalesce(trim(p_texte), '') = ''
      or public.texte_recherche(concat_ws(' ', c.nom, c.prenom, c.raison_sociale, c.email,
           regexp_replace(coalesce(c.telephone, ''), '\D', '', 'g'), c.fact_ville))
         like '%' || replace(replace(replace(public.texte_recherche(trim(p_texte)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      -- Recherche par numéro (« 06 12 », « 06.12 », « +33 6 ») : seulement si
      -- la saisie EST un numéro (au moins 2 chiffres, aucune lettre), sinon
      -- « Dupont 2 » trouverait tous les téléphones contenant un 2.
      -- L'indicatif +33 / 0033 vaut 0 des deux côtés (« +33 6 12 » trouve « 06 12 »).
      or (p_texte ~ '^[\s\d.+()-]+$' and length(regexp_replace(p_texte, '\D', '', 'g')) >= 2
          and regexp_replace(regexp_replace(trim(coalesce(c.telephone, '')), '^(\+|00)33', '0'), '\D', '', 'g')
              like '%' || regexp_replace(regexp_replace(trim(p_texte), '^(\+|00)33', '0'), '\D', '', 'g') || '%')
    )
  order by c.anonymise_le nulls first, lower(coalesce(c.raison_sociale, c.nom)), lower(coalesce(c.prenom, ''))
  limit least(greatest(p_limite, 1), 200)
  offset greatest(p_decalage, 0);
$$;

-- -----------------------------------------------------------------------------
-- Conservation des prospects (clients sans aucun document ni chantier) :
-- durée paramétrable, À VÉRIFIER (registre des traitements).
-- -----------------------------------------------------------------------------
alter table public.parametres_entreprise
  add column duree_conservation_prospects_mois integer not null default 36
    check (duree_conservation_prospects_mois between 1 and 120);
alter table public.parametres_entreprise
  alter column valeurs_a_verifier set default array[
    'delai_paiement_jours', 'delai_paiement_max_jours', 'indemnite_recouvrement_cents',
    'escompte_texte', 'validite_devis_jours', 'acompte_pct_defaut_bp', 'taux_penalites_bp',
    'duree_conservation_prospects_mois'];
update public.parametres_entreprise
  set valeurs_a_verifier = array_append(valeurs_a_verifier, 'duree_conservation_prospects_mois')
  where not ('duree_conservation_prospects_mois' = any (valeurs_a_verifier));

-- Prospects inactifs au-delà de la durée : anonymisés. Réservé au serveur
-- (tâche planifiée). Renvoie le nombre de clients anonymisés.
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client record;
  n integer := 0;
begin
  for v_client in
    select c.id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and greatest(c.created_at, c.updated_at) < now() - make_interval(months => p.duree_conservation_prospects_mois)
      and not exists (select 1 from public.devis d where d.client_id = c.id)
      and not exists (select 1 from public.factures f where f.client_id = c.id)
      and not exists (select 1 from public.chantiers ch where ch.client_id = c.id)
  loop
    update public.clients set
      civilite = null, nom = 'Client anonymisé', prenom = null, raison_sociale = null,
      siret = null, tva_intra = null, email = null, telephone = null,
      fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
      notes = null, source = null, anonymise_le = now()
    where id = v_client.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated;
grant execute on function public.purger_prospects_inactifs() to service_role;

-- Les privilèges par défaut (migration 0800) ferment toute nouvelle fonction :
-- ouverture explicite des seules fonctions appelables par une session.
grant execute on function public.texte_recherche(text) to authenticated;
grant execute on function public.rechercher_clients(text, public.type_client, boolean, integer, integer) to authenticated;


-- =============================================================================
-- Migration 20261009000400_effacement_fichiers.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 1) : effacement d'un client sans perte des fichiers à
-- supprimer.
--
-- anonymiser_client renvoie les chemins des fichiers à retirer du stockage.
-- Si le serveur s'arrêtait entre la transaction et la suppression, ces
-- chemins seraient perdus (les lignes qui les portaient sont supprimées) et
-- les fichiers resteraient indéfiniment. effacer_client les inscrit donc dans
-- une file, DANS LA MÊME TRANSACTION ; le serveur la vide ensuite (et la
-- tâche planifiée reprend ce qui a échoué).
-- =============================================================================

create table public.fichiers_a_supprimer (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  chemin           text not null,
  cree_le          timestamptz not null default now(),
  tentatives       integer not null default 0,
  derniere_erreur  text,
  check (public.chemin_de_l_organisation(chemin, organisation_id))
);
-- Invisible pour une session : seul le serveur (service_role) la lit et la
-- vide. Politique explicite réservée à service_role (aucune pour authenticated).
alter table public.fichiers_a_supprimer enable row level security;
create policy serveur_uniquement on public.fichiers_a_supprimer for all to service_role
  using (true) with check (true);
revoke all on public.fichiers_a_supprimer from public, anon, authenticated;
grant select, insert, update, delete on public.fichiers_a_supprimer to service_role;

-- Point d'entrée de l'application pour l'effacement d'un client.
-- Renvoie le nombre de fichiers mis en file.
create or replace function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  n integer;
begin
  -- anonymiser_client contrôle l'appartenance (est_membre) et verrouille la fiche.
  select organisation_id into v_org from public.clients where id = p_client_id;
  insert into public.fichiers_a_supprimer (organisation_id, chemin)
  select v_org, c from public.anonymiser_client(p_client_id) c;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.effacer_client(uuid) from public, anon;
grant execute on function public.effacer_client(uuid) to authenticated, service_role;

-- L'application passe obligatoirement par effacer_client : un appel direct
-- d'anonymiser_client par une session perdrait la liste des fichiers.
revoke execute on function public.anonymiser_client(uuid) from authenticated;


-- =============================================================================
-- Migration 20261009000500_audit_clients_parametres.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 1) : journal d'audit étendu aux clients, assurances et taux
-- de TVA. La liste blanche audit_sans_donnees_perso s'applique : pour un
-- client, le journal garde QUI a créé / modifié / anonymisé QUELLE fiche et
-- QUAND, jamais le nom, l'adresse ni le téléphone.
-- =============================================================================
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.tracer_audit();
create trigger assurances_audit after insert or update or delete on public.assurances
  for each row execute function public.tracer_audit();
create trigger taux_tva_audit after insert or update or delete on public.taux_tva
  for each row execute function public.tracer_audit();


-- =============================================================================
-- Migration 20261009000600_corrections_audits_phase1.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 1) : corrections demandées par les audits de fin de phase.
--   1. Fichiers à supprimer : l'espace de stockage est connu et enregistré
--      (plus de suppression « dans tous les espaces »).
--   2. Une seule liste des champs effacés d'une fiche client (anonymisation
--      à la demande ET purge automatique passent par la même fonction).
--   3. Une fiche anonymisée ne peut plus être modifiée, même par l'API.
--   4. Purge des prospects étendue aux clients sans devis accepté ni facture
--      émise, et seulement une fois la durée de conservation confirmée.
--   5. Confirmation des valeurs « À VÉRIFIER » atomique (pas de lecture puis
--      écriture côté serveur).
-- =============================================================================

-- 1. Espaces de stockage ------------------------------------------------------
alter table public.documents_chantier
  add column espace text not null default 'justificatifs' check (espace in ('documents', 'justificatifs'));

alter table public.fichiers_a_supprimer
  add column espace text not null default 'documents' check (espace in ('documents', 'photos', 'justificatifs', 'signatures', 'marque'));
alter table public.fichiers_a_supprimer alter column espace drop default;
create index fichiers_a_supprimer_org_idx on public.fichiers_a_supprimer (organisation_id);
create index fichiers_a_supprimer_reprise_idx on public.fichiers_a_supprimer (tentatives, id);

-- 3. Fiche anonymisée figée ---------------------------------------------------
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymise_le is not null then
    raise exception 'Fiche anonymisée : modification impossible.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.client_anonymise_fige() from public, anon, authenticated;
create trigger clients_anonymise_fige before update on public.clients
  for each row execute function public.client_anonymise_fige();

-- 2. Anonymisation : cœur commun ----------------------------------------------
-- Effacement de la fiche elle-même : UNIQUE liste des champs personnels.
create or replace function public.vider_fiche_client(p_client_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients set
    civilite = null, nom = 'Client anonymisé', prenom = null, raison_sociale = null,
    siret = null, tva_intra = null, email = null, telephone = null,
    fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
    notes = null, source = null, consentement_le = null, anonymise_le = now()
  where id = p_client_id;
$$;
revoke execute on function public.vider_fiche_client(uuid) from public, anon, authenticated;

-- Anonymisation complète SANS contrôle d'appartenance : réservée aux
-- fonctions qui ont déjà contrôlé (effacer_client) ou au serveur (purge).
-- Renvoie l'espace et le chemin de chaque fichier à supprimer du stockage.
drop function public.effacer_client(uuid);
drop function public.anonymiser_client(uuid);
create function public.anonymiser_client_interne(p_client_id uuid)
returns table (espace text, chemin text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chantiers uuid[];
  v_devis_non_acceptes uuid[];
begin
  perform 1 from public.clients where id = p_client_id for update;
  select coalesce(array_agg(id), '{}') into v_chantiers from public.chantiers where client_id = p_client_id;

  perform public.vider_fiche_client(p_client_id);

  update public.chantiers set
    nom = 'Chantier anonymisé', adresse_ligne1 = null, adresse_ligne2 = null,
    code_postal = null, ville = null, notes = null
  where id = any (v_chantiers);
  update public.pieces set notes = null, nom = 'Pièce', etage = null where chantier_id = any (v_chantiers);
  update public.elements set notes = null
  where piece_id in (select id from public.pieces where chantier_id = any (v_chantiers));
  update public.evenements set titre = 'Événement', notes = null where chantier_id = any (v_chantiers);
  update public.rappels set titre = 'Rappel'
  where chantier_id = any (v_chantiers)
     or evenement_id in (select id from public.evenements where chantier_id = any (v_chantiers))
     or (document_type = 'devis' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = 'facture' and document_id in (select id from public.factures where client_id = p_client_id));
  update public.temps_passes set tache = null, note = null where chantier_id = any (v_chantiers);
  update public.checklists_fin_chantier set items = '[]'::jsonb where chantier_id = any (v_chantiers);
  update public.envois set destinataire = null, erreur = null
  where (document_type = 'pv_reception' and document_id in (select id from public.pv_reception where chantier_id = any (v_chantiers)))
     or (document_type = 'devis' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = 'facture' and document_id in (select id from public.factures where client_id = p_client_id))
     or (document_type = 'liste_achat' and document_id = any (v_chantiers));

  -- PV non signés et attestations de devis jamais acceptés : supprimés.
  -- (Une attestation SIGNÉE est conservée comme preuve, durée À VÉRIFIER.)
  return query delete from public.pv_reception p
    where p.chantier_id = any (v_chantiers) and p.signature_id is null and p.pdf_chemin is not null
    returning 'documents'::text, p.pdf_chemin;
  delete from public.pv_reception where chantier_id = any (v_chantiers) and signature_id is null;
  return query delete from public.attestations_tva a
    where a.devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and a.signature_id is null and a.pdf_chemin is not null
    returning 'documents'::text, a.pdf_chemin;
  delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and signature_id is null;

  -- Brouillons : supprimés (aucun numéro attribué, aucune obligation).
  delete from public.factures where client_id = p_client_id and statut = 'brouillon';
  delete from public.devis d where d.client_id = p_client_id and d.statut = 'brouillon'
    and not exists (select 1 from public.devis v where v.devis_precedent_id = d.id);

  select coalesce(array_agg(id), '{}') into v_devis_non_acceptes
  from public.devis where client_id = p_client_id and statut in ('envoye', 'refuse', 'remplace');

  update public.liens_publics set revoque_le = now()
  where revoque_le is null
    and (devis_id in (select id from public.devis where client_id = p_client_id)
         or facture_id in (select id from public.factures where client_id = p_client_id));

  update public.devis set statut = 'refuse', refuse_le = now(), motif_refus = 'Anonymisation (RGPD)'
  where id = any (v_devis_non_acceptes) and statut = 'envoye';
  perform set_config('hdecor.anonymisation', 'on', true);
  update public.devis set
    copie_client = '{"nom_affiche": "Client anonymisé"}'::jsonb, copie_chantier = '{}'::jsonb, objet = null,
    notes_client = null, conditions_paiement = null, delai_debut_texte = null,
    motif_refus = case when statut = 'refuse' then 'Anonymisation (RGPD)' end
  where id = any (v_devis_non_acceptes);
  update public.devis_lignes set designation = 'Prestation (anonymisée)', description = null, origine = null
  where devis_id = any (v_devis_non_acceptes);
  update public.devis_echeances set libelle = 'Échéance (anonymisée)'
  where devis_id = any (v_devis_non_acceptes);
  perform set_config('hdecor.anonymisation', 'off', true);

  return query select 'documents'::text, d.pdf_chemin from public.devis d
    where d.id = any (v_devis_non_acceptes) and d.pdf_chemin is not null;
  return query delete from public.photos ph where ph.chantier_id = any (v_chantiers)
    returning 'photos'::text, ph.chemin;
  return query delete from public.documents_chantier dc where dc.chantier_id = any (v_chantiers)
    returning dc.espace, dc.chemin;
end;
$$;
revoke execute on function public.anonymiser_client_interne(uuid) from public, anon, authenticated, service_role;

-- Point d'entrée de l'application : contrôle d'appartenance, anonymisation et
-- mise en file des fichiers dans la même transaction.
create function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_anonymise timestamptz;
  n integer;
begin
  select organisation_id, anonymise_le into v_org, v_anonymise from public.clients where id = p_client_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Client introuvable.' using errcode = 'P0002';
  end if;
  if v_anonymise is not null then
    raise exception 'Client déjà anonymisé.' using errcode = 'P0001';
  end if;
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, f.espace, f.chemin from public.anonymiser_client_interne(p_client_id) f;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.effacer_client(uuid) from public, anon;
grant execute on function public.effacer_client(uuid) to authenticated, service_role;

-- 4. Purge automatique des prospects ------------------------------------------
-- Client sans facture émise ni devis accepté, sans activité (fiche, devis,
-- chantier) depuis la durée paramétrée. Rien n'est purgé tant que cette
-- durée est encore « À VÉRIFIER » (purge irréversible).
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    select c.id, c.organisation_id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and not ('duree_conservation_prospects_mois' = any (p.valeurs_a_verifier))
      and not exists (select 1 from public.factures f where f.client_id = c.id and f.statut <> 'brouillon')
      and not exists (select 1 from public.devis d where d.client_id = c.id and d.statut = 'accepte')
      and greatest(c.created_at, c.updated_at,
                   (select max(d.updated_at) from public.devis d where d.client_id = c.id),
                   (select max(ch.updated_at) from public.chantiers ch where ch.client_id = c.id))
          < now() - make_interval(months => p.duree_conservation_prospects_mois)
  loop
    insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
    select v.organisation_id, f.espace, f.chemin from public.anonymiser_client_interne(v.id) f;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated;
grant execute on function public.purger_prospects_inactifs() to service_role;

-- 5. Confirmation atomique des valeurs « À VÉRIFIER » --------------------------
-- SECURITY INVOKER : la RLS limite la mise à jour à l'organisation du membre.
create or replace function public.confirmer_valeurs(p_organisation_id uuid, p_confirmees text[])
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with maj as (
    update public.parametres_entreprise
    set valeurs_a_verifier = array(select v from unnest(valeurs_a_verifier) v where v <> all (coalesce(p_confirmees, '{}')))
    where organisation_id = p_organisation_id
    returning 1)
  select exists (select 1 from maj);
$$;
revoke execute on function public.confirmer_valeurs(uuid, text[]) from public, anon;
grant execute on function public.confirmer_valeurs(uuid, text[]) to authenticated;


-- =============================================================================
-- Migration 20261009000700_fichiers_chantier_cloisonnes.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 1) : faille H1 de l'audit sécurité (boucle 2).
-- Une ligne photos / documents_chantier pouvait pointer vers le PDF d'une
-- facture émise ; l'effacement du client propriétaire de cette ligne mettait
-- alors ce PDF en file de suppression (clé de service : la politique de
-- stockage qui protège les documents émis ne s'appliquait pas).
-- Défenses, de la plus forte à la dernière ligne :
--   1. les fichiers de chantier vivent sous <org>/chantiers/<chantier>/… :
--      ils ne peuvent plus désigner un document émis ;
--   2. leur chemin et leur espace ne sont plus modifiables par une session ;
--   3. un document de chantier ne vit que dans l'espace « justificatifs » ;
--   4. la file refuse tout chemin référencé par un document émis, signé ou
--      accepté, et n'accepte que les espaces documents / photos / justificatifs.
-- =============================================================================

-- 1. Préfixe propre au chantier ------------------------------------------------
create or replace function public.chemin_du_chantier(p_chemin text, p_organisation_id uuid, p_chantier_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_chemin like p_organisation_id::text || '/chantiers/' || p_chantier_id::text || '/%'
     and position('..' in p_chemin) = 0
     and position('//' in p_chemin) = 0;
$$;
-- Fonction pure appelée par les contraintes CHECK : celles-ci s'évaluent avec
-- les droits de la session qui insère (comme chemin_de_l_organisation).
revoke execute on function public.chemin_du_chantier(text, uuid, uuid) from public, anon;
grant execute on function public.chemin_du_chantier(text, uuid, uuid) to authenticated, service_role;

alter table public.photos add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id));
alter table public.documents_chantier add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id));

-- 3. Un seul espace pour les documents de chantier ----------------------------
alter table public.documents_chantier drop constraint documents_chantier_espace_check;
alter table public.documents_chantier add constraint documents_chantier_espace_check check (espace = 'justificatifs');

-- 2. Chemin et espace figés après dépôt ----------------------------------------
revoke update on public.photos from authenticated;
grant update (piece_id, moment, annotations, legende) on public.photos to authenticated;
revoke update on public.documents_chantier from authenticated;
grant update (type, nom) on public.documents_chantier to authenticated;

-- 4. File de suppression : jamais un document protégé --------------------------
alter table public.fichiers_a_supprimer drop constraint fichiers_a_supprimer_espace_check;
alter table public.fichiers_a_supprimer add constraint fichiers_a_supprimer_espace_check
  check (espace in ('documents', 'photos', 'justificatifs'));

create or replace function public.fichier_protege(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.factures f where p_chemin in (f.pdf_chemin, f.facturx_chemin))
      or exists (select 1 from public.devis d where d.pdf_chemin = p_chemin and d.statut = 'accepte')
      or exists (select 1 from public.signatures s where p_chemin in (s.image_chemin, s.pdf_signe_chemin))
      or exists (select 1 from public.pv_reception p where p.pdf_chemin = p_chemin and p.signature_id is not null)
      or exists (select 1 from public.attestations_tva a where a.pdf_chemin = p_chemin and a.signature_id is not null);
$$;
revoke execute on function public.fichier_protege(text) from public, anon, authenticated;

-- Une ligne visant un fichier protégé est écartée (pas d'erreur : l'effacement
-- RGPD du reste doit aboutir) ; l'écart est tracé dans les journaux serveur.
create or replace function public.file_sans_fichier_protege()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.fichier_protege(new.chemin) then
    raise warning 'Fichier protégé écarté de la file de suppression (organisation %)', new.organisation_id;
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.file_sans_fichier_protege() from public, anon, authenticated;
create trigger fichiers_a_supprimer_proteges before insert on public.fichiers_a_supprimer
  for each row execute function public.file_sans_fichier_protege();

-- Relecture : la fiche anonymisée reste figée pour les sessions et la clé de
-- service ; le propriétaire (migrations, fonctions internes) garde la main
-- pour une évolution de schéma (nouvelle colonne à remplir, par exemple).
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymise_le is not null and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'Fiche anonymisée : modification impossible.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;


-- =============================================================================
-- Migration 20261010000100_metre_calculateur.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 2) : métré et calculateur de peinture.
--   1. Paramètres : porte par défaut (83 × 204 cm), formats de pots usuels.
--   2. Postes : type de produit (sans produit du catalogue), majoration de temps.
--   3. Éléments : conversion en m² (largeur développée, surface d'une unité).
--   4. Consommables (rouleaux, bâches, adhésif, abrasif) : lignes paramétrables.
--   5. Valeurs de départ du calcul, toutes « À VÉRIFIER », pour chaque organisation.
--   6. Suppression d'un chantier : seulement sans document, fichiers mis en
--      file de suppression (point B11 reporté de la Phase 1).
-- Les calculs restent dans src/domain ; la base ne stocke que la saisie.
-- =============================================================================

-- 1. Paramètres -----------------------------------------------------------------
alter table public.parametres_entreprise
  add column porte_largeur_mm integer not null default 830 check (porte_largeur_mm between 300 and 3000),
  add column porte_hauteur_mm integer not null default 2040 check (porte_hauteur_mm between 1000 and 4000),
  -- Formats proposés quand aucun produit du catalogue n'est choisi (ml).
  add column formats_pots_ml integer[] not null default array[1000, 2500, 5000, 10000, 15000]
    check (cardinality(formats_pots_ml) between 1 and 10 and 0 < all (formats_pots_ml) and 100000 >= all (formats_pots_ml));

-- 2. Postes ---------------------------------------------------------------------
alter table public.postes_travaux
  add column type_produit text check (type_produit is null or type_produit in (
    'sous_couche', 'impression', 'acrylique', 'glycero', 'laque', 'facade', 'lasure', 'vernis', 'enduit',
    'anti_humidite', 'anti_rouille', 'sous_couche_bloquante', 'autre')),
  -- Hauteur, mobilier, état du support : majoration du temps (20 % -> 2 000).
  add column majoration_temps_bp integer not null default 0 check (majoration_temps_bp between 0 and 50000),
  add column ordre smallint not null default 0,
  add column created_at timestamptz not null default now(),
  add constraint poste_produit_ou_type check (produit_id is not null or type_produit is not null);
create index postes_travaux_piece_idx on public.postes_travaux (organisation_id, piece_id, ordre);

-- 3. Éléments -------------------------------------------------------------------
alter table public.elements
  add column developpe_mm integer check (developpe_mm is null or developpe_mm between 1 and 5000),
  add column surface_unitaire_mm2 bigint check (surface_unitaire_mm2 is null or surface_unitaire_mm2 between 1 and 100000000);

-- 4. Consommables -----------------------------------------------------------------
create table public.consommables (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  libelle             text not null check (length(libelle) between 1 and 200),
  mode                text not null check (mode in ('par_chantier', 'par_m2')),
  -- Forfait par chantier, ou prix par m² peint (centimes).
  prix_ht_cents       bigint not null check (prix_ht_cents between 0 and 100000000),
  statut_verification public.statut_verification not null default 'a_verifier',
  actif               boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organisation_id, id)
);
select public.appliquer_rls_standard('public.consommables');

-- 5. Valeurs de départ ----------------------------------------------------------
-- Fourchettes du cahier des charges (§5.4), marquées À VÉRIFIER. Aucun temps
-- de pose ni coefficient n'est inventé : temps vides (à renseigner),
-- coefficients à 1,00 (aucun effet tant qu'ils ne sont pas confirmés).
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
         -- Enduit : valeur de départ du cahier des charges (1 m²/kg par passe), À VÉRIFIER sur la fiche du produit utilisé.
         (p_organisation_id, 'enduit', 1, 1)
  on conflict do nothing;
  insert into public.coefficients_support (organisation_id, support)
  select p_organisation_id, s from unnest(array['platre_neuf', 'ancienne_peinture', 'beton', 'enduit', 'bois_brut',
    'bois_vernis', 'metal', 'papier_peint', 'carrelage', 'autre']) s
  on conflict do nothing;
  insert into public.etapes_preparation (organisation_id, code, libelle, ordre)
  values (p_organisation_id, 'protection', 'Protection du chantier (bâches, adhésifs)', 1),
         (p_organisation_id, 'depose_papier_peint', 'Dépose de papier peint', 2),
         (p_organisation_id, 'decapage', 'Décapage', 3),
         (p_organisation_id, 'lessivage', 'Lessivage', 4),
         (p_organisation_id, 'rebouchage', 'Rebouchage', 5),
         (p_organisation_id, 'bande_joint', 'Bande à joint', 6),
         (p_organisation_id, 'enduit_1_passe', 'Enduit (une passe)', 7),
         (p_organisation_id, 'enduit_2_passes', 'Enduit (deux passes)', 8),
         (p_organisation_id, 'poncage', 'Ponçage', 9),
         (p_organisation_id, 'impression', 'Impression ou sous-couche', 10),
         (p_organisation_id, 'sous_couche_bloquante', 'Sous-couche bloquante (taches)', 11)
  on conflict do nothing;
$$;
revoke execute on function public.initialiser_calcul(uuid) from public, anon, authenticated;

create or replace function public.organisation_initialiser_calcul()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialiser_calcul(new.id);
  return null;
end;
$$;
revoke execute on function public.organisation_initialiser_calcul() from public, anon, authenticated;
create trigger organisations_initialiser_calcul after insert on public.organisations
  for each row execute function public.organisation_initialiser_calcul();

-- Organisations existantes.
select public.initialiser_calcul(id) from public.organisations;

-- 6. Suppression d'un chantier ----------------------------------------------------
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
     or exists (select 1 from public.pv_reception where chantier_id = p_chantier_id) then
    raise exception 'Ce chantier a des devis, factures ou un PV : il ne peut pas être supprimé.' using errcode = 'P0001';
  end if;
  -- Fichiers de chantier : mis en file AVANT la suppression en cascade.
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
-- Plus de suppression directe : les fichiers seraient orphelins.
revoke delete on public.chantiers from authenticated;


-- =============================================================================
-- Migration 20261010000200_operations_metre.sql
-- =============================================================================

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


-- =============================================================================
-- Migration 20261010000300_calcul_corrections_audits.sql
-- =============================================================================

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

-- Pots sans prix : reste toléré en % du besoin (règle R3), paramétrable.
alter table public.parametres_entreprise
  add column tolerance_reste_bp integer not null default 1000 check (tolerance_reste_bp between 0 and 10000);

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
-- p_nouvelle : identifiant fixé par le formulaire ; un nouvel envoi (réponse
-- perdue) renvoie la copie déjà faite au lieu d'en créer une seconde.
drop function public.dupliquer_piece(uuid, text);
create function public.dupliquer_piece(p_piece_id uuid, p_nom text, p_nouvelle uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_nouvelle uuid := coalesce(p_nouvelle, gen_random_uuid());
  v_correspondance jsonb := '{}';
  v_element record;
  v_poste record;
  v_nouvel_element uuid;
  v_nouveau_poste uuid;
begin
  if p_nom is null or length(trim(p_nom)) not between 1 and 100 then
    raise exception 'Nom de pièce invalide.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.pieces where id = p_piece_id) then
    raise exception 'Pièce introuvable.' using errcode = 'P0002';
  end if;
  -- Copie déjà faite par un premier envoi (même chantier) : rien à refaire.
  if exists (select 1 from public.pieces n join public.pieces o on o.chantier_id = n.chantier_id
             where n.id = v_nouvelle and o.id = p_piece_id) then
    return v_nouvelle;
  end if;
  insert into public.pieces (id, organisation_id, chantier_id, nom, etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre)
  select v_nouvelle, organisation_id, chantier_id, trim(p_nom), etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre + 1
  from public.pieces where id = p_piece_id;

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
revoke execute on function public.dupliquer_piece(uuid, text, uuid) from public, anon;
grant execute on function public.dupliquer_piece(uuid, text, uuid) to authenticated;

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
    -- md5 mis en forme d'UUID valide (version 5, variante RFC 4122) : l'application
    -- refuse tout identifiant qui n'en est pas un (Modifier, Retirer).
    v_copie := overlay(overlay(md5(p_poste_id::text || ':' || v_piece::text) placing '5' from 13 for 1) placing '8' from 17 for 1)::uuid;
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


-- =============================================================================
-- Migration 20261011000100_catalogue_phase3.sql
-- =============================================================================

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
    cardinality(formats_ml) between 1 and 10 and 100 <= all (formats_ml) and 100000 >= all (formats_ml)));

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
      values (p_organisation_id, v_marque, nullif(trim(v_ligne ->> 'gamme'), ''), v_ref, v_designation, v_ligne ->> 'type',
        coalesce(v_usages, '{}'), v_ligne ->> 'finition',
        coalesce(v_ligne ->> 'unite_mesure', case when v_ligne ->> 'type' = 'enduit' then 'kg' else 'L' end),
        (v_ligne ->> 'rendement')::numeric, (v_ligne ->> 'couches')::smallint, (v_ligne ->> 'sechage_h')::numeric,
        nullif(trim(v_ligne ->> 'fournisseur'), ''), nullif(trim(v_ligne ->> 'fiche_technique_url'), ''), 'a_verifier')
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
        gamme = case when v_ligne ? 'gamme' then nullif(trim(v_ligne ->> 'gamme'), '') else gamme end,
        usages = coalesce(v_usages, usages),
        finition = case when v_ligne ? 'finition' then v_ligne ->> 'finition' else finition end,
        unite_mesure = coalesce(v_ligne ->> 'unite_mesure', unite_mesure),
        rendement_m2_par_unite = case when v_ligne ? 'rendement' then (v_ligne ->> 'rendement')::numeric else rendement_m2_par_unite end,
        couches_recommandees = case when v_ligne ? 'couches' then (v_ligne ->> 'couches')::smallint else couches_recommandees end,
        sechage_recouvrable_h = case when v_ligne ? 'sechage_h' then (v_ligne ->> 'sechage_h')::numeric else sechage_recouvrable_h end,
        fournisseur = case when v_ligne ? 'fournisseur' then nullif(trim(v_ligne ->> 'fournisseur'), '') else fournisseur end,
        fiche_technique_url = case when v_ligne ? 'fiche_technique_url' then nullif(trim(v_ligne ->> 'fiche_technique_url'), '') else fiche_technique_url end,
        actif = true
      where id = v_id
      returning * into v_apres;
      -- Valeur technique (ou lien de la fiche, souvent la source de la vérification) changée : la vérification ne vaut plus.
      if (v_apres.designation, v_apres.type, (select array_agg(u order by u) from unnest(v_apres.usages) u), v_apres.finition,
          v_apres.unite_mesure, v_apres.rendement_m2_par_unite, v_apres.couches_recommandees, v_apres.sechage_recouvrable_h, v_apres.gamme,
          v_apres.fiche_technique_url)
         is distinct from
         (v_avant.designation, v_avant.type, (select array_agg(u order by u) from unnest(v_avant.usages) u), v_avant.finition,
          v_avant.unite_mesure, v_avant.rendement_m2_par_unite, v_avant.couches_recommandees, v_avant.sechage_recouvrable_h, v_avant.gamme,
          v_avant.fiche_technique_url) then
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


-- =============================================================================
-- Migration 20261012000100_devis_phase4.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 4) : devis.
--   1. Numéro prévisionnel : le PDF porte son numéro AVANT l'émission ;
--      emettre_devis vérifie que le numéro et la date attribués sont bien
--      ceux du PDF (sinon tout est annulé : aucun trou dans la numérotation).
--   2. Duplication d'un devis en nouveau brouillon.
--   3. Modèles de messages par défaut (envoi, relance), modifiables.
--   4. Devis à relancer (tâche planifiée, rôle service).
-- =============================================================================

-- 1. Numéro prévisionnel ---------------------------------------------------------
-- SECURITY INVOKER : la session lit son devis et son compteur (RLS).
create or replace function public.numero_devis_previsionnel(p_devis_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_devis public.devis%rowtype;
  v_date  date := public.aujourd_hui_paris();
  v_annee integer := extract(year from v_date)::integer;
  v_n     integer;
begin
  select * into v_devis from public.devis where id = p_devis_id;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  if v_devis.devis_precedent_id is not null then
    return jsonb_build_object('numero', (select numero from public.devis where id = v_devis.devis_precedent_id),
                              'date_emission', v_date);
  end if;
  select dernier + 1 into v_n from public.sequences_documents
  where organisation_id = v_devis.organisation_id and type = 'DEV' and annee = v_annee;
  return jsonb_build_object('numero', 'DEV-' || v_annee || '-' || lpad(coalesce(v_n, 1)::text, 4, '0'),
                            'date_emission', v_date);
end;
$$;

revoke execute on function public.numero_devis_previsionnel(uuid) from public, anon;
grant execute on function public.numero_devis_previsionnel(uuid) to authenticated;

-- 2. Émission : numéro et date attendus ------------------------------------------
drop function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text);
create function public.emettre_devis(
  p_devis_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text,
  p_numero_attendu text default null,
  p_date_attendue date default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_devis   public.devis%rowtype;
  v_numero  text;
  v_somme_lignes bigint;
  v_date    date := public.aujourd_hui_paris();
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  if v_devis.statut <> 'brouillon' then
    raise exception 'Ce devis a déjà été émis.' using errcode = 'P0001';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme_lignes
  from public.devis_lignes
  where devis_id = p_devis_id and type = 'ligne' and not optionnelle;
  if v_somme_lignes = 0 then
    raise exception 'Un devis sans ligne chiffrée ne peut pas être émis.' using errcode = 'P0001';
  end if;
  perform 1 from public.chantiers where id = v_devis.chantier_id for share;
  if v_devis.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_devis.chantier_id and c.client_id <> v_devis.client_id) then
    raise exception 'Le chantier du devis appartient à un autre client.' using errcode = 'P0001';
  end if;
  perform public.controler_totaux_lignes(public.lignes_devis_par_taux(p_devis_id, '{}'),
    v_devis.remise_globale_bp, v_devis.regime_tva, v_devis.ventilation_tva,
    v_devis.total_ht_cents, v_devis.total_tva_cents);
  perform public.controler_ventilation(v_devis.ventilation_tva, v_devis.total_ht_cents,
                                        v_devis.total_tva_cents, v_devis.regime_tva);
  if (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances where devis_id = p_devis_id) > 10000 then
    raise exception 'L''échéancier dépasse 100 %% du devis.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.devis_echeances where devis_id = p_devis_id)
     and v_devis.acompte_pct_bp <> (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances
                                    where devis_id = p_devis_id and declencheur = 'signature') then
    raise exception 'L''acompte du devis ne correspond pas à l''échéancier.' using errcode = 'P0001';
  end if;

  if v_devis.devis_precedent_id is null then
    v_numero := public.prochain_numero(v_devis.organisation_id, 'DEV', extract(year from v_date)::integer);
  else
    select numero into v_numero from public.devis where id = v_devis.devis_precedent_id;
  end if;

  -- Le PDF porte un numéro et une date : s'ils ne sont plus ceux attribués
  -- (autre émission entre-temps, passage de minuit), tout est annulé — le
  -- compteur aussi — et le serveur régénère le PDF.
  if p_numero_attendu is not null and (v_numero <> p_numero_attendu or v_date <> p_date_attendue) then
    raise exception 'Numéro ou date changés pendant l''émission : %, %.', v_numero, v_date using errcode = 'HD001';
  end if;

  update public.devis set
    numero = v_numero,
    statut = 'envoye',
    date_emission = v_date,
    envoye_le = now(),
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_devis_id;

  return v_numero;
end;
$$;
revoke execute on function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text, text, date) from public, anon;
grant execute on function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text, text, date) to authenticated;

-- 3. Duplication -------------------------------------------------------------------
-- Nouveau BROUILLON indépendant (version 1, nouveau numéro à l'émission), avec
-- lignes, échéancier et achats retenus. SECURITY INVOKER : la RLS s'applique.
create or replace function public.dupliquer_devis(p_devis_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ancien  public.devis%rowtype;
  v_nouveau uuid := gen_random_uuid();
begin
  select * into v_ancien from public.devis where id = p_devis_id;
  if not found then raise exception 'Devis introuvable.' using errcode = 'P0002'; end if;
  insert into public.devis (id, organisation_id, client_id, chantier_id,
    objet, validite_jours, date_debut_travaux, delai_debut_texte, duree_estimee_jours, acompte_pct_bp,
    conditions_paiement, hors_etablissement, regime_tva, remise_globale_bp, notes_client,
    total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  values (v_nouveau, v_ancien.organisation_id, v_ancien.client_id, v_ancien.chantier_id,
    v_ancien.objet, v_ancien.validite_jours, null, v_ancien.delai_debut_texte, v_ancien.duree_estimee_jours,
    v_ancien.acompte_pct_bp, v_ancien.conditions_paiement, v_ancien.hors_etablissement,
    -- Le régime de TVA est celui d'AUJOURD'HUI (paramètres), pas celui du devis copié.
    (select regime_tva from public.parametres_entreprise where organisation_id = v_ancien.organisation_id),
    v_ancien.remise_globale_bp, v_ancien.notes_client, 0, 0, 0, '[]');
  insert into public.devis_lignes (organisation_id, devis_id, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues)
  select organisation_id, v_nouveau, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues
  from public.devis_lignes where devis_id = p_devis_id;
  insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur, date_prevue)
  select organisation_id, v_nouveau, ordre, libelle, pourcentage_bp, declencheur,
    case when declencheur = 'date' then date_prevue end
  from public.devis_echeances where devis_id = p_devis_id;
  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents)
  select organisation_id, v_nouveau, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents
  from public.devis_achats where devis_id = p_devis_id;
  return v_nouveau;
end;
$$;
revoke execute on function public.dupliquer_devis(uuid) from public, anon;
grant execute on function public.dupliquer_devis(uuid) to authenticated;

-- 4. Modèles de messages par défaut -------------------------------------------------
-- Textes courants modifiables (Paramètres). Champs remplacés à l'envoi :
-- {client}, {entreprise}, {numero}, {lien}, {valide_jusqu_au}.
create or replace function public.initialiser_messages(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values
    (p_organisation_id, 'envoi_devis', 'Votre devis {numero}',
     E'Bonjour {client},\n\nVous trouverez votre devis {numero} en suivant ce lien : {lien}\nVous pouvez le consulter, le télécharger et le signer en ligne. Il est valable jusqu''au {valide_jusqu_au}.\n\nCordialement,\n{entreprise}', null),
    (p_organisation_id, 'relance_devis', 'Votre devis {numero}',
     E'Bonjour {client},\n\nJe me permets de revenir vers vous au sujet du devis {numero}, valable jusqu''au {valide_jusqu_au}. Vous pouvez le consulter et le signer ici : {lien}\nJe reste à votre disposition pour toute question.\n\nCordialement,\n{entreprise}', 7)
  on conflict (organisation_id, code) do nothing;
$$;
revoke execute on function public.initialiser_messages(uuid) from public, anon, authenticated;

create or replace function public.organisation_initialiser_messages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialiser_messages(new.id);
  return null;
end;
$$;
revoke execute on function public.organisation_initialiser_messages() from public, anon, authenticated;
create trigger organisations_initialiser_messages after insert on public.organisations
  for each row execute function public.organisation_initialiser_messages();
select public.initialiser_messages(id) from public.organisations;

-- 5. Devis à relancer (tâche planifiée) ---------------------------------------------
-- Devis envoyés, ni signés ni refusés, encore valables, envoyés depuis au moins
-- « relance_devis_jours » (paramètres), relance activée, jamais relancés, avec
-- l'email du client. Une seule relance automatique par devis.
create or replace function public.devis_a_relancer()
returns table (organisation_id uuid, devis_id uuid, numero text, version smallint, email text,
               client text, entreprise text, valide_jusqu_au date)
language sql
stable
security definer
set search_path = ''
as $$
  select d.organisation_id, d.id, d.numero, d.version, c.email,
         coalesce(d.copie_client ->> 'nom_affiche', c.nom), coalesce(p.raison_sociale, ''),
         d.date_emission + d.validite_jours
  from public.devis d
  join public.parametres_entreprise p on p.organisation_id = d.organisation_id
  join public.clients c on c.id = d.client_id and c.organisation_id = d.organisation_id
  where d.statut = 'envoye'
    and p.relance_devis_active
    and d.envoye_le <= now() - make_interval(days => p.relance_devis_jours)
    and d.date_emission + d.validite_jours >= public.aujourd_hui_paris()
    and c.email is not null and c.anonymise_le is null
    and not exists (select 1 from public.envois e
                    where e.document_type = 'devis' and e.document_id = d.id and e.nature = 'relance_devis' and e.statut = 'envoye');
$$;
revoke execute on function public.devis_a_relancer() from public, anon, authenticated;
grant execute on function public.devis_a_relancer() to service_role;


-- =============================================================================
-- Migration 20261013000100_devis_ecrans.sql
-- =============================================================================

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


-- =============================================================================
-- Migration 20261014000100_devis_corrections.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR, phase 4 : corrections après la première boucle de contrôle.
-- =============================================================================

-- 1. Garde-fou d'émission en base (indépendant de l'interface) : taux de TVA
--    des lignes cohérents avec le régime et les Paramètres, total HT > 0.
create or replace function public.controler_emission_devis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut = 'brouillon' and new.statut = 'envoye' then
    if coalesce(new.total_ht_cents, 0) <= 0 then
      raise exception 'Un devis à 0 € HT ne peut pas être émis.' using errcode = 'P0001';
    end if;
    -- Échéancier : les échéances « à la signature » en tête (montants calculés en cumulé, acompte exact).
    if exists (
         select 1 from public.devis_echeances s
         where s.devis_id = new.id and s.declencheur = 'signature'
           and exists (select 1 from public.devis_echeances a
                       where a.devis_id = new.id and a.declencheur <> 'signature' and a.ordre < s.ordre)) then
      raise exception 'Échéancier : les échéances à la signature doivent venir en premier.' using errcode = 'P0001';
    end if;
    if new.regime_tva = 'franchise' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = 'ligne' and l.taux_tva_bp <> 0) then
      raise exception 'Franchise en base de TVA : toutes les lignes doivent être à 0 %%.' using errcode = 'P0001';
    end if;
    if new.regime_tva = 'assujetti' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = 'ligne'
           and (l.taux_tva_bp = 0 or not exists (
                  select 1 from public.taux_tva t
                  where t.organisation_id = new.organisation_id and t.taux_bp = l.taux_tva_bp and t.actif))) then
      raise exception 'Taux de TVA d''une ligne absent des Paramètres ou à 0 %% sans justification.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.controler_emission_devis() from public, anon, authenticated;
create trigger devis_controle_emission before update on public.devis
  for each row execute function public.controler_emission_devis();

-- 2. Version remplacée : ses liens publics sont désactivés dans la même
--    transaction (plus d'appel séparé qui pourrait échouer).
create or replace function public.revoquer_liens_devis_remplace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'remplace' and old.statut is distinct from 'remplace' then
    update public.liens_publics set revoque_le = now()
    where devis_id = new.id and organisation_id = new.organisation_id and revoque_le is null;
  end if;
  return null;
end;
$$;
revoke execute on function public.revoquer_liens_devis_remplace() from public, anon, authenticated;
create trigger devis_remplace_revoque_liens after update on public.devis
  for each row execute function public.revoquer_liens_devis_remplace();

-- 3. Relances : seulement après un ENVOI réel (email ou lien partagé), le délai
--    courant depuis le dernier envoi (et non depuis l'émission).
create or replace function public.devis_a_relancer()
returns table (organisation_id uuid, devis_id uuid, numero text, version smallint, email text,
               client text, entreprise text, valide_jusqu_au date)
language sql
stable
security definer
set search_path = ''
as $$
  select d.organisation_id, d.id, d.numero, d.version, c.email,
         coalesce(d.copie_client ->> 'nom_affiche', c.nom), coalesce(p.raison_sociale, ''),
         d.date_emission + d.validite_jours
  from public.devis d
  join public.parametres_entreprise p on p.organisation_id = d.organisation_id
  join public.clients c on c.id = d.client_id and c.organisation_id = d.organisation_id
  join lateral (
    select max(e.envoye_le) as dernier from public.envois e
    where e.document_type = 'devis' and e.document_id = d.id and e.organisation_id = d.organisation_id
      and e.nature = 'envoi' and e.statut = 'envoye'
  ) envoi on envoi.dernier is not null
  where d.statut = 'envoye'
    and p.relance_devis_active
    and envoi.dernier <= now() - make_interval(days => p.relance_devis_jours)
    and d.date_emission + d.validite_jours >= public.aujourd_hui_paris()
    and c.email is not null and c.anonymise_le is null
    and not exists (select 1 from public.envois e
                    where e.document_type = 'devis' and e.document_id = d.id and e.nature = 'relance_devis' and e.statut = 'envoye');
$$;
revoke execute on function public.devis_a_relancer() from public, anon, authenticated;
grant execute on function public.devis_a_relancer() to service_role;

-- 4. Achats retenus d'un brouillon remplacés en une seule transaction.
create or replace function public.remplacer_achats_devis(p_devis_id uuid, p_achats jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id;
  if v_org is null then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  delete from public.devis_achats where devis_id = p_devis_id;
  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, nombre, prix_achat_retenu_cents)
  select v_org, p_devis_id, a.conditionnement_id, a.nombre, a.prix_achat_retenu_cents
  from jsonb_to_recordset(p_achats) as a(conditionnement_id uuid, nombre integer, prix_achat_retenu_cents bigint);
end;
$$;
revoke execute on function public.remplacer_achats_devis(uuid, jsonb) from public, anon;
grant execute on function public.remplacer_achats_devis(uuid, jsonb) to authenticated;

-- 5. Les PDF émis et les tracés de signature sont déposés par le SERVEUR
--    (clé service) : l'API n'y dépose plus rien directement.
drop policy hdecor_ajout on storage.objects;
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in ('photos', 'justificatifs', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));


-- =============================================================================
-- Migration 20261015000100_factures_phase5.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR (Phase 5) : factures.
--   1. Numéro prévisionnel d'une facture ou d'un avoir (porté par le PDF).
--   2. Émission avec numéro et date attendus : enveloppe d'emettre_facture
--      (SECURITY INVOKER) ; tout écart annule la transaction, compteur compris
--      (aucun trou), et le serveur régénère le PDF.
--   3. Modèles de messages : envoi de facture et relances d'impayés (3 niveaux,
--      délais après l'échéance modifiables dans les Paramètres).
--   4. Factures à relancer (tâche planifiée, rôle service).
--   5. Déplacement d'une ligne de facture brouillon (atomique).
-- =============================================================================

-- 1. Numéro prévisionnel ---------------------------------------------------------
create or replace function public.numero_facture_previsionnel(p_facture_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_f     public.factures%rowtype;
  v_date  date := public.aujourd_hui_paris();
  v_annee integer := extract(year from v_date)::integer;
  v_type  text;
  v_n     integer;
begin
  select * into v_f from public.factures where id = p_facture_id;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;
  v_type := case when v_f.type = 'avoir' then 'AVO' else 'FAC' end;
  select dernier + 1 into v_n from public.sequences_documents
  where organisation_id = v_f.organisation_id and type = v_type and annee = v_annee;
  return jsonb_build_object('numero', v_type || '-' || v_annee || '-' || lpad(coalesce(v_n, 1)::text, 4, '0'),
                            'date_emission', v_date,
                            'date_echeance', v_date + v_f.delai_paiement_jours);
end;
$$;
revoke execute on function public.numero_facture_previsionnel(uuid) from public, anon;
grant execute on function public.numero_facture_previsionnel(uuid) to authenticated;

-- 2. Émission avec numéro et date attendus -------------------------------------------
-- emettre_facture (SECURITY DEFINER) garde tous ses contrôles ; cette enveloppe
-- vérifie ensuite que le numéro et la date attribués sont ceux du PDF.
create or replace function public.emettre_facture_attendue(
  p_facture_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text,
  p_numero_attendu text,
  p_date_attendue date)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_numero text;
  v_date   date;
begin
  v_numero := public.emettre_facture(p_facture_id, p_copie_emetteur, p_copie_client, p_copie_chantier,
                                     p_pdf_chemin, p_pdf_sha256);
  select date_emission into v_date from public.factures where id = p_facture_id;
  if v_numero is distinct from p_numero_attendu or v_date is distinct from p_date_attendue then
    raise exception 'Numéro ou date changés pendant l''émission : %, %.', v_numero, v_date using errcode = 'HD001';
  end if;
  return v_numero;
end;
$$;
revoke execute on function public.emettre_facture_attendue(uuid, jsonb, jsonb, jsonb, text, text, text, date) from public, anon;
grant execute on function public.emettre_facture_attendue(uuid, jsonb, jsonb, jsonb, text, text, text, date) to authenticated;

-- 3. Modèles de messages -------------------------------------------------------------
-- Champs remplacés à l'envoi : {client}, {entreprise}, {numero}, {lien},
-- {montant}, {echeance}. Délais des relances : jours APRÈS l'échéance
-- (valeurs de départ, modifiables). Textes neutres et modifiables.
create or replace function public.initialiser_messages(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values
    (p_organisation_id, 'envoi_devis', 'Votre devis {numero}',
     E'Bonjour {client},\n\nVous trouverez votre devis {numero} en suivant ce lien : {lien}\nVous pouvez le consulter, le télécharger et le signer en ligne. Il est valable jusqu''au {valide_jusqu_au}.\n\nCordialement,\n{entreprise}', null),
    (p_organisation_id, 'relance_devis', 'Votre devis {numero}',
     E'Bonjour {client},\n\nJe me permets de revenir vers vous au sujet du devis {numero}, valable jusqu''au {valide_jusqu_au}. Vous pouvez le consulter et le signer ici : {lien}\nJe reste à votre disposition pour toute question.\n\nCordialement,\n{entreprise}', 7),
    (p_organisation_id, 'envoi_facture', 'Votre facture {numero}',
     E'Bonjour {client},\n\nVous trouverez votre facture {numero} d''un montant de {montant}, à régler au plus tard le {echeance}, en suivant ce lien : {lien}\nLes coordonnées bancaires figurent sur la facture.\n\nCordialement,\n{entreprise}', null),
    (p_organisation_id, 'impaye_1', 'Rappel : facture {numero}',
     E'Bonjour {client},\n\nSauf erreur de notre part, la facture {numero} arrivée à échéance le {echeance} reste à régler : {montant}. Vous pouvez la consulter ici : {lien}\nSi le paiement est en cours, merci de ne pas tenir compte de ce message.\n\nCordialement,\n{entreprise}', 7),
    (p_organisation_id, 'impaye_2', 'Deuxième rappel : facture {numero}',
     E'Bonjour {client},\n\nMalgré notre précédent rappel, la facture {numero} (échéance du {echeance}) reste impayée : {montant}. Merci de procéder au règlement dès réception de ce message. La facture : {lien}\nLes conditions de retard indiquées sur la facture s''appliquent.\n\nCordialement,\n{entreprise}', 15),
    (p_organisation_id, 'impaye_3', 'Dernier rappel avant recouvrement : facture {numero}',
     E'Bonjour {client},\n\nLa facture {numero} (échéance du {echeance}) reste impayée malgré nos rappels : {montant}. Sans règlement de votre part sous huit jours, nous serons contraints d''engager une procédure de recouvrement. La facture : {lien}\n\nCordialement,\n{entreprise}', 30)
  on conflict (organisation_id, code) do nothing;
$$;
revoke execute on function public.initialiser_messages(uuid) from public, anon, authenticated;
select public.initialiser_messages(id) from public.organisations;

-- 4. Factures à relancer -----------------------------------------------------------
-- Facture émise (pas un avoir), ENVOYÉE (relance seulement après un envoi
-- réel), échue, avec un reste à payer, client avec email et non anonymisé.
-- Niveau proposé : le premier niveau actif non encore envoyé, dont le délai
-- après l'échéance est atteint et dont chaque niveau précédent actif a été
-- ENVOYÉ (statut envoyé, pas seulement réservé) depuis au moins l'écart entre
-- leurs délais (1 jour au moins) : une facture découverte très en retard ne
-- reçoit pas les trois rappels en trois jours. Un seul niveau par passage.
create or replace function public.factures_a_relancer()
returns table (organisation_id uuid, facture_id uuid, numero text, email text, client text, entreprise text,
               reste_cents bigint, date_echeance date, niveau integer, code text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.organisation_id, f.id, f.numero, c.email,
         coalesce(f.copie_client ->> 'nom_affiche', c.nom), coalesce(p.raison_sociale, ''),
         s.reste_a_payer_cents, f.date_echeance, n.niveau, n.code
  from public.factures f
  join public.parametres_entreprise p on p.organisation_id = f.organisation_id
  join public.clients c on c.id = f.client_id and c.organisation_id = f.organisation_id
  cross join lateral public.solde_facture(f.id) s
  cross join lateral (
    select m.niveau, m.code from (
      select mm.code, substring(mm.code from 8)::integer as niveau, mm.delai_jours, mm.actif
      from public.modeles_messages mm
      where mm.organisation_id = f.organisation_id and mm.code in ('impaye_1', 'impaye_2', 'impaye_3')
    ) m
    where m.actif and m.delai_jours is not null
      and f.date_echeance + m.delai_jours <= public.aujourd_hui_paris()
      and not exists (select 1 from public.envois e
                      where e.document_type = 'facture' and e.document_id = f.id and e.nature = m.code and e.statut <> 'echec')
      and not exists (select 1 from public.modeles_messages prec
                      where prec.organisation_id = f.organisation_id and prec.actif
                        and prec.code in ('impaye_1', 'impaye_2', 'impaye_3')
                        and substring(prec.code from 8)::integer < m.niveau
                        and not exists (select 1 from public.envois e2
                                        where e2.document_type = 'facture' and e2.document_id = f.id
                                          and e2.nature = prec.code and e2.statut = 'envoye'
                                          and (e2.envoye_le at time zone 'Europe/Paris')::date
                                              <= public.aujourd_hui_paris() - greatest(m.delai_jours - coalesce(prec.delai_jours, 0), 1)))
    order by m.niveau
    limit 1
  ) n
  where f.statut = 'emise' and f.type <> 'avoir'
    and f.envoyee_le is not null
    and s.reste_a_payer_cents > 0
    and c.email is not null and c.anonymise_le is null;
$$;
revoke execute on function public.factures_a_relancer() from public, anon, authenticated;
grant execute on function public.factures_a_relancer() to service_role;

-- 5. Déplacement d'une ligne de facture brouillon --------------------------------------
create or replace function public.deplacer_ligne_facture(p_ligne_id uuid, p_sens integer)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ligne  public.facture_lignes%rowtype;
  v_voisin public.facture_lignes%rowtype;
begin
  if p_sens not in (-1, 1) then
    raise exception 'Sens invalide.' using errcode = 'P0001';
  end if;
  select * into v_ligne from public.facture_lignes where id = p_ligne_id for update;
  if not found then
    raise exception 'Ligne introuvable.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.factures where id = v_ligne.facture_id and statut <> 'brouillon') then
    raise exception 'Les lignes d''une facture émise sont figées.' using errcode = 'P0001';
  end if;
  select * into v_voisin from public.facture_lignes
  where facture_id = v_ligne.facture_id
    and case when p_sens < 0 then ordre < v_ligne.ordre else ordre > v_ligne.ordre end
  order by case when p_sens < 0 then -ordre else ordre end
  limit 1
  for update;
  if not found then
    return;
  end if;
  update public.facture_lignes set ordre = -1 - v_ligne.ordre where id = v_ligne.id;
  update public.facture_lignes set ordre = v_ligne.ordre where id = v_voisin.id;
  update public.facture_lignes set ordre = v_voisin.ordre where id = v_ligne.id;
end;
$$;
revoke execute on function public.deplacer_ligne_facture(uuid, integer) from public, anon;
grant execute on function public.deplacer_ligne_facture(uuid, integer) to authenticated;

-- 6. Données Factur-X : chemin du XML fixé UNE fois après l'émission (le trigger
--    de protection refuse tout changement ultérieur). Fichier de l'organisation.
create or replace function public.enregistrer_facturx(p_facture_id uuid, p_chemin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f public.factures%rowtype;
begin
  select * into v_f from public.factures where id = p_facture_id for update;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;
  if v_f.statut = 'brouillon' then
    raise exception 'Facture non émise.' using errcode = 'P0001';
  end if;
  -- Chemin imposé : dossier de CETTE facture, empreinte SHA-256 du XML dans le nom (vérifiée à la lecture).
  if p_chemin is null or p_chemin !~ ('^' || v_f.organisation_id::text || '/factures/' || v_f.id::text || '/facturx-[0-9a-f]{64}\.xml$') then
    raise exception 'Chemin de fichier invalide.' using errcode = 'P0001';
  end if;
  if v_f.facturx_chemin is not null then
    return;   -- déjà fixé : rien à faire (idempotent)
  end if;
  update public.factures set facturx_chemin = p_chemin where id = p_facture_id;
end;
$$;
revoke execute on function public.enregistrer_facturx(uuid, text) from public, anon;
grant execute on function public.enregistrer_facturx(uuid, text) to authenticated;

-- 7. Paiements : identifiant fixé par le formulaire (un nouvel essai après une
--    réponse perdue ne crée pas un second paiement).
grant insert (id) on public.paiements to authenticated;

-- 8. Envois RÉSERVÉS avant l'email (statut « en_cours ») : deux requêtes
--    simultanées (rejeu réseau, double passage de la tâche planifiée)
--    n'envoient jamais deux fois le même email.
--    * envoi manuel : identifiant fixé par le formulaire (clé primaire) ;
--    * relances : au plus une relance non échouée par document et par niveau.
--    Seule la conclusion d'un envoi en cours est modifiable (statut, identifiant
--    du prestataire, erreur) ; l'historique reste en ajout seul.
alter table public.envois drop constraint envois_statut_check;
alter table public.envois add constraint envois_statut_check check (statut in ('en_cours', 'envoye', 'echec'));
create unique index envois_relance_unique on public.envois (document_type, document_id, nature)
  where nature in ('relance_devis', 'impaye_1', 'impaye_2', 'impaye_3') and statut <> 'echec';
grant update (statut, fournisseur_id, erreur) on public.envois to authenticated;
create policy envois_conclusion on public.envois
  for update to authenticated
  using (public.est_membre(organisation_id) and statut = 'en_cours')
  with check (public.est_membre(organisation_id) and statut in ('envoye', 'echec'));

-- 9. Paiements par carte (Stripe, facultatif) : un même paiement (payment_intent)
--    n'est enregistré qu'une fois ; un paiement ENCAISSÉ par Stripe mais refusé
--    par la base (facture soldée, annulée…) est consigné pour être vu et
--    remboursé, jamais seulement journalisé.
create unique index paiements_stripe_reference_unique on public.paiements (organisation_id, reference)
  where mode = 'stripe';

create table public.incidents_paiement (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  facture_id          uuid not null,
  stripe_evenement_id text not null unique,
  reference           text,
  montant_cents       bigint not null check (montant_cents > 0),
  motif               text not null,
  traite_le           timestamptz,
  created_at          timestamptz not null default now(),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict
);
create index incidents_paiement_facture_idx on public.incidents_paiement (organisation_id, facture_id);
alter table public.incidents_paiement enable row level security;
create policy incidents_paiement_lecture on public.incidents_paiement
  for select to authenticated using (public.est_membre(organisation_id));
-- Seul le traitement se marque (remboursé dans Stripe) ; l'écriture vient du webhook (rôle service).
create policy incidents_paiement_traitement on public.incidents_paiement
  for update to authenticated using (public.est_membre(organisation_id) and traite_le is null)
  with check (public.est_membre(organisation_id));
revoke all on public.incidents_paiement from anon, authenticated;
grant select on public.incidents_paiement to authenticated;
grant update (traite_le) on public.incidents_paiement to authenticated;
grant select, insert on public.incidents_paiement to service_role;



-- =============================================================================
-- Migration 20261016000100_pilotage_phase6.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR, Phase 6 : pilotage (tableau de bord, planning, comptabilité simplifiée).
--   1. Justificatifs comptables : déposés par le SERVEUR seulement (type
--      vérifié sur le contenu), jamais remplacés ni supprimés depuis le navigateur.
--   2. Registre des achats : date de création, catégories par défaut.
--   3. Matériel : date de création, rattachement contrôlé.
--   4. Planning : un événement « chantier » porte son chantier.
--   5. Livre des recettes : net HT / TTC de la facture (part HT d'un
--      encaissement pour une entreprise soumise à la TVA).
-- =============================================================================

-- 1. Justificatifs -----------------------------------------------------------------
drop policy hdecor_ajout on storage.objects;
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in ('photos', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_maj on storage.objects;
create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_suppr on storage.objects;
create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id in ('photos', 'marque') and public.est_membre(public.organisation_du_chemin(name)));

-- Chemin d'un justificatif : dossier de SA dépense.
alter table public.depenses add constraint justificatif_chemin_depense check (
  justificatif_chemin is null
  or justificatif_chemin ~ ('^' || organisation_id::text || '/depenses/' || id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'));

-- 2. Registre des achats -----------------------------------------------------------
alter table public.depenses add column updated_at timestamptz not null default now();
create trigger depenses_updated_at before update on public.depenses
  for each row execute function public.maj_updated_at();
-- Rentabilité par chantier (achats du chantier) et clé étrangère vers chantiers.
create index depenses_chantier_idx on public.depenses (organisation_id, chantier_id) where chantier_id is not null;

-- Catégories par défaut (modifiables), créées une fois pour l'organisation de la session.
create or replace function public.initialiser_categories_depenses()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.membres where user_id = auth.uid() limit 1);
begin
  if v_org is null then
    raise exception 'Organisation introuvable.' using errcode = 'P0002';
  end if;
  insert into public.categories_depenses (organisation_id, libelle)
  select v_org, l from unnest(array['Peintures et enduits', 'Petit matériel et consommables', 'Outillage',
                                    'Carburant et déplacements', 'Assurances', 'Téléphone et internet', 'Autres']) l
  where not exists (select 1 from public.categories_depenses c where c.organisation_id = v_org)
  on conflict (organisation_id, libelle) do nothing;
end;
$$;
revoke execute on function public.initialiser_categories_depenses() from public, anon;
grant execute on function public.initialiser_categories_depenses() to authenticated;

-- 3. Matériel ----------------------------------------------------------------------
alter table public.materiel add column created_at timestamptz not null default now();
alter table public.materiel add constraint materiel_libelle_non_vide check (btrim(libelle) <> '');

-- 4. Planning ----------------------------------------------------------------------
alter table public.evenements add constraint evenement_chantier_porte_son_chantier
  check (type <> 'chantier' or chantier_id is not null);
alter table public.evenements add constraint evenement_titre_non_vide check (btrim(titre) <> '');
-- Un événement ne s'étend pas sur plus d'un an (saisie erronée).
alter table public.evenements add constraint evenement_duree_raisonnable check (fin <= debut + interval '366 days');
create index rappels_org_echeance_idx on public.rappels (organisation_id, statut, echeance);

-- 5. Livre des recettes ------------------------------------------------------------
-- Colonnes ajoutées en fin de vue : net de la facture (TTC et HT, acomptes
-- déduits), régime, et part HT de l'encaissement (assujetti ; À VÉRIFIER avec le comptable).
create or replace view public.v_livre_recettes with (security_invoker = true) as
select p.organisation_id, p.date_paiement,
       case when f.type = 'avoir' then -p.montant_cents else p.montant_cents end as montant_cents,
       case when f.type = 'avoir' then 'remboursement' else 'encaissement' end as nature,
       p.mode, p.reference,
       f.numero as facture_numero, f.id as facture_id,
       coalesce(f.copie_client ->> 'nom_affiche', '') as client,
       p.id as paiement_id,
       f.net_a_payer_cents as facture_net_ttc_cents,
       f.total_ht_cents - coalesce((select sum((d ->> 'ht')::bigint) from jsonb_array_elements(f.deductions) d), 0)::bigint
         as facture_net_ht_cents,
       f.regime_tva,
       f.chantier_id,
       e.part_ht_cents
from public.paiements p
join public.factures f on f.id = p.facture_id
cross join lateral (
  select case when f.type = 'avoir' then -p.montant_cents else p.montant_cents end as m,
         f.total_ht_cents - coalesce((select sum((d ->> 'ht')::bigint) from jsonb_array_elements(f.deductions) d), 0) as ht,
         f.net_a_payer_cents as ttc
) n
cross join lateral (
  -- Part HT en CUMULÉ (assujetti) : arrondi(cumul × HT/TTC) − arrondi(cumul précédent × HT/TTC).
  -- Les parts d'une facture totalisent exactement son HT net, quel que soit le nombre de paiements.
  select case when f.regime_tva = 'franchise' or n.ttc <= 0 then n.m
         else (round(c.cumul::numeric * n.ht / n.ttc) - round((c.cumul - n.m)::numeric * n.ht / n.ttc))::bigint end as part_ht_cents
  from (select sum(case when f2.type = 'avoir' then -p2.montant_cents else p2.montant_cents end) as cumul
        from public.paiements p2 join public.factures f2 on f2.id = p2.facture_id
        where p2.facture_id = p.facture_id
          and (p2.date_paiement, p2.created_at, p2.id) <= (p.date_paiement, p.created_at, p.id)) c
) e;


-- =============================================================================
-- Migration 20261017000100_documents_phase7.sql
-- =============================================================================

-- =============================================================================
-- H'DECOR, Phase 7 : documents et finitions.
--   1. Photos et documents de chantier : déposés par le SERVEUR seulement
--      (contenu vérifié), chemin rangé dans le dossier du chantier ;
--      galerie avant / après ; accord du client pour la diffusion.
--   2. Liste de fin de chantier : modèle paramétrable, cases datées.
--   3. PV de réception : brouillon modifiable, PDF présenté puis signé sur
--      place (client) avec empreinte ; figé une fois signé, seule la levée
--      des réserves (datée) reste possible.
--   4. Demande d'avis : une par facture, opposition du client respectée.
--   5. Notifications : centre de notifications (événements à distance,
--      rappels échus), envoi par email à Yorick s'il l'a choisi.
-- =============================================================================

-- 1. Photos et documents ------------------------------------------------------------
-- Dépôt par le serveur uniquement (comme les justificatifs) : plus d'écriture
-- directe dans l'espace « photos » depuis le navigateur.
drop policy hdecor_ajout on storage.objects;
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id = 'marque' and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_maj on storage.objects;
create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id = 'marque' and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id = 'marque' and public.est_membre(public.organisation_du_chemin(name)));
drop policy hdecor_suppr on storage.objects;
create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id = 'marque' and public.est_membre(public.organisation_du_chemin(name)));

alter table public.photos add column en_galerie boolean not null default false;
alter table public.photos add column largeur integer check (largeur is null or largeur between 1 and 20000);
alter table public.photos add column hauteur integer check (hauteur is null or hauteur between 1 and 20000);
alter table public.photos add constraint photo_chemin_rangee check (
  chemin ~ ('^' || organisation_id::text || '/chantiers/' || chantier_id::text || '/photos/[0-9a-f-]{36}\.(jpg|png|webp)$'));
alter table public.photos add constraint photo_legende_courte check (legende is null or length(legende) <= 300);
create index photos_chantier_idx on public.photos (organisation_id, chantier_id, moment);
grant update (en_galerie) on public.photos to authenticated;

alter table public.documents_chantier add constraint document_chemin_range check (
  chemin ~ ('^' || organisation_id::text || '/chantiers/' || chantier_id::text || '/documents/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'));
alter table public.documents_chantier add constraint document_nom_valide check (btrim(nom) <> '' and length(nom) <= 200);
create index documents_chantier_idx on public.documents_chantier (organisation_id, chantier_id);

-- Accord du client pour diffuser les photos (portfolio, réseaux sociaux), daté.
alter table public.chantiers add column accord_diffusion_photos_le timestamptz;

-- 2. Liste de fin de chantier -------------------------------------------------------
alter table public.parametres_entreprise add column liste_fin_chantier text[] not null default array[
  'Nettoyage du chantier', 'Retouches faites', 'Protections retirées', 'Déchets évacués', 'Photos après travaux', 'Clés rendues'];
alter table public.parametres_entreprise add constraint liste_fin_chantier_taille
  check (cardinality(liste_fin_chantier) <= 30);
-- items : [{ "libelle": texte, "fait_le": date ou null }]
alter table public.checklists_fin_chantier add constraint items_forme check (
  jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 50);
alter table public.checklists_fin_chantier add column updated_at timestamptz not null default now();
create trigger checklists_fin_chantier_updated_at before update on public.checklists_fin_chantier
  for each row execute function public.maj_updated_at();

-- 3. PV de réception ----------------------------------------------------------------
alter table public.pv_reception add column statut text not null default 'brouillon' check (statut in ('brouillon', 'signe'));
alter table public.pv_reception add column travaux text check (travaux is null or length(travaux) <= 2000);
alter table public.pv_reception add column observations text check (observations is null or length(observations) <= 4000);
alter table public.pv_reception add column delai_levee_jours integer check (delai_levee_jours is null or delai_levee_jours between 1 and 365);
alter table public.pv_reception add column devis_id uuid;
alter table public.pv_reception add constraint pv_devis_fk
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict;
-- Tracé de l'entreprise (Yorick) : déposé avec celui du client, dans l'espace « signatures ».
alter table public.pv_reception add column signature_entreprise_chemin text;
alter table public.pv_reception add constraint signature_entreprise_chemin_org
  check (public.chemin_de_l_organisation(signature_entreprise_chemin, organisation_id));
alter table public.pv_reception add column updated_at timestamptz not null default now();
create trigger pv_reception_updated_at before update on public.pv_reception
  for each row execute function public.maj_updated_at();
-- reserves : [{ "description": texte, "levee_le": date ou null, "levee_note": texte ou null }]
alter table public.pv_reception add constraint reserves_forme check (
  jsonb_typeof(reserves) = 'array' and jsonb_array_length(reserves) <= 50);
alter table public.pv_reception add constraint reserves_coherentes check (avec_reserves = (jsonb_array_length(reserves) > 0));
alter table public.pv_reception add constraint pv_signe_complet check (
  statut = 'brouillon' or (signature_id is not null and pdf_sha256 is not null and signature_entreprise_chemin is not null));
create index pv_reception_chantier_idx on public.pv_reception (organisation_id, chantier_id);

/** Date AAAA-MM-JJ réelle (le 31/02 est refusé). */
create or replace function public.date_iso_valide(p text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p ~ '^\d{4}-\d{2}-\d{2}$' and to_char(p::date, 'YYYY-MM-DD') = p;
exception when others then
  return false;
end;
$$;
revoke execute on function public.date_iso_valide(text) from public, anon;
grant execute on function public.date_iso_valide(text) to authenticated, service_role;

/**
 * Forme d'une réserve : description obligatoire (1 à 500 caractères), levée
 * datée facultative. Aucune autre clé (rien d'arbitraire figé dans un PV).
 */
create or replace function public.reserves_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(
    jsonb_typeof(r) = 'object'
    and (r - array['description', 'levee_le', 'levee_note']) = '{}'::jsonb
    and jsonb_typeof(r -> 'description') = 'string'
    and length(btrim(r ->> 'description')) between 1 and 500
    and (r -> 'levee_le' is null or jsonb_typeof(r -> 'levee_le') = 'null'
         or (jsonb_typeof(r -> 'levee_le') = 'string' and public.date_iso_valide(r ->> 'levee_le')))
    and (r -> 'levee_note' is null or jsonb_typeof(r -> 'levee_note') = 'null'
         or (jsonb_typeof(r -> 'levee_note') = 'string' and length(r ->> 'levee_note') <= 500))
  ), true)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) r;
$$;
-- Fonction pure appelée par une contrainte CHECK : évaluée avec les droits de la session qui écrit.
revoke execute on function public.reserves_valides(jsonb) from public, anon;
grant execute on function public.reserves_valides(jsonb) to authenticated, service_role;
alter table public.pv_reception add constraint reserves_valides check (public.reserves_valides(reserves));

/**
 * Un PV signé est définitif. Seule la levée des réserves (date, note) peut
 * encore être renseignée, par lever_reserve. Le contenu d'un brouillon qui
 * change invalide le PDF présenté (il faut le représenter avant de signer).
 */
/** File de suppression d'un fichier devenu inutile (appelée par les déclencheurs ; jamais par une session). */
create or replace function public.mettre_en_file(p_org uuid, p_espace text, p_chemin text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin) values (p_org, p_espace, p_chemin);
$$;
revoke execute on function public.mettre_en_file(uuid, text, text) from public, anon, authenticated;

create or replace function public.proteger_pv()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contenu text[] := array['date_reception', 'avec_reserves', 'reserves', 'travaux', 'observations', 'delai_levee_jours', 'devis_id', 'chantier_id'];
begin
  if tg_op = 'DELETE' then
    if old.statut = 'signe' or old.signature_id is not null then
      raise exception 'Un PV signé ne peut pas être supprimé.' using errcode = 'P0001';
    end if;
    -- PDF présenté d'un brouillon supprimé (nom et adresse du client) : mis en file de suppression.
    if old.pdf_chemin is not null then perform public.mettre_en_file(old.organisation_id, 'documents', old.pdf_chemin); end if;
    return old;
  end if;
  -- La signature rattachée est celle de CE PV (même hors API).
  if new.signature_id is not null and (tg_op = 'INSERT' or new.signature_id is distinct from old.signature_id) and not exists (
       select 1 from public.signatures s
       where s.id = new.signature_id and s.organisation_id = new.organisation_id
         and s.document_type = 'pv_reception' and s.document_id = new.id) then
    raise exception 'Cette signature ne correspond pas à ce document.' using errcode = 'P0001';
  end if;
  -- Devis rattaché : un devis ACCEPTÉ de ce chantier (jamais un brouillon qui bloquerait l'effacement du client).
  if new.devis_id is not null and (tg_op = 'INSERT' or new.devis_id is distinct from old.devis_id) and not exists (
       select 1 from public.devis d where d.id = new.devis_id and d.chantier_id = new.chantier_id and d.statut = 'accepte') then
    raise exception 'Le devis rattaché doit être un devis signé de ce chantier.' using errcode = 'P0001';
  end if;
  -- Avant signature, aucune levée : une réserve ne se lève qu'après la réception, par lever_reserve.
  if (tg_op = 'INSERT' or not (old.statut = 'signe' or old.signature_id is not null))
     and exists (select 1 from jsonb_array_elements(new.reserves) r
                 where r ->> 'levee_le' is not null or r ->> 'levee_note' is not null) then
    raise exception 'Une réserve ne peut être levée qu''après la signature du PV.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if new.statut <> 'brouillon' or new.signature_id is not null then
      raise exception 'Un PV se crée en brouillon.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.statut = 'signe' or old.signature_id is not null then
    -- PV signé : seule lever_reserve (qui pose le verrou de transaction « hdecor.levee ») peut écrire une levée.
    if (to_jsonb(new) - array['reserves', 'updated_at']) is distinct from (to_jsonb(old) - array['reserves', 'updated_at'])
       or (new.reserves is distinct from old.reserves and coalesce(current_setting('hdecor.levee', true), '') <> 'on')
       or jsonb_array_length(new.reserves) <> jsonb_array_length(old.reserves)
       or exists (select 1 from jsonb_array_elements(new.reserves) with ordinality n(r, i)
                  join jsonb_array_elements(old.reserves) with ordinality o(r, i) using (i)
                  where n.r ->> 'description' is distinct from o.r ->> 'description'
                     or (o.r ->> 'levee_le') is not null and n.r is distinct from o.r) then
      raise exception 'Ce PV est signé : seule la levée d''une réserve peut encore être notée.' using errcode = 'P0001';
    end if;
    -- Levée nouvelle : datée, entre la réception et aujourd'hui (contrôle refait ici, quel que soit le chemin d'écriture).
    if exists (select 1 from jsonb_array_elements(new.reserves) with ordinality n(r, i)
               join jsonb_array_elements(old.reserves) with ordinality o(r, i) using (i)
               where n.r is distinct from o.r
                 and case when coalesce(public.date_iso_valide(n.r ->> 'levee_le'), false)
                          then (n.r ->> 'levee_le')::date not between new.date_reception and public.aujourd_hui_paris()
                          else true end) then
      raise exception 'Date de levée invalide : entre la réception et aujourd''hui.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Brouillon : un changement de contenu efface le PDF présenté (fichier mis en file de suppression).
  if new.statut = 'brouillon' and (select bool_or((to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)) from unnest(v_contenu) c)
     and new.pdf_sha256 is not distinct from old.pdf_sha256 then
    if old.pdf_chemin is not null then perform public.mettre_en_file(old.organisation_id, 'documents', old.pdf_chemin); end if;
    new.pdf_chemin := null;
    new.pdf_sha256 := null;
  end if;
  return new;
end;
$$;
-- Remplace la protection générique de la Phase 1 (qui interdisait aussi la levée des réserves).
drop trigger pv_reception_signe on public.pv_reception;
create trigger pv_reception_protection before insert or update or delete on public.pv_reception
  for each row execute function public.proteger_pv();

-- Le statut, la signature et le PDF ne s'écrivent que par les fonctions ci-dessous.
revoke update on public.pv_reception from authenticated;
grant update (date_reception, avec_reserves, reserves, travaux, observations, delai_levee_jours, devis_id) on public.pv_reception to authenticated;
revoke insert on public.pv_reception from authenticated;
grant insert (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves, travaux, observations, delai_levee_jours, devis_id)
  on public.pv_reception to authenticated;

/** PDF du brouillon présenté au client (déposé par le serveur) : chemin et empreinte. */
create or replace function public.presenter_pv(p_pv_id uuid, p_pdf_chemin text, p_pdf_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception 'PV introuvable.' using errcode = 'P0002';
  end if;
  if v_pv.statut <> 'brouillon' then
    raise exception 'Ce PV est déjà signé.' using errcode = 'P0001';
  end if;
  if p_pdf_chemin !~ ('^' || v_pv.organisation_id::text || '/pv/' || v_pv.id::text || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'Chemin du PDF invalide.' using errcode = 'P0001';
  end if;
  update public.pv_reception set pdf_chemin = p_pdf_chemin, pdf_sha256 = p_pdf_sha256 where id = p_pv_id;
end;
$$;
revoke execute on function public.presenter_pv(uuid, text, text) from public, anon;
grant execute on function public.presenter_pv(uuid, text, text) to authenticated;

/**
 * Signature sur place : le client signe le PDF présenté (même empreinte :
 * rien n'a changé depuis), l'entreprise aussi (tracé). Le PV devient définitif.
 */
create or replace function public.signer_pv_sur_place(
  p_pv_id uuid, p_nom text, p_mention text, p_image_chemin text, p_image_entreprise_chemin text,
  p_document_sha256 text, p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv  public.pv_reception%rowtype;
  v_sig uuid;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception 'PV introuvable.' using errcode = 'P0002';
  end if;
  if v_pv.statut <> 'brouillon' then
    raise exception 'Ce PV est déjà signé.' using errcode = 'P0001';
  end if;
  if v_pv.date_reception > public.aujourd_hui_paris() then
    raise exception 'La date de réception est future : la réception se prononce le jour même ou après coup.' using errcode = 'P0001';
  end if;
  if v_pv.pdf_sha256 is null or v_pv.pdf_sha256 <> p_document_sha256 then
    raise exception 'Le PV a changé depuis sa présentation : présentez-le à nouveau avant de signer.' using errcode = 'P0001';
  end if;
  if p_image_chemin !~ ('^' || v_pv.organisation_id::text || '/pv/' || v_pv.id::text || '/[0-9a-f-]{36}\.png$')
     or p_image_entreprise_chemin !~ ('^' || v_pv.organisation_id::text || '/pv/' || v_pv.id::text || '/[0-9a-f-]{36}\.png$')
     or p_image_chemin = p_image_entreprise_chemin then
    raise exception 'Tracés de signature invalides.' using errcode = 'P0001';
  end if;
  insert into public.signatures (organisation_id, document_type, document_id, methode, signataire_nom,
    mention, image_chemin, document_sha256, ip, user_agent)
  values (v_pv.organisation_id, 'pv_reception', p_pv_id, 'sur_place', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_ip, p_user_agent)
  returning id into v_sig;
  update public.pv_reception set statut = 'signe', signature_id = v_sig, signature_entreprise_chemin = p_image_entreprise_chemin
  where id = p_pv_id;
  return v_sig;
end;
$$;
revoke execute on function public.signer_pv_sur_place(uuid, text, text, text, text, text, inet, text) from public, anon;
grant execute on function public.signer_pv_sur_place(uuid, text, text, text, text, text, inet, text) to authenticated;

/** Levée d'une réserve d'un PV signé (rang à partir de 0) : date et note, une seule fois. */
create or replace function public.lever_reserve(p_pv_id uuid, p_rang integer, p_date date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception 'PV introuvable.' using errcode = 'P0002';
  end if;
  if v_pv.statut <> 'signe' then
    raise exception 'Les réserves se lèvent sur un PV signé.' using errcode = 'P0001';
  end if;
  if p_rang < 0 or p_rang >= jsonb_array_length(v_pv.reserves) then
    raise exception 'Réserve introuvable.' using errcode = 'P0002';
  end if;
  if (v_pv.reserves -> p_rang ->> 'levee_le') is not null then
    raise exception 'Cette réserve est déjà levée.' using errcode = 'P0001';
  end if;
  if p_date < v_pv.date_reception or p_date > public.aujourd_hui_paris() then
    raise exception 'Date de levée : entre la réception et aujourd''hui.' using errcode = 'P0001';
  end if;
  perform set_config('hdecor.levee', 'on', true);
  update public.pv_reception
  set reserves = jsonb_set(reserves, array[p_rang::text],
        (reserves -> p_rang) || jsonb_build_object('levee_le', p_date, 'levee_note', nullif(btrim(coalesce(p_note, '')), '')))
  where id = p_pv_id;
  perform set_config('hdecor.levee', 'off', true);
end;
$$;
revoke execute on function public.lever_reserve(uuid, integer, date, text) from public, anon;
grant execute on function public.lever_reserve(uuid, integer, date, text) to authenticated;

-- PDF d'un PV signé : protégé de la file de suppression (comme les documents émis).
create or replace function public.fichier_protege(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.factures f where p_chemin in (f.pdf_chemin, f.facturx_chemin))
      or exists (select 1 from public.devis d where d.pdf_chemin = p_chemin and d.statut = 'accepte')
      or exists (select 1 from public.signatures s where p_chemin in (s.image_chemin, s.pdf_signe_chemin))
      or exists (select 1 from public.pv_reception p where (p.statut = 'signe' or p.signature_id is not null)
                 and p_chemin in (p.pdf_chemin, p.signature_entreprise_chemin))
      or exists (select 1 from public.attestations_tva a where a.pdf_chemin = p_chemin and a.signature_id is not null);
$$;

-- 4. Demande d'avis -------------------------------------------------------------------
-- Opposition du client aux sollicitations (demande d'avis), datée.
alter table public.clients add column refus_sollicitations_le timestamptz;
-- Une seule demande d'avis par facture (hors échec d'envoi).
create unique index envois_demande_avis_unique on public.envois (document_id)
  where nature = 'demande_avis' and statut <> 'echec';
-- Lien de la page d'avis : une adresse https.
alter table public.parametres_entreprise add constraint avis_google_url_https
  check (avis_google_url is null or avis_google_url ~ '^https://[^\s]+$');

-- 5. Notifications --------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in ('devis_consulte', 'devis_signe', 'paiement_en_ligne', 'rappel')),
  titre             text not null check (length(titre) between 1 and 300),
  lien              text not null check (lien ~ '^/[a-z0-9/_-]*$'),
  cle               text not null,                     -- dédoublonnage (un événement, une notification)
  cree_le           timestamptz not null default now(),
  lu_le             timestamptz,
  emailee_le        timestamptz,
  unique (organisation_id, cle)
);
create index notifications_org_idx on public.notifications (organisation_id, cree_le desc);
create index notifications_a_emailer_idx on public.notifications (emailee_le) where emailee_le is null;
alter table public.notifications enable row level security;
create policy membre_lecture on public.notifications for select to authenticated using (public.est_membre(organisation_id));
create policy membre_maj on public.notifications for update to authenticated
  using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id));
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (lu_le) on public.notifications to authenticated;

alter table public.parametres_entreprise add column notifier_par_email boolean not null default false;
-- Rappel échu déjà signalé (notification créée) : jamais deux fois.
alter table public.rappels add column notifie_le timestamptz;

create or replace function public.notifier(p_org uuid, p_type text, p_titre text, p_lien text, p_cle text)
returns void
language sql
security definer
set search_path = ''
as $$
  -- Titre sur une ligne : aucun caractère de contrôle (pas de fausse ligne dans l'email récapitulatif).
  insert into public.notifications (organisation_id, type, titre, lien, cle)
  values (p_org, p_type, left(regexp_replace(p_titre, '[[:cntrl:]]+', ' ', 'g'), 300), p_lien, p_cle)
  on conflict (organisation_id, cle) do nothing;
$$;
revoke execute on function public.notifier(uuid, text, text, text, text) from public, anon, authenticated;

-- Devis signé PAR LIEN (à distance) ; sur place, Yorick est présent.
create or replace function public.notifier_signature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero text;
begin
  if new.document_type = 'devis' and new.methode = 'lien' then
    select numero into v_numero from public.devis where id = new.document_id;
    perform public.notifier(new.organisation_id, 'devis_signe',
      format('Devis %s signé à distance', coalesce(v_numero, '')),
      '/devis/' || new.document_id, 'signature:' || new.id);
  end if;
  return new;
end;
$$;
create trigger signatures_notification after insert on public.signatures
  for each row execute function public.notifier_signature();

-- Premier ouverture du devis par le client.
create or replace function public.notifier_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.consulte_le is null and new.consulte_le is not null then
    perform public.notifier(new.organisation_id, 'devis_consulte',
      format('Devis %s ouvert par le client', coalesce(new.numero, '')), '/devis/' || new.id, 'consultation:' || new.id);
  end if;
  return new;
end;
$$;
create trigger devis_notification_consultation after update of consulte_le on public.devis
  for each row execute function public.notifier_consultation();

-- Paiement en ligne (Stripe) enregistré.
create or replace function public.notifier_paiement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero text;
begin
  if new.stripe_evenement_id is not null and new.montant_cents > 0 then
    select numero into v_numero from public.factures where id = new.facture_id;
    perform public.notifier(new.organisation_id, 'paiement_en_ligne',
      format('Paiement en ligne reçu : %s € sur la facture %s',
        -- Format français : espace fine insécable entre les milliers, virgule décimale.
        regexp_replace((new.montant_cents / 100)::text, '(\d)(?=(\d{3})+$)', E'\\1\u202F', 'g')
          || ',' || lpad((new.montant_cents % 100)::text, 2, '0'), coalesce(v_numero, '')),
      '/factures/' || new.facture_id, 'paiement:' || new.id);
  end if;
  return new;
end;
$$;
create trigger paiements_notification after insert on public.paiements
  for each row execute function public.notifier_paiement();

/**
 * Rappels échus : une notification chacun (tâche planifiée, clé de service).
 * Renvoie le nombre de rappels signalés.
 */
create or replace function public.notifier_rappels_echus()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with echus as (
    update public.rappels set notifie_le = now()
    where statut = 'a_envoyer' and notifie_le is null and echeance <= now()
    returning id, organisation_id, titre, chantier_id
  )
  insert into public.notifications (organisation_id, type, titre, lien, cle)
  select organisation_id, 'rappel', left(regexp_replace('Rappel : ' || titre, '[[:cntrl:]]+', ' ', 'g'), 300),
         case when chantier_id is null then '/planning' else '/chantiers/' || chantier_id end, 'rappel:' || id
  from echus
  on conflict (organisation_id, cle) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.notifier_rappels_echus() from public, anon, authenticated;
grant execute on function public.notifier_rappels_echus() to service_role;

/**
 * Archive du PV signé (PDF portant les deux signatures) : une seule fois, pour
 * un PV signé de l'organisation, dans le dossier du PV.
 */
create or replace function public.archiver_pv_signe(p_pv_id uuid, p_chemin text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception 'PV introuvable.' using errcode = 'P0002';
  end if;
  if v_pv.statut <> 'signe' then
    raise exception 'Ce PV n''est pas signé.' using errcode = 'P0001';
  end if;
  if p_chemin !~ ('^' || v_pv.organisation_id::text || '/pv/' || v_pv.id::text || '/[0-9a-f-]{36}\.pdf$') or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Archive invalide.' using errcode = 'P0001';
  end if;
  update public.signatures set pdf_signe_chemin = p_chemin, pdf_signe_sha256 = p_sha256
  where id = v_pv.signature_id and pdf_signe_sha256 is null;
  if not found then
    raise exception 'PV signé déjà archivé.' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function public.archiver_pv_signe(uuid, text, text) from public, anon;
grant execute on function public.archiver_pv_signe(uuid, text, text) to authenticated;

-- Modèle « demande d'avis » (modifiable dans Réglages > Messages), créé pour
-- chaque organisation. Message NEUTRE : tous les clients sont invités de la
-- même façon, sans condition de satisfaction (pas de tri des avis). Le client
-- peut s'opposer à ces messages (refus noté).
create or replace function public.initialiser_message_avis(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values (p_organisation_id, 'demande_avis', 'Votre avis sur nos travaux',
    E'Bonjour {client},\n\nMerci de nous avoir confié vos travaux. Votre avis, quel qu''il soit, nous intéresse et aide d''autres clients à choisir : {lien}\n\nVous ne souhaitez plus recevoir ce type de message ? Dites-le-nous simplement en réponse.\n\nCordialement,\n{entreprise}', null)
  on conflict (organisation_id, code) do nothing;
$$;
revoke execute on function public.initialiser_message_avis(uuid) from public, anon, authenticated;
create or replace function public.organisation_initialiser_message_avis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.initialiser_message_avis(new.id);
  return new;
end;
$$;
revoke execute on function public.organisation_initialiser_message_avis() from public, anon, authenticated;
create trigger organisations_initialiser_message_avis after insert on public.organisations
  for each row execute function public.organisation_initialiser_message_avis();
select public.initialiser_message_avis(id) from public.organisations;

-- RGPD : à l'anonymisation d'un client, ses notifications (titres pouvant
-- contenir un nom, un rappel ou un numéro de document) sont supprimées, quel
-- que soit le chemin d'effacement (demande du client ou purge automatique).
create or replace function public.purger_notifications_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymise_le is null and new.anonymise_le is not null then
    delete from public.notifications n
    where n.organisation_id = new.organisation_id
      and (n.lien in (select '/devis/' || d.id from public.devis d where d.client_id = new.id)
        or n.lien in (select '/factures/' || f.id from public.factures f where f.client_id = new.id)
        or n.lien in (select '/chantiers/' || c.id from public.chantiers c where c.client_id = new.id)
        or n.cle in (select 'rappel:' || r.id from public.rappels r
                     where r.chantier_id in (select c.id from public.chantiers c where c.client_id = new.id)
                        or r.evenement_id in (select e.id from public.evenements e
                                              where e.chantier_id in (select c.id from public.chantiers c where c.client_id = new.id))
                        or (r.document_type = 'devis' and r.document_id in (select d.id from public.devis d where d.client_id = new.id))
                        or (r.document_type = 'facture' and r.document_id in (select f.id from public.factures f where f.client_id = new.id))));
  end if;
  return new;
end;
$$;
revoke execute on function public.purger_notifications_client() from public, anon, authenticated;
create trigger clients_purger_notifications after update of anonymise_le on public.clients
  for each row execute function public.purger_notifications_client();

-- Historique des accords de diffusion des photos : chaque accord (texte accepté,
-- date) et son éventuel retrait restent tracés (preuve de l'accord au moment
-- d'une publication). Ni modifiable (hors date de retrait) ni supprimable par une session.
create table public.accords_diffusion_photos (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  texte             text not null check (length(texte) between 10 and 500),
  accorde_le        timestamptz not null default now(),
  retire_le         timestamptz,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  check (retire_le is null or retire_le >= accorde_le)
);
create index accords_diffusion_chantier_idx on public.accords_diffusion_photos (organisation_id, chantier_id);
select public.appliquer_rls_standard('public.accords_diffusion_photos');
revoke update, delete on public.accords_diffusion_photos from authenticated;
grant update (retire_le) on public.accords_diffusion_photos to authenticated;
create trigger accords_diffusion_audit after insert or update or delete on public.accords_diffusion_photos
  for each row execute function public.tracer_audit();

-- Notifications : conservées 90 jours (tâche de conservation), puis supprimées.
create or replace function public.purger_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.notifications where cree_le < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.purger_notifications() from public, anon, authenticated;
grant execute on function public.purger_notifications() to service_role;


-- =============================================================================
-- Migration 20261019000100_recette_phase8.sql
-- =============================================================================

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
  -- La ligne est créée par initialiser_organisation et jamais supprimée : ni insertion ni suppression par une session.
  execute 'revoke insert, update, delete on public.parametres_entreprise from authenticated';
  execute format('grant update (%s) on public.parametres_entreprise to authenticated', v_colonnes);
end $$;


-- =============================================================================
-- Historique des migrations (comme `supabase db push` 2.120.0)
-- =============================================================================

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
alter table supabase_migrations.schema_migrations add column if not exists statements text[];
alter table supabase_migrations.schema_migrations add column if not exists name text;

insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000100', 'socle', '{"-- =============================================================================
-- H''DECOR : socle
-- Organisations, membres, fonctions d''appartenance, journal d''audit,
-- numérotation atomique des documents.
--
-- Principes appliqués dans toutes les migrations :
--   * chaque table métier porte organisation_id et a la RLS activée ;
--   * les clés étrangères entre tables métier sont COMPOSITES
--     (organisation_id, id) : une ligne ne peut jamais référencer une ligne
--     d''une autre organisation, même si l''identifiant a fui (les contrôles de
--     clé étrangère ignorent la RLS) ;
--   * l''argent est en centimes (bigint), les taux en points de base
--     (2000 = 20 %, 550 = 5,5 %), les longueurs en millimètres (integer) ;
--   * les fonctions SECURITY DEFINER fixent search_path = '''' et qualifient
--     tous les objets.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions","-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------

create or replace function public.maj_updated_at()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$","-- Date du jour à Paris : la date d''émission d''un document est la date légale
-- française, pas la date UTC du serveur.
create or replace function public.aujourd_hui_paris()
returns date
language sql
stable
set search_path = ''''
as $$
  select (now() at time zone ''Europe/Paris'')::date;
$$","-- -----------------------------------------------------------------------------
-- Organisations et membres
-- Un seul utilisateur aujourd''hui (Yorick), mais le modèle est multi-entreprise.
-- Aucune inscription libre : l''organisation et le compte sont créés par un
-- script d''administration (clé de service, hors navigateur).
-- -----------------------------------------------------------------------------

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  nom         text not null check (length(nom) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
)","create table public.membres (
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  user_id         uuid not null references auth.users (id) on delete restrict,
  role            text not null default ''proprietaire'' check (role in (''proprietaire'')),
  created_at      timestamptz not null default now(),
  primary key (organisation_id, user_id)
)","create index membres_user_idx on public.membres (user_id)","-- Appartenance : SECURITY DEFINER pour ne pas dépendre de la RLS de membres
-- (évite la récursion), STABLE pour être évaluée une fois par requête.
create or replace function public.est_membre(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''''
as $$
  select exists (
    select 1
    from public.membres m
    where m.organisation_id = p_organisation_id
      and m.user_id = (select auth.uid())
  );
$$","alter table public.organisations enable row level security","alter table public.membres enable row level security","create policy organisations_lecture on public.organisations
  for select to authenticated using (public.est_membre(id))","create policy organisations_maj on public.organisations
  for update to authenticated using (public.est_membre(id)) with check (public.est_membre(id))","-- Un membre voit sa propre appartenance ; personne ne s''ajoute lui-même.
create policy membres_lecture on public.membres
  for select to authenticated using (user_id = (select auth.uid()))","create trigger organisations_updated_at before update on public.organisations
  for each row execute function public.maj_updated_at()","-- -----------------------------------------------------------------------------
-- Politique RLS standard : membre de l''organisation de la ligne.
-- Les tables à règles particulières (documents émis, journal, paiements)
-- reçoivent des politiques écrites à la main.
-- -----------------------------------------------------------------------------

create or replace function public.appliquer_rls_standard(p_table regclass)
returns void
language plpgsql
set search_path = ''''
as $$
begin
  execute format(''alter table %s enable row level security'', p_table);
  execute format(
    ''create policy membre_lecture on %s for select to authenticated using (public.est_membre(organisation_id))'',
    p_table);
  execute format(
    ''create policy membre_ajout on %s for insert to authenticated with check (public.est_membre(organisation_id))'',
    p_table);
  execute format(
    ''create policy membre_maj on %s for update to authenticated using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id))'',
    p_table);
  execute format(
    ''create policy membre_suppr on %s for delete to authenticated using (public.est_membre(organisation_id))'',
    p_table);
end;
$$","-- -----------------------------------------------------------------------------
-- Journal d''audit : qui, quoi, quand, avant / après.
-- Alimenté uniquement par trigger. Ni modifiable ni supprimable.
-- -----------------------------------------------------------------------------

create table public.journal_audit (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  user_id          uuid,             -- null : action système (cron, lien public)
  action           text not null check (action in (''INSERT'', ''UPDATE'', ''DELETE'')),
  table_nom        text not null,
  ligne_id         uuid,
  avant            jsonb,
  apres            jsonb,
  cree_le          timestamptz not null default now()
)","create index journal_audit_org_idx on public.journal_audit (organisation_id, cree_le desc)","create index journal_audit_ligne_idx on public.journal_audit (table_nom, ligne_id)","alter table public.journal_audit enable row level security","create policy journal_lecture on public.journal_audit
  for select to authenticated using (public.est_membre(organisation_id))","-- Aucune politique INSERT / UPDATE / DELETE : seul le trigger (definer) écrit.

create or replace function public.interdire_modification_journal()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  -- Seule exception : la purge de conservation, par purger_journal_audit()
  -- (rôle service), qui ne supprime que des entrées échues.
  -- Le plancher d''un an est imposé ICI, pas seulement dans la fonction.
  if tg_op = ''DELETE'' and current_setting(''hdecor.purge_journal'', true) = ''on''
     and current_user not in (''authenticated'', ''anon'')
     and old.cree_le < now() - interval ''1 year'' then
    return old;
  end if;
  raise exception ''Le journal d''''audit ne peut être ni modifié ni supprimé.''
    using errcode = ''P0001'';
end;
$$","create trigger journal_audit_immuable
  before update or delete on public.journal_audit
  for each row execute function public.interdire_modification_journal()","-- Minimisation RGPD : le journal ne garde que ce qui est sur LISTE BLANCHE
-- (identifiants, statuts, numéros, montants, taux, quantités, dates,
-- empreintes). Aucun texte libre, aucun nom, aucune adresse, aucune IP.
-- En UPDATE, seules les colonnes modifiées sont enregistrées.
create or replace function public.audit_sans_donnees_perso(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''''
as $$
  select coalesce(jsonb_object_agg(key, value), ''{}''::jsonb)
  from jsonb_each(p)
  where key in (''id'', ''organisation_id'', ''statut'', ''numero'', ''version'', ''type'', ''unite'', ''regime_tva'',
                ''mode'', ''ordre'', ''methode'', ''finalite'', ''document_type'', ''quantite_e4'', ''optionnelle'',
                ''autoliquidation'', ''hors_etablissement'', ''avec_reserves'', ''actif'', ''contenance'',
                ''ventilation_tva'', ''ventilation_acceptee'', ''options_acceptees'', ''minutes'')
     or key ~ ''(_id|_cents|_bp|_jours|_le|_sha256)$''
     or key ~ ''^date_'';
$$","create or replace function public.tracer_audit()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_ligne jsonb;
  v_avant jsonb;
  v_apres jsonb;
begin
  v_ligne := case when tg_op = ''DELETE'' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = ''UPDATE'' then
    select jsonb_object_agg(n.key, o.value), jsonb_object_agg(n.key, n.value)
      into v_avant, v_apres
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
    where n.value is distinct from o.value and n.key <> ''updated_at'';
    v_avant := public.audit_sans_donnees_perso(coalesce(v_avant, ''{}''::jsonb));
    v_apres := public.audit_sans_donnees_perso(coalesce(v_apres, ''{}''::jsonb));
  elsif tg_op = ''INSERT'' then
    v_apres := public.audit_sans_donnees_perso(to_jsonb(new));
  else
    v_avant := public.audit_sans_donnees_perso(to_jsonb(old));
  end if;
  insert into public.journal_audit (organisation_id, user_id, action, table_nom, ligne_id, avant, apres)
  values ((v_ligne ->> ''organisation_id'')::uuid, (select auth.uid()), tg_op, tg_table_name,
          (v_ligne ->> ''id'')::uuid, v_avant, v_apres);
  return null;
end;
$$","-- Purge de conservation : rôle service uniquement (cron). La durée est
-- passée par l''appelant depuis la configuration (À VÉRIFIER : durée retenue).
create or replace function public.purger_journal_audit(p_avant timestamptz)
returns bigint
language plpgsql
security definer
set search_path = ''''
as $$
declare
  n bigint;
begin
  if p_avant > now() - interval ''1 year'' then
    raise exception ''Purge refusée : date trop récente.'' using errcode = ''P0001'';
  end if;
  perform set_config(''hdecor.purge_journal'', ''on'', true);
  delete from public.journal_audit where cree_le < p_avant;
  get diagnostics n = row_count;
  perform set_config(''hdecor.purge_journal'', ''off'', true);
  return n;
end;
$$","-- -----------------------------------------------------------------------------
-- Numérotation : DEV-AAAA-0001, FAC-AAAA-0001, AVO-AAAA-0001.
-- Pas de SEQUENCE PostgreSQL : une séquence ne revient pas en arrière quand la
-- transaction échoue, ce qui crée des trous. Ici, le compteur est une ligne
-- verrouillée par l''UPDATE ; si la transaction d''émission échoue, le compteur
-- revient avec elle. Résultat : ni trou ni doublon, même en concurrence.
-- Le numéro n''est attribué qu''à l''émission (un brouillon n''a pas de numéro).
-- -----------------------------------------------------------------------------

create table public.sequences_documents (
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  type            text not null check (type in (''DEV'', ''FAC'', ''AVO'')),
  annee           integer not null check (annee between 2000 and 2999),
  dernier         integer not null check (dernier >= 0),
  primary key (organisation_id, type, annee)
)","alter table public.sequences_documents enable row level security","create policy sequences_lecture on public.sequences_documents
  for select to authenticated using (public.est_membre(organisation_id))","-- Écriture : uniquement via prochain_numero(), appelée par les fonctions d''émission.

create or replace function public.prochain_numero(p_organisation_id uuid, p_type text, p_annee integer)
returns text
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_n integer;
begin
  insert into public.sequences_documents as s (organisation_id, type, annee, dernier)
  values (p_organisation_id, p_type, p_annee, 1)
  on conflict (organisation_id, type, annee)
  do update set dernier = s.dernier + 1
  returning s.dernier into v_n;

  return p_type || ''-'' || p_annee::text || ''-'' || lpad(v_n::text, 4, ''0'');
end;
$$","-- prochain_numero n''est jamais appelable directement depuis l''API.
revoke execute on function public.prochain_numero(uuid, text, integer) from public, anon, authenticated","revoke execute on function public.appliquer_rls_standard(regclass) from public, anon, authenticated","-- -----------------------------------------------------------------------------
-- Formes strictes des JSON de montants : aucune clé libre (sinon du texte
-- arbitraire, éventuellement personnel, pourrait être figé dans un document
-- émis et dans le journal).
-- -----------------------------------------------------------------------------
create or replace function public.ventilation_bien_formee(p jsonb)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select jsonb_typeof(p) = ''array''
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> ''object''
          or (select array_agg(k order by k) from jsonb_object_keys(e) k)
             is distinct from array[''base_ht_cents'', ''taux_bp'', ''tva_cents'']
          or jsonb_typeof(e -> ''taux_bp'') <> ''number''
          or jsonb_typeof(e -> ''base_ht_cents'') <> ''number''
          or jsonb_typeof(e -> ''tva_cents'') <> ''number''
          or (e ->> ''taux_bp'') !~ ''^[0-9]+$''
          or (e ->> ''base_ht_cents'') !~ ''^-?[0-9]+$''
          or (e ->> ''tva_cents'') !~ ''^-?[0-9]+$'');
$$","create or replace function public.deductions_bien_formees(p jsonb)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select jsonb_typeof(p) = ''array''
     and not exists (
       select 1 from jsonb_array_elements(p) e
       where jsonb_typeof(e) <> ''object''
          or (select array_agg(k order by k) from jsonb_object_keys(e) k)
             is distinct from array[''facture_id'', ''ht'', ''numero'', ''ttc'', ''tva'']
          or (e ->> ''facture_id'') !~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$''
          or (e ->> ''numero'') !~ ''^FAC-[0-9]{4}-[0-9]{4,}$''
          or jsonb_typeof(e -> ''ht'') <> ''number'' or jsonb_typeof(e -> ''tva'') <> ''number''
          or jsonb_typeof(e -> ''ttc'') <> ''number''
          or (e ->> ''ht'') !~ ''^[0-9]+$'' or (e ->> ''tva'') !~ ''^[0-9]+$'' or (e ->> ''ttc'') !~ ''^[0-9]+$'');
$$"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000200', 'parametres_clients', '{"-- =============================================================================
-- H''DECOR : paramètres de l''entreprise, assurances, taux de TVA, clients.
-- Aucune valeur légale ou fiscale n''est posée en dur comme « vraie » : les
-- valeurs par défaut non confirmées portent un drapeau a_verifier = true,
-- affiché « À VÉRIFIER » dans l''interface.
-- =============================================================================

create type public.regime_tva as enum (''franchise'', ''assujetti'')","create table public.parametres_entreprise (
  organisation_id         uuid primary key references public.organisations (id) on delete restrict,

  -- Identité (saisie dans les Paramètres, jamais en dur dans le code)
  raison_sociale          text,
  forme_juridique         text not null default ''EI'',
  nom_dirigeant           text,
  siret                   text check (siret is null or siret ~ ''^[0-9]{14}$''),
  immatriculation         text,          -- RNE / RM : libellé exact À VÉRIFIER (comptable)
  adresse_ligne1          text,
  adresse_ligne2          text,
  code_postal             text check (code_postal is null or code_postal ~ ''^[0-9]{5}$''),
  ville                   text,
  telephone               text,
  email                   text,
  logo_chemin             text,          -- objet du bucket privé « marque »
  iban                    text,
  bic                     text,

  -- Statut fiscal : pilote tout le moteur de documents
  regime_tva              public.regime_tva not null default ''franchise'',
  mention_franchise       text not null default ''TVA non applicable, art. 293 B du CGI'',
  mention_franchise_a_verifier boolean not null default true,
  numero_tva_intra        text,

  -- Médiateur de la consommation
  mediateur_nom           text,
  mediateur_coordonnees   text,
  mediateur_site          text,

  -- Conditions par défaut (toutes À VÉRIFIER tant que Yorick / le comptable
  -- ne les a pas confirmées)
  -- Plafonds légaux de délai : paramétrables, À VÉRIFIER (aucun plafond codé en dur).
  delai_paiement_jours    integer not null default 30 check (delai_paiement_jours between 0 and 365),
  delai_paiement_max_jours integer not null default 60 check (delai_paiement_max_jours between 0 and 365),
  taux_penalites_bp       integer check (taux_penalites_bp is null or taux_penalites_bp between 0 and 10000),
  indemnite_recouvrement_cents bigint not null default 4000 check (indemnite_recouvrement_cents >= 0),
  escompte_texte          text not null default ''Pas d''''escompte pour paiement anticipé.'',
  validite_devis_jours    integer not null default 30 check (validite_devis_jours between 1 and 365),
  acompte_pct_defaut_bp   integer not null default 3000 check (acompte_pct_defaut_bp between 0 and 10000),
  -- Valeurs encore À VÉRIFIER, confirmables une par une (codes des colonnes).
  valeurs_a_verifier      text[] not null default array[
    ''delai_paiement_jours'', ''delai_paiement_max_jours'', ''indemnite_recouvrement_cents'',
    ''escompte_texte'', ''validite_devis_jours'', ''acompte_pct_defaut_bp'', ''taux_penalites_bp''],

  -- Calcul
  marge_perte_bp          integer not null default 1000 check (marge_perte_bp between 0 and 5000),
  coef_marge_bp           integer not null default 10000 check (coef_marge_bp between 10000 and 50000),
  taux_horaire_cents      bigint check (taux_horaire_cents is null or taux_horaire_cents >= 0),

  -- Relances
  relance_devis_active    boolean not null default true,
  relance_devis_jours     integer not null default 7 check (relance_devis_jours between 1 and 90),

  -- Seuils micro-entreprise : AUCUNE valeur par défaut. La jauge reste masquée
  -- tant que les seuils n''ont pas été saisis et confirmés (À VÉRIFIER).
  seuil_ca_micro_cents    bigint check (seuil_ca_micro_cents is null or seuil_ca_micro_cents > 0),
  seuil_franchise_tva_cents bigint check (seuil_franchise_tva_cents is null or seuil_franchise_tva_cents > 0),
  seuils_confirmes_le     date,
  -- Paliers d''alerte de la jauge (cahier des charges : 80 % et 95 %)
  seuil_alerte_1_bp       integer not null default 8000 check (seuil_alerte_1_bp between 0 and 10000),
  seuil_alerte_2_bp       integer not null default 9500 check (seuil_alerte_2_bp between 0 and 10000),
  check (seuil_alerte_1_bp <= seuil_alerte_2_bp),

  mentions_pied           text,
  avis_google_url         text,

  updated_at              timestamptz not null default now()
)","select public.appliquer_rls_standard(''public.parametres_entreprise'')","create trigger parametres_updated_at before update on public.parametres_entreprise
  for each row execute function public.maj_updated_at()","create trigger parametres_audit after insert or update or delete on public.parametres_entreprise
  for each row execute function public.tracer_audit()","create table public.assurances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in (''decennale'', ''rc_pro'')),
  assureur          text not null,
  numero_contrat    text not null,
  debut             date not null,
  fin               date,
  zone_couverte     text not null,
  attestation_chemin text,
  created_at        timestamptz not null default now(),
  unique (organisation_id, id),
  check (fin is null or fin >= debut)
)","select public.appliquer_rls_standard(''public.assurances'')","-- Taux de TVA proposés dans l''interface (paramétrables).
create table public.taux_tva (
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  taux_bp          integer not null check (taux_bp between 0 and 10000),
  libelle          text not null,
  -- Taux réduit soumis à attestation du client : paramétrable, À VÉRIFIER.
  attestation_requise boolean not null default false,
  a_verifier       boolean not null default true,
  actif            boolean not null default true,
  primary key (organisation_id, taux_bp)
)","select public.appliquer_rls_standard(''public.taux_tva'')","-- -----------------------------------------------------------------------------
-- Clients
-- -----------------------------------------------------------------------------

create type public.type_client as enum (''particulier'', ''professionnel'')","create table public.clients (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  type                public.type_client not null default ''particulier'',
  civilite            text,
  nom                 text not null check (length(nom) between 1 and 200),
  prenom              text,
  raison_sociale      text,
  siret               text check (siret is null or siret ~ ''^[0-9]{14}$''),
  tva_intra           text,
  email               text,
  telephone           text,
  fact_ligne1         text,
  fact_ligne2         text,
  fact_code_postal    text,
  fact_ville          text,
  fact_pays           text not null default ''France'',
  notes               text,
  source              text,
  consentement_le     timestamptz,
  anonymise_le        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organisation_id, id),
  check (type = ''particulier'' or raison_sociale is not null or anonymise_le is not null)
)","create index clients_recherche_idx on public.clients
  using gin (to_tsvector(''simple'', coalesce(nom, '''') || '' '' || coalesce(prenom, '''') || '' '' || coalesce(raison_sociale, '''')))","create index clients_org_nom_idx on public.clients (organisation_id, nom)","select public.appliquer_rls_standard(''public.clients'')","create trigger clients_updated_at before update on public.clients
  for each row execute function public.maj_updated_at()","-- L''anonymisation (anonymiser_client) est définie en fin de schéma (0800),
-- car elle touche aussi chantiers, devis, envois, photos et documents."}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000300', 'catalogue', '{"-- =============================================================================
-- H''DECOR : catalogue (produits, conditionnements, historique des prix,
-- teintes, prestations, étapes de préparation).
-- Règle : aucune référence ni aucun prix n''est présenté comme vérifié sans
-- source. Les lignes d''exemple livrées sont marquées « fictif ».
-- =============================================================================

create type public.statut_verification as enum (''verifie'', ''a_verifier'', ''fictif'')","create table public.produits (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  marque                text not null,
  gamme                 text,
  reference_fabricant   text,
  designation           text not null,
  type                  text not null check (type in (
                          ''sous_couche'', ''impression'', ''acrylique'', ''glycero'', ''laque'', ''facade'',
                          ''lasure'', ''vernis'', ''enduit'', ''anti_humidite'', ''anti_rouille'',
                          ''sous_couche_bloquante'', ''autre'')),
  usages                text[] not null default ''{}''
                          check (usages <@ array[''mur'', ''plafond'', ''boiserie'', ''metal'', ''exterieur'', ''sol'']::text[]),
  finition              text check (finition is null or finition in (''mat'', ''velours'', ''satin'', ''brillant'')),
  unite_mesure          text not null default ''L'' check (unite_mesure in (''L'', ''kg'')),
  -- Rendement en m² par litre (ou par kg), 2 décimales, par couche
  rendement_m2_par_unite numeric(6, 2) check (rendement_m2_par_unite is null or rendement_m2_par_unite > 0),
  couches_recommandees  smallint check (couches_recommandees is null or couches_recommandees between 1 and 5),
  sechage_recouvrable_h numeric(5, 1) check (sechage_recouvrable_h is null or sechage_recouvrable_h >= 0),
  fournisseur           text,
  fiche_technique_url   text,
  statut_verification   public.statut_verification not null default ''a_verifier'',
  verifie_le            date,
  source_verification   text,
  actif                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id),
  -- « vérifié » exige une date et une source
  check (statut_verification <> ''verifie'' or (verifie_le is not null and source_verification is not null))
)","create index produits_org_idx on public.produits (organisation_id, marque, designation)","select public.appliquer_rls_standard(''public.produits'')","create trigger produits_updated_at before update on public.produits
  for each row execute function public.maj_updated_at()","-- Formats disponibles. Volume en millilitres (ou grammes) entiers.
create table public.conditionnements (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  produit_id            uuid not null,
  contenance            integer not null check (contenance > 0),  -- ml ou g
  prix_achat_ht_cents   bigint check (prix_achat_ht_cents is null or prix_achat_ht_cents >= 0),
  actif                 boolean not null default true,
  unique (organisation_id, id),
  unique (produit_id, contenance),
  -- Un produit ou un format ne se supprime pas (il s''archive avec actif = false) :
  -- l''historique des prix doit survivre.
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.conditionnements'')","create table public.historique_prix (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  conditionnement_id    uuid not null,
  prix_achat_ht_cents   bigint not null check (prix_achat_ht_cents >= 0),
  date_effet            date not null default public.aujourd_hui_paris(),
  created_at            timestamptz not null default now(),
  foreign key (organisation_id, conditionnement_id) references public.conditionnements (organisation_id, id) on delete restrict
)","create index historique_prix_idx on public.historique_prix (conditionnement_id, date_effet desc)","select public.appliquer_rls_standard(''public.historique_prix'')","-- Toute modification de prix laisse une trace datée.
-- SECURITY DEFINER : l''historique n''est écrit que par ce trigger (l''API n''a
-- aucun droit d''écriture sur historique_prix).
create or replace function public.historiser_prix()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if new.prix_achat_ht_cents is not null
     and (tg_op = ''INSERT'' or new.prix_achat_ht_cents is distinct from old.prix_achat_ht_cents) then
    insert into public.historique_prix (organisation_id, conditionnement_id, prix_achat_ht_cents)
    values (new.organisation_id, new.id, new.prix_achat_ht_cents);
  end if;
  return null;
end;
$$","create trigger conditionnements_historique after insert or update on public.conditionnements
  for each row execute function public.historiser_prix()","create table public.teintes (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  nom               text not null,
  marque            text,
  code_ral          text,
  code_ncs          text,
  code_fabricant    text,
  apercu_hex        text check (apercu_hex is null or apercu_hex ~ ''^#[0-9A-Fa-f]{6}$''),
  statut_verification public.statut_verification not null default ''a_verifier'',
  created_at        timestamptz not null default now(),
  unique (organisation_id, id)
)","select public.appliquer_rls_standard(''public.teintes'')","-- Bibliothèque de prestations réutilisables
create table public.prestations (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  libelle               text not null,
  description           text,
  unite                 text not null check (unite in (''m2'', ''ml'', ''u'', ''h'', ''forfait'')),
  prix_unitaire_ht_cents bigint not null check (prix_unitaire_ht_cents >= 0),
  taux_tva_bp           integer not null check (taux_tva_bp between 0 and 10000),
  actif                 boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id)
)","select public.appliquer_rls_standard(''public.prestations'')","create trigger prestations_updated_at before update on public.prestations
  for each row execute function public.maj_updated_at()","-- Étapes de préparation paramétrables (temps et matière par m²).
-- Valeurs livrées : toutes « a_verifier ».
create table public.etapes_preparation (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  code                    text not null,
  libelle                 text not null,
  minutes_par_m2          numeric(6, 2) not null default 0 check (minutes_par_m2 >= 0),
  produit_id              uuid,
  consommation_par_m2     numeric(8, 4) check (consommation_par_m2 is null or consommation_par_m2 >= 0), -- L ou kg / m²
  statut_verification     public.statut_verification not null default ''a_verifier'',
  ordre                   smallint not null default 0,
  actif                   boolean not null default true,
  unique (organisation_id, id),
  unique (organisation_id, code),
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.etapes_preparation'')","-- Rendements et temps de pose par défaut, par type de produit (paramétrables).
create table public.referentiel_calcul (
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  type_produit            text not null,
  rendement_min           numeric(6, 2) not null check (rendement_min > 0),
  rendement_max           numeric(6, 2) not null check (rendement_max >= rendement_min),
  minutes_par_m2_couche   numeric(6, 2) check (minutes_par_m2_couche is null or minutes_par_m2_couche >= 0),
  statut_verification     public.statut_verification not null default ''a_verifier'',
  primary key (organisation_id, type_produit)
)","select public.appliquer_rls_standard(''public.referentiel_calcul'')","-- Coefficient de rendement par support (support poreux = rendement réduit).
create table public.coefficients_support (
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  support                 text not null,
  coef_rendement_bp       integer not null default 10000 check (coef_rendement_bp between 1000 and 15000),
  statut_verification     public.statut_verification not null default ''a_verifier'',
  primary key (organisation_id, support)
)","select public.appliquer_rls_standard(''public.coefficients_support'')"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000400', 'chantiers_metre', '{"-- =============================================================================
-- H''DECOR : chantiers, pièces, ouvertures, éléments, postes de travaux.
-- Les dimensions sont stockées en millimètres entiers : les surfaces se
-- calculent alors exactement en mm² (31,9268 m² = 31 926 800 mm²), sans
-- erreur de virgule flottante. Les calculs eux-mêmes vivent dans
-- src/domain (une seule implémentation, testée) ; la base ne stocke que la
-- saisie.
-- =============================================================================

-- « facturé » et « payé » sont DÉRIVÉS des factures (vue v_chantiers), pas stockés.
create type public.statut_chantier as enum (''a_planifier'', ''en_cours'', ''termine'')","create table public.chantiers (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  client_id             uuid not null,
  nom                   text not null,
  adresse_ligne1        text,
  adresse_ligne2        text,
  code_postal           text,
  ville                 text,
  statut                public.statut_chantier not null default ''a_planifier'',
  date_debut_prevue     date,
  duree_estimee_jours   numeric(5, 1) check (duree_estimee_jours is null or duree_estimee_jours >= 0),
  teinte_id             uuid,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict
)","create index chantiers_client_idx on public.chantiers (organisation_id, client_id)","create index chantiers_statut_idx on public.chantiers (organisation_id, statut)","select public.appliquer_rls_standard(''public.chantiers'')","create trigger chantiers_updated_at before update on public.chantiers
  for each row execute function public.maj_updated_at()","create table public.pieces (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  chantier_id       uuid not null,
  nom               text not null,
  etage             text,
  mode_saisie       text not null default ''rectangle'' check (mode_saisie in (''rectangle'', ''murs'')),
  longueur_mm       integer check (longueur_mm is null or longueur_mm between 1 and 100000),
  largeur_mm        integer check (largeur_mm is null or largeur_mm between 1 and 100000),
  murs_mm           integer[],                 -- mode « murs » : longueur de chaque mur
  surface_sol_mm2   bigint check (surface_sol_mm2 is null or surface_sol_mm2 > 0), -- plafond non rectangulaire
  hauteur_mm        integer not null check (hauteur_mm between 1 and 20000),
  etat_support      text,
  multiplicateur    smallint not null default 1 check (multiplicateur between 1 and 50), -- « x chambres identiques »
  teinte_id         uuid,
  notes             text,
  ordre             smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict,
  check (
    (mode_saisie = ''rectangle'' and longueur_mm is not null and largeur_mm is not null)
    or (mode_saisie = ''murs'' and murs_mm is not null and cardinality(murs_mm) between 3 and 30
        and 0 < all (murs_mm))
  )
)","create index pieces_chantier_idx on public.pieces (organisation_id, chantier_id, ordre)","select public.appliquer_rls_standard(''public.pieces'')","create trigger pieces_updated_at before update on public.pieces
  for each row execute function public.maj_updated_at()","-- Ouvertures à déduire : dimensions OU surface directe.
create table public.ouvertures (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  piece_id              uuid not null,
  type                  text not null check (type in (''porte'', ''fenetre'', ''baie'', ''autre'')),
  largeur_mm            integer check (largeur_mm is null or largeur_mm > 0),
  hauteur_mm            integer check (hauteur_mm is null or hauteur_mm > 0),
  surface_directe_mm2   bigint check (surface_directe_mm2 is null or surface_directe_mm2 > 0),
  quantite              smallint not null default 1 check (quantite between 1 and 100),
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade,
  check ((largeur_mm is not null and hauteur_mm is not null) <> (surface_directe_mm2 is not null))
)","select public.appliquer_rls_standard(''public.ouvertures'')","-- Éléments : plinthes, corniches (ml), menuiseries, radiateurs, etc.
create table public.elements (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  piece_id          uuid not null,
  type              text not null check (type in (
                      ''plinthe'', ''corniche'', ''porte'', ''fenetre'', ''radiateur'', ''volet'',
                      ''escalier'', ''rambarde'', ''autre'')),
  unite             text not null check (unite in (''ml'', ''m2'', ''u'')),
  quantite_e4       bigint not null check (quantite_e4 > 0),  -- quantité × 10 000 (4 décimales exactes)
  faces             smallint not null default 1 check (faces between 1 and 2),
  notes             text,
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade
)","select public.appliquer_rls_standard(''public.elements'')","-- Poste de travaux : une surface (ou un élément) + support + préparation + finition.
create table public.postes_travaux (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  piece_id              uuid not null,
  cible                 text not null check (cible in (''murs'', ''plafond'', ''element'')),
  element_id            uuid,
  support               text not null check (support in (
                          ''platre_neuf'', ''ancienne_peinture'', ''beton'', ''enduit'', ''bois_brut'',
                          ''bois_vernis'', ''metal'', ''papier_peint'', ''carrelage'', ''autre'')),
  zone_humide           boolean not null default false,
  taches                boolean not null default false,
  produit_id            uuid,
  teinte_id             uuid,
  finition              text check (finition is null or finition in (''mat'', ''velours'', ''satin'', ''brillant'')),
  couches               smallint not null default 2 check (couches between 1 and 5),
  rendement_force       numeric(6, 2) check (rendement_force is null or rendement_force > 0),
  marge_perte_bp        integer check (marge_perte_bp is null or marge_perte_bp between 0 and 5000),
  unique (organisation_id, id),
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete cascade,
  foreign key (organisation_id, element_id) references public.elements (organisation_id, id) on delete cascade,
  foreign key (organisation_id, produit_id) references public.produits (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict,
  check ((cible = ''element'') = (element_id is not null))
)","select public.appliquer_rls_standard(''public.postes_travaux'')","create table public.postes_preparations (
  organisation_id   uuid not null,
  poste_id          uuid not null,
  etape_id          uuid not null,
  primary key (poste_id, etape_id),
  foreign key (organisation_id, poste_id) references public.postes_travaux (organisation_id, id) on delete cascade,
  foreign key (organisation_id, etape_id) references public.etapes_preparation (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.postes_preparations'')","-- Temps réellement passé (rentabilité réelle vs prévu, §5.8 / §5.10).
create table public.temps_passes (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  jour              date not null,
  minutes           integer not null check (minutes between 1 and 1440),
  tache             text,
  note              text,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
)","create index temps_passes_chantier_idx on public.temps_passes (organisation_id, chantier_id, jour)","select public.appliquer_rls_standard(''public.temps_passes'')"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000500', 'devis', E'{"-- =============================================================================
-- H''DECOR : devis, lignes, signatures, liens publics.
--
-- Cycle de vie :
--   brouillon  --emettre_devis()-->  envoye  --signature-->  accepte
--                                       |--refuser_devis()--> refuse
--                                       |--nouvelle_version_devis()--> remplace
-- « consulté » et « expiré » sont des états DÉRIVÉS (consulte_le, date de
-- validité) exposés par la vue v_devis, pas des statuts stockés.
--
-- Immuabilité : dès que le devis quitte « brouillon », son contenu et ses
-- lignes sont figés par trigger. Les colonnes de cycle de vie ne sont pas
-- modifiables par l''API (privilèges de colonne) : seules les fonctions
-- dédiées les changent.
-- =============================================================================

create type public.statut_devis as enum (''brouillon'', ''envoye'', ''accepte'', ''refuse'', ''remplace'')","create table public.devis (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  client_id               uuid not null,
  chantier_id             uuid,

  -- Cycle de vie (colonnes réservées aux fonctions)
  numero                  text,
  version                 smallint not null default 1 check (version between 1 and 99),
  devis_precedent_id      uuid,
  statut                  public.statut_devis not null default ''brouillon'',
  date_emission           date,
  envoye_le               timestamptz,
  consulte_le             timestamptz,
  accepte_le              timestamptz,
  refuse_le               timestamptz,
  motif_refus             text,
  signature_id            uuid,

  -- Contenu (modifiable tant que brouillon)
  objet                   text,
  validite_jours          integer not null check (validite_jours between 1 and 365),
  date_debut_travaux      date,
  delai_debut_texte       text,
  duree_estimee_jours     numeric(5, 1) check (duree_estimee_jours is null or duree_estimee_jours > 0),
  acompte_pct_bp          integer not null default 0 check (acompte_pct_bp between 0 and 10000),
  conditions_paiement     text,
  hors_etablissement      boolean not null default true,
  regime_tva              public.regime_tva not null,
  remise_globale_bp       integer not null default 0 check (remise_globale_bp between 0 and 10000),
  notes_client            text,

  -- Totaux calculés par src/domain, contrôlés à l''émission
  total_ht_cents          bigint not null default 0 check (total_ht_cents >= 0),
  total_tva_cents         bigint not null default 0 check (total_tva_cents >= 0),
  total_ttc_cents         bigint not null default 0 check (total_ttc_cents >= 0),
  ventilation_tva         jsonb not null default ''[]''::jsonb,  -- [{taux_bp, base_ht_cents, tva_cents}]
  -- Totaux après choix des options par le client (fixés à la signature)
  total_accepte_ht_cents  bigint,
  total_accepte_tva_cents bigint,
  total_accepte_ttc_cents bigint,
  ventilation_acceptee    jsonb,
  check (total_accepte_ht_cents is null or (total_accepte_ht_cents >= 0 and total_accepte_tva_cents >= 0
         and total_accepte_ttc_cents = total_accepte_ht_cents + total_accepte_tva_cents)),

  -- Copies figées à l''émission : le document reste identique même si les
  -- paramètres ou la fiche client changent ensuite.
  copie_emetteur          jsonb,
  copie_client            jsonb,
  copie_chantier          jsonb,
  pdf_chemin              text,
  pdf_sha256              text check (pdf_sha256 is null or pdf_sha256 ~ ''^[0-9a-f]{64}$''),

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (organisation_id, id),
  unique (organisation_id, numero, version),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, devis_precedent_id) references public.devis (organisation_id, id) on delete restrict,
  check (total_ttc_cents = total_ht_cents + total_tva_cents),
  check (regime_tva = ''assujetti'' or total_tva_cents = 0),
  check (statut = ''brouillon'' or (numero is not null and date_emission is not null and pdf_sha256 is not null)),
  check (public.ventilation_bien_formee(ventilation_tva)),
  check (ventilation_acceptee is null or public.ventilation_bien_formee(ventilation_acceptee))
)","create index devis_client_idx on public.devis (organisation_id, client_id)","create index devis_statut_idx on public.devis (organisation_id, statut, date_emission desc)","create type public.type_ligne as enum (''section'', ''ligne'', ''sous_total'', ''texte'')","create table public.devis_lignes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  devis_id              uuid not null,
  ordre                 integer not null,
  type                  public.type_ligne not null default ''ligne'',
  designation           text not null,
  description           text,
  quantite_e4           bigint check (quantite_e4 is null or quantite_e4 >= 0),  -- quantité × 10 000
  unite                 text check (unite is null or unite in (''m2'', ''ml'', ''u'', ''h'', ''forfait'', ''L'', ''kg'')),
  prix_unitaire_ht_cents bigint check (prix_unitaire_ht_cents is null or prix_unitaire_ht_cents >= 0),
  remise_bp             integer not null default 0 check (remise_bp between 0 and 10000),
  taux_tva_bp           integer check (taux_tva_bp is null or taux_tva_bp between 0 and 10000),
  total_ht_cents        bigint check (total_ht_cents is null or total_ht_cents >= 0),
  optionnelle           boolean not null default false,
  origine               jsonb,      -- trace du calcul (pièce, poste, surface) pour le détail
  -- Prévu, figé avec le devis : base de la marge réelle vs prévue (§5.8)
  cout_matiere_prevu_cents bigint check (cout_matiere_prevu_cents is null or cout_matiere_prevu_cents >= 0),
  minutes_prevues       integer check (minutes_prevues is null or minutes_prevues >= 0),
  unique (organisation_id, id),
  unique (devis_id, ordre),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  check (type <> ''ligne'' or (quantite_e4 is not null and unite is not null
                             and prix_unitaire_ht_cents is not null and taux_tva_bp is not null
                             and total_ht_cents is not null)),
  -- R4 : total de ligne = arrondi demi-supérieur(quantité x PU x (1 - remise)).
  check (type <> ''ligne'' or total_ht_cents = floor(
    (quantite_e4::numeric * prix_unitaire_ht_cents * (10000 - remise_bp) + 50000000) / 100000000))
)","select public.appliquer_rls_standard(''public.devis'')","select public.appliquer_rls_standard(''public.devis_lignes'')","-- Colonnes de cycle de vie : hors de portée de l''API.
revoke insert, update on public.devis from authenticated","grant insert (id, organisation_id, client_id, chantier_id, objet, validite_jours, date_debut_travaux,
              delai_debut_texte, duree_estimee_jours, acompte_pct_bp, conditions_paiement,
              hors_etablissement, regime_tva, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  on public.devis to authenticated","grant update (client_id, chantier_id, objet, validite_jours, date_debut_travaux,
              delai_debut_texte, duree_estimee_jours, acompte_pct_bp, conditions_paiement,
              hors_etablissement, regime_tva, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  on public.devis to authenticated","create trigger devis_updated_at before update on public.devis
  for each row execute function public.maj_updated_at()","create trigger devis_audit after insert or update or delete on public.devis
  for each row execute function public.tracer_audit()","create trigger devis_lignes_audit after insert or update or delete on public.devis_lignes
  for each row execute function public.tracer_audit()","-- Gel du devis après émission.
create or replace function public.proteger_devis()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  v_modifiables text[] := array[
    ''statut'', ''consulte_le'', ''accepte_le'', ''refuse_le'', ''motif_refus'', ''signature_id'',
    ''total_accepte_ht_cents'', ''total_accepte_tva_cents'', ''total_accepte_ttc_cents'',
    ''ventilation_acceptee'', ''updated_at''];
begin
  if tg_op = ''DELETE'' then
    if old.statut <> ''brouillon'' then
      raise exception ''Un devis envoyé ne peut pas être supprimé.'' using errcode = ''P0001'';
    end if;
    return old;
  end if;

  if old.statut = ''brouillon'' then
    return new;
  end if;

  -- Anonymisation RGPD d''un devis jamais accepté (pas d''obligation de
  -- conservation comptable) : uniquement via anonymiser_client().
  -- Seules les valeurs anonymisées CONSTANTES sont admises, et seulement sur
  -- un devis qui ne peut plus être signé (refusé ou remplacé).
  if current_setting(''hdecor.anonymisation'', true) = ''on''
     and current_user not in (''authenticated'', ''anon'') and old.statut in (''refuse'', ''remplace'')
     and new.statut = old.statut
     and new.copie_client = ''{\\"nom_affiche\\": \\"Client anonymisé\\"}''::jsonb
     and new.copie_chantier = ''{}''::jsonb and new.objet is null
     and new.notes_client is null and new.conditions_paiement is null and new.delai_debut_texte is null
     and (new.motif_refus is not distinct from (case when old.statut = ''refuse'' then ''Anonymisation (RGPD)'' end)) then
    v_modifiables := v_modifiables || array[''copie_client'', ''copie_chantier'', ''objet'', ''notes_client'',
                                            ''conditions_paiement'', ''delai_debut_texte''];
  end if;
  if (to_jsonb(new) - v_modifiables) is distinct from (to_jsonb(old) - v_modifiables) then
    raise exception ''Un devis envoyé est figé : créez une nouvelle version.'' using errcode = ''P0001'';
  end if;

  if new.statut is distinct from old.statut and not (
       (old.statut = ''envoye'' and new.statut in (''accepte'', ''refuse'', ''remplace''))
  ) then
    raise exception ''Changement de statut de devis interdit : % -> %.'', old.statut, new.statut
      using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger devis_protection before update or delete on public.devis
  for each row execute function public.proteger_devis()","create or replace function public.proteger_devis_lignes()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  -- Anonymisation RGPD des lignes d''un devis jamais accepté : seul le texte
  -- est remplacé par une valeur constante, rien d''autre ne change.
  -- (IF imbriqués : le trigger sert aussi à devis_achats et devis_echeances,
  -- qui n''ont pas de colonne designation.)
  if tg_op = ''UPDATE'' and tg_table_name in (''devis_lignes'', ''devis_echeances'')
     and current_setting(''hdecor.anonymisation'', true) = ''on''
     and current_user not in (''authenticated'', ''anon'')
     and exists (select 1 from public.devis d where d.id = old.devis_id and d.statut in (''refuse'', ''remplace'')) then
    if tg_table_name = ''devis_lignes''
       and to_jsonb(new) ->> ''designation'' = ''Prestation (anonymisée)''
       and to_jsonb(new) -> ''description'' = ''null''::jsonb and to_jsonb(new) -> ''origine'' = ''null''::jsonb
       and (to_jsonb(new) - array[''designation'', ''description'', ''origine''])
           = (to_jsonb(old) - array[''designation'', ''description'', ''origine'']) then
      return new;
    end if;
    if tg_table_name = ''devis_echeances''
       and to_jsonb(new) ->> ''libelle'' = ''Échéance (anonymisée)''
       and (to_jsonb(new) - ''libelle'') = (to_jsonb(old) - ''libelle'') then
      return new;
    end if;
  end if;
  -- On contrôle l''ancien ET le nouveau devis : déplacer une ligne d''un
  -- brouillon vers un devis envoyé est aussi interdit. Un devis supprimé dans
  -- la même opération (cascade d''un brouillon) n''a plus rien à protéger.
  if exists (
    select 1 from public.devis d
    where d.statut <> ''brouillon''
      and d.id in (case when tg_op <> ''INSERT'' then old.devis_id end,
                   case when tg_op <> ''DELETE'' then new.devis_id end)
  ) then
    raise exception ''Les lignes d''''un devis envoyé sont figées.'' using errcode = ''P0001'';
  end if;
  return case when tg_op = ''DELETE'' then old else new end;
end;
$$","create trigger devis_lignes_protection before insert or update or delete on public.devis_lignes
  for each row execute function public.proteger_devis_lignes()","-- Achats retenus pour le devis : conditionnement et prix d''achat au moment du
-- chiffrage. Sert à l''alerte « le prix a changé depuis le devis » (§5.5) et au
-- coût matière prévu. Figés avec le devis (même trigger que les lignes).
create table public.devis_achats (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null,
  devis_id                uuid not null,
  conditionnement_id      uuid not null,
  teinte_id               uuid,
  nombre                  integer not null check (nombre between 1 and 10000),
  prix_achat_retenu_cents bigint check (prix_achat_retenu_cents is null or prix_achat_retenu_cents >= 0),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  foreign key (organisation_id, conditionnement_id) references public.conditionnements (organisation_id, id) on delete restrict,
  foreign key (organisation_id, teinte_id) references public.teintes (organisation_id, id) on delete restrict
)","create index devis_achats_devis_idx on public.devis_achats (organisation_id, devis_id)","create index devis_achats_cond_idx on public.devis_achats (organisation_id, conditionnement_id)","select public.appliquer_rls_standard(''public.devis_achats'')","create trigger devis_achats_protection before insert or update or delete on public.devis_achats
  for each row execute function public.proteger_devis_lignes()","-- Échéancier d''acompte et de paiement (§5.6), figé avec le devis.
-- Alimente la trésorerie prévisionnelle (« acomptes attendus »).
create table public.devis_echeances (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null,
  devis_id          uuid not null,
  ordre             smallint not null,
  libelle           text not null,
  pourcentage_bp    integer not null check (pourcentage_bp between 1 and 10000),
  declencheur       text not null check (declencheur in (''signature'', ''debut_travaux'', ''mi_chantier'', ''fin_travaux'', ''date'')),
  date_prevue       date,
  unique (devis_id, ordre),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete cascade,
  check ((declencheur = ''date'') = (date_prevue is not null))
)","select public.appliquer_rls_standard(''public.devis_echeances'')","create trigger devis_echeances_protection before insert or update or delete on public.devis_echeances
  for each row execute function public.proteger_devis_lignes()","-- -----------------------------------------------------------------------------
-- Contrôle des totaux (garde-fou en base ; le calcul lui-même est dans
-- src/domain). Vérifie : somme des lignes, ventilation par taux, arrondi de la
-- TVA par taux (demi au-dessus), TTC = HT + TVA.
-- -----------------------------------------------------------------------------

create or replace function public.controler_ventilation(
  p_ventilation jsonb, p_total_ht bigint, p_total_tva bigint, p_regime public.regime_tva)
returns void
language plpgsql
immutable
set search_path = ''''
as $$
declare
  v_base_somme bigint := 0;
  v_tva_somme  bigint := 0;
  v_item       jsonb;
  v_base       bigint;
  v_tva        bigint;
  v_taux       integer;
begin
  for v_item in select * from jsonb_array_elements(p_ventilation) loop
    v_taux := (v_item ->> ''taux_bp'')::integer;
    v_base := (v_item ->> ''base_ht_cents'')::bigint;
    v_tva  := (v_item ->> ''tva_cents'')::bigint;
    if v_base is null or v_tva is null or v_taux is null or v_base < 0 or v_tva < 0 then
      raise exception ''Ventilation invalide (valeur manquante ou négative).'' using errcode = ''P0001'';
    end if;
    if p_regime = ''franchise'' and v_tva <> 0 then
      raise exception ''Franchise en base : aucune TVA ne doit être facturée.'' using errcode = ''P0001'';
    end if;
    if p_regime = ''assujetti'' and v_tva <> floor((v_base * v_taux + 5000) / 10000.0)::bigint then
      raise exception ''TVA incohérente pour le taux % : % au lieu de %.'',
        v_taux, v_tva, floor((v_base * v_taux + 5000) / 10000.0)::bigint using errcode = ''P0001'';
    end if;
    v_base_somme := v_base_somme + v_base;
    v_tva_somme  := v_tva_somme + v_tva;
  end loop;
  if v_base_somme <> p_total_ht or v_tva_somme <> p_total_tva then
    raise exception ''Totaux incohérents avec la ventilation de TVA.'' using errcode = ''P0001'';
  end if;
end;
$$","-- Ventilation ATTENDUE, calculée par la base à partir des lignes (règle R5) :
--   remise totale = arrondi demi-supérieur(somme HT x taux de remise) ;
--   remise de chaque taux = partie entière(lignes du taux x remise totale / somme),
--   puis les centimes restants vont, un par un, aux taux de plus fort reste
--   (à reste égal : taux de TVA le plus élevé d''abord) ;
--   base = lignes du taux - remise du taux ; TVA = arrondi demi-supérieur(base x taux).
-- src/domain implémente la même règle ; la base exige l''ÉGALITÉ STRICTE.
create or replace function public.ventilation_attendue(
  p_lignes_par_taux jsonb, p_remise_bp integer, p_regime public.regime_tva)
returns jsonb
language sql
immutable
set search_path = ''''
as $$
  with l as (
    select (e ->> ''taux_bp'')::integer as taux, (e ->> ''somme_ht_cents'')::bigint as somme
    from jsonb_array_elements(p_lignes_par_taux) e
  ),
  tot as (
    select sum(somme)::bigint as somme,
           floor((sum(somme) * p_remise_bp + 5000) / 10000.0)::bigint as remise
    from l
  ),
  parts as (
    select l.taux, l.somme,
           case when tot.somme = 0 then 0 else (l.somme * tot.remise) / tot.somme end as remise_base,
           case when tot.somme = 0 then 0 else (l.somme * tot.remise) % tot.somme end as reste,
           tot.remise as remise_totale
    from l, tot
  ),
  rang as (
    select p.*, row_number() over (order by p.reste desc, p.taux desc) as rg,
           p.remise_totale - sum(p.remise_base) over () as a_repartir
    from parts p
  ),
  bases as (
    select taux, somme - remise_base - case when rg <= a_repartir then 1 else 0 end as base
    from rang
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           ''taux_bp'', taux, ''base_ht_cents'', base,
           ''tva_cents'', case when p_regime = ''franchise'' then 0
                             else floor((base * taux + 5000) / 10000.0)::bigint end)
         order by taux), ''[]''::jsonb)
  from bases;
$$","-- Contrôle strict : la ventilation fournie doit être exactement l''attendue
-- (mêmes taux, mêmes bases, mêmes TVA), et les totaux en découler.
create or replace function public.controler_totaux_lignes(
  p_lignes_par_taux jsonb, p_remise_bp integer, p_regime public.regime_tva,
  p_ventilation jsonb, p_total_ht bigint, p_total_tva bigint)
returns void
language plpgsql
immutable
set search_path = ''''
as $$
declare
  v_attendue jsonb := public.ventilation_attendue(p_lignes_par_taux, p_remise_bp, p_regime);
  v_fournie  jsonb;
begin
  if jsonb_array_length(p_lignes_par_taux) = 0 then
    raise exception ''Aucune ligne chiffrée.'' using errcode = ''P0001'';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           ''taux_bp'', (e ->> ''taux_bp'')::integer, ''base_ht_cents'', (e ->> ''base_ht_cents'')::bigint,
           ''tva_cents'', (e ->> ''tva_cents'')::bigint) order by (e ->> ''taux_bp'')::integer), ''[]''::jsonb)
    into v_fournie
  from jsonb_array_elements(p_ventilation) e;
  if v_fournie is distinct from v_attendue then
    raise exception ''Ventilation incohérente avec les lignes : % au lieu de %.'', v_fournie, v_attendue
      using errcode = ''P0001'';
  end if;
  if p_total_ht is distinct from (select sum((e ->> ''base_ht_cents'')::bigint) from jsonb_array_elements(v_attendue) e)
     or p_total_tva is distinct from (select sum((e ->> ''tva_cents'')::bigint) from jsonb_array_elements(v_attendue) e) then
    raise exception ''Totaux incohérents avec les lignes et la remise.'' using errcode = ''P0001'';
  end if;
end;
$$","create or replace function public.lignes_devis_par_taux(p_devis_id uuid, p_options uuid[])
returns jsonb
language sql
stable
set search_path = ''''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(''taux_bp'', taux_bp, ''somme_ht_cents'', s)), ''[]''::jsonb)
  from (
    select taux_bp_ligne as taux_bp, sum(total_ht_cents)::bigint as s
    from (select l.taux_tva_bp as taux_bp_ligne, l.total_ht_cents
          from public.devis_lignes l
          where l.devis_id = p_devis_id and l.type = ''ligne''
            and (not l.optionnelle or l.id = any (coalesce(p_options, ''{}'')))) x
    group by taux_bp_ligne
    having sum(total_ht_cents) > 0
  ) t;
$$","-- -----------------------------------------------------------------------------
-- Émission d''un devis : numéro, date, copies figées, empreinte du PDF.
-- Le PDF est généré par le serveur AVANT l''appel ; son empreinte est figée ici.
-- -----------------------------------------------------------------------------

create or replace function public.emettre_devis(
  p_devis_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_devis   public.devis%rowtype;
  v_numero  text;
  v_somme_lignes bigint;
  v_date    date := public.aujourd_hui_paris();
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  if v_devis.statut <> ''brouillon'' then
    raise exception ''Ce devis a déjà été émis.'' using errcode = ''P0001'';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme_lignes
  from public.devis_lignes
  where devis_id = p_devis_id and type = ''ligne'' and not optionnelle;
  if v_somme_lignes = 0 then
    raise exception ''Un devis sans ligne chiffrée ne peut pas être émis.'' using errcode = ''P0001'';
  end if;
  -- FOR SHARE : un changement simultané du client du chantier attend la fin
  -- de cette émission (puis est refusé par proteger_client_chantier).
  perform 1 from public.chantiers where id = v_devis.chantier_id for share;
  if v_devis.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_devis.chantier_id and c.client_id <> v_devis.client_id) then
    raise exception ''Le chantier du devis appartient à un autre client.'' using errcode = ''P0001'';
  end if;
  perform public.controler_totaux_lignes(public.lignes_devis_par_taux(p_devis_id, ''{}''),
    v_devis.remise_globale_bp, v_devis.regime_tva, v_devis.ventilation_tva,
    v_devis.total_ht_cents, v_devis.total_tva_cents);
  perform public.controler_ventilation(v_devis.ventilation_tva, v_devis.total_ht_cents,
                                        v_devis.total_tva_cents, v_devis.regime_tva);
  if (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances where devis_id = p_devis_id) > 10000 then
    raise exception ''L''''échéancier dépasse 100 %% du devis.'' using errcode = ''P0001'';
  end if;
  -- Une seule source pour l''acompte : s''il y a un échéancier, l''acompte du
  -- devis est la somme des échéances dues à la signature.
  if exists (select 1 from public.devis_echeances where devis_id = p_devis_id)
     and v_devis.acompte_pct_bp <> (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances
                                    where devis_id = p_devis_id and declencheur = ''signature'') then
    raise exception ''L''''acompte du devis ne correspond pas à l''''échéancier.'' using errcode = ''P0001'';
  end if;

  if v_devis.devis_precedent_id is null then
    v_numero := public.prochain_numero(v_devis.organisation_id, ''DEV'', extract(year from v_date)::integer);
  else
    select numero into v_numero from public.devis where id = v_devis.devis_precedent_id;
  end if;

  update public.devis set
    numero = v_numero,
    statut = ''envoye'',
    date_emission = v_date,
    envoye_le = now(),
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_devis_id;

  return v_numero;
end;
$$","create or replace function public.refuser_devis(p_devis_id uuid, p_motif text)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  update public.devis set statut = ''refuse'', refuse_le = now(), motif_refus = p_motif
  where id = p_devis_id;   -- le trigger refuse toute transition invalide
end;
$$","-- Nouvelle version : copie le contenu et les lignes dans un brouillon v+1,
-- l''ancienne version passe à « remplace ».
create or replace function public.nouvelle_version_devis(p_devis_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_ancien  public.devis%rowtype;
  v_nouveau uuid := gen_random_uuid();
begin
  select * into v_ancien from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_ancien.organisation_id) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  if v_ancien.statut <> ''envoye'' then
    raise exception ''Seul un devis envoyé, ni accepté ni refusé, peut être remplacé.'' using errcode = ''P0001'';
  end if;

  insert into public.devis (id, organisation_id, client_id, chantier_id, version, devis_precedent_id,
    objet, validite_jours, date_debut_travaux, delai_debut_texte, duree_estimee_jours, acompte_pct_bp,
    conditions_paiement, hors_etablissement, regime_tva, remise_globale_bp, notes_client,
    total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  values (v_nouveau, v_ancien.organisation_id, v_ancien.client_id, v_ancien.chantier_id,
    v_ancien.version + 1, v_ancien.id, v_ancien.objet, v_ancien.validite_jours,
    v_ancien.date_debut_travaux, v_ancien.delai_debut_texte, v_ancien.duree_estimee_jours,
    v_ancien.acompte_pct_bp, v_ancien.conditions_paiement, v_ancien.hors_etablissement,
    v_ancien.regime_tva, v_ancien.remise_globale_bp, v_ancien.notes_client,
    v_ancien.total_ht_cents, v_ancien.total_tva_cents, v_ancien.total_ttc_cents, v_ancien.ventilation_tva);

  insert into public.devis_lignes (organisation_id, devis_id, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues)
  select organisation_id, v_nouveau, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues
  from public.devis_lignes where devis_id = p_devis_id;

  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents)
  select organisation_id, v_nouveau, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents
  from public.devis_achats where devis_id = p_devis_id;

  insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur, date_prevue)
  select organisation_id, v_nouveau, ordre, libelle, pourcentage_bp, declencheur, date_prevue
  from public.devis_echeances where devis_id = p_devis_id;

  update public.devis set statut = ''remplace'' where id = p_devis_id;
  return v_nouveau;
end;
$$","-- -----------------------------------------------------------------------------
-- Signatures (devis, PV de réception, attestation de TVA).
-- Signature électronique simple : tracé, nom, horodatage serveur, IP,
-- navigateur, empreinte SHA-256 du PDF présenté. Ligne non modifiable, sauf
-- l''ajout unique du PDF signé archivé.
-- -----------------------------------------------------------------------------

create table public.signatures (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  document_type         text not null check (document_type in (''devis'', ''pv_reception'', ''attestation_tva'')),
  document_id           uuid not null,
  methode               text not null check (methode in (''sur_place'', ''lien'')),
  signataire_nom        text not null check (length(signataire_nom) between 2 and 200),
  mention               text not null,                  -- ex. « Bon pour accord »
  image_chemin          text not null,
  document_sha256       text not null check (document_sha256 ~ ''^[0-9a-f]{64}$''),
  options_acceptees     uuid[] not null default ''{}'',
  ip                    inet,
  user_agent            text,
  signe_le              timestamptz not null default now(),
  pdf_signe_chemin      text,
  pdf_signe_sha256      text check (pdf_signe_sha256 is null or pdf_signe_sha256 ~ ''^[0-9a-f]{64}$''),
  unique (organisation_id, id),
  unique (document_type, document_id)   -- une seule signature par document
)","alter table public.signatures enable row level security","create policy signatures_lecture on public.signatures
  for select to authenticated using (public.est_membre(organisation_id))","-- Écriture : uniquement via les fonctions de signature.
create trigger signatures_audit after insert or update on public.signatures
  for each row execute function public.tracer_audit()","create or replace function public.proteger_signature()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if tg_op = ''DELETE'' then
    raise exception ''Une signature ne peut pas être supprimée.'' using errcode = ''P0001'';
  end if;
  if (to_jsonb(new) - array[''pdf_signe_chemin'', ''pdf_signe_sha256''])
       is distinct from (to_jsonb(old) - array[''pdf_signe_chemin'', ''pdf_signe_sha256''])
     or old.pdf_signe_sha256 is not null then
    raise exception ''Une signature est définitive.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger signatures_protection before update or delete on public.signatures
  for each row execute function public.proteger_signature()","-- Signature d''un devis : fonction commune aux deux méthodes.
create or replace function public.signer_devis_interne(
  p_devis_id uuid, p_methode text, p_nom text, p_mention text, p_image_chemin text,
  p_document_sha256 text, p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_devis public.devis%rowtype;
  v_sig   uuid;
  v_vent  jsonb;
  v_ht    bigint;
  v_tva   bigint;
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  if v_devis.statut <> ''envoye'' then
    raise exception ''Ce devis ne peut plus être signé.'' using errcode = ''P0001'';
  end if;
  if v_devis.date_emission + v_devis.validite_jours < public.aujourd_hui_paris() then
    raise exception ''Ce devis a expiré.'' using errcode = ''P0001'';
  end if;
  if p_document_sha256 <> v_devis.pdf_sha256 then
    raise exception ''Le document signé ne correspond pas au devis émis.'' using errcode = ''P0001'';
  end if;
  if exists (
    select 1 from unnest(p_options) o
    where not exists (select 1 from public.devis_lignes l
                      where l.id = o and l.devis_id = p_devis_id and l.optionnelle)
  ) then
    raise exception ''Option inconnue.'' using errcode = ''P0001'';
  end if;

  -- Le montant accepté est CALCULÉ ici (lignes fermes + options choisies,
  -- remise, règle R5) : rien n''est fourni par l''appelant.
  v_vent := public.ventilation_attendue(public.lignes_devis_par_taux(p_devis_id, p_options),
                                        v_devis.remise_globale_bp, v_devis.regime_tva);
  select sum((e ->> ''base_ht_cents'')::bigint), sum((e ->> ''tva_cents'')::bigint)
    into v_ht, v_tva
  from jsonb_array_elements(v_vent) e;

  insert into public.signatures (organisation_id, document_type, document_id, methode, signataire_nom,
    mention, image_chemin, document_sha256, options_acceptees, ip, user_agent)
  values (v_devis.organisation_id, ''devis'', p_devis_id, p_methode, p_nom, p_mention, p_image_chemin,
    p_document_sha256, coalesce(p_options, ''{}''), p_ip, p_user_agent)
  returning id into v_sig;

  update public.devis set
    statut = ''accepte'', accepte_le = now(), signature_id = v_sig,
    total_accepte_ht_cents = v_ht, total_accepte_tva_cents = v_tva,
    total_accepte_ttc_cents = v_ht + v_tva, ventilation_acceptee = v_vent
  where id = p_devis_id;
  return v_sig;
end;
$$","revoke execute on function public.signer_devis_interne(uuid, text, text, text, text, text, uuid[], inet, text)
  from public, anon, authenticated","-- Sur place, sur le téléphone de Yorick (session authentifiée).
create or replace function public.signer_devis_sur_place(
  p_devis_id uuid, p_nom text, p_mention text, p_image_chemin text, p_document_sha256 text,
  p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  return public.signer_devis_interne(p_devis_id, ''sur_place'', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_options, p_ip, p_user_agent);
end;
$$","-- Vue avec les états dérivés (consulté, expiré). security_invoker : la RLS
-- des tables sous-jacentes s''applique.
create view public.v_devis with (security_invoker = true) as
select d.*,
  case
    when d.statut = ''envoye'' and d.date_emission + d.validite_jours < public.aujourd_hui_paris() then ''expire''
    when d.statut = ''envoye'' and d.consulte_le is not null then ''consulte''
    else d.statut::text
  end as statut_affiche,
  d.date_emission + d.validite_jours as valide_jusqu_au
from public.devis d"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000600', 'factures_paiements', '{"-- =============================================================================
-- H''DECOR : factures (acompte, situation, finale, libre), avoirs, paiements.
--
-- Statut stocké : brouillon -> emise -> annulee (par avoir total).
-- « envoyée », « partiellement payée », « payée », « en retard » sont DÉRIVÉS
-- (envoyee_le, somme des paiements, échéance) dans la vue v_factures : pas de
-- statut qui diverge de la réalité des encaissements.
--
-- Montants : toujours positifs ; le sens d''un avoir est donné par son type.
-- Une facture émise n''est ni modifiable ni supprimable, même par appel direct.
-- =============================================================================

create type public.type_facture as enum (''acompte'', ''situation'', ''finale'', ''libre'', ''avoir'')","create type public.statut_facture as enum (''brouillon'', ''emise'', ''annulee'')","create table public.factures (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  type                    public.type_facture not null,
  client_id               uuid not null,
  chantier_id             uuid,
  devis_id                uuid,
  facture_origine_id      uuid,              -- avoir : facture corrigée
  -- Nature de l''avoir : « correction » (erreur, annulation : la somme reste
  -- à facturer) ou « reduction » (geste commercial : la somme est abandonnée,
  -- elle diminue définitivement le montant à facturer du devis).
  nature_avoir            text check (nature_avoir in (''correction'', ''reduction'')),

  -- Cycle de vie (colonnes réservées aux fonctions)
  numero                  text,
  statut                  public.statut_facture not null default ''brouillon'',
  date_emission           date,
  date_echeance           date,
  envoyee_le              timestamptz,
  annulee_le              timestamptz,

  -- Contenu
  date_prestation_debut   date,
  date_prestation_fin     date,
  delai_paiement_jours    integer not null check (delai_paiement_jours between 0 and 365),
  regime_tva              public.regime_tva not null,
  autoliquidation         boolean not null default false,
  avancement_bp           integer check (avancement_bp is null or avancement_bp between 0 and 10000),
  acompte_pct_bp          integer check (acompte_pct_bp is null or acompte_pct_bp between 0 and 10000),
  remise_globale_bp       integer not null default 0 check (remise_globale_bp between 0 and 10000),
  notes_client            text,

  total_ht_cents          bigint not null default 0 check (total_ht_cents >= 0),
  total_tva_cents         bigint not null default 0 check (total_tva_cents >= 0),
  total_ttc_cents         bigint not null default 0 check (total_ttc_cents >= 0),
  ventilation_tva         jsonb not null default ''[]''::jsonb,
  -- Facture finale / situation : acomptes déduits, ventilés par taux
  deductions              jsonb not null default ''[]''::jsonb,  -- [{facture_id, numero, ht, tva, ttc}]
  net_a_payer_cents       bigint not null default 0 check (net_a_payer_cents >= 0),

  copie_emetteur          jsonb,
  copie_client            jsonb,
  copie_chantier          jsonb,
  pdf_chemin              text,
  pdf_sha256              text check (pdf_sha256 is null or pdf_sha256 ~ ''^[0-9a-f]{64}$''),
  facturx_chemin          text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (organisation_id, id),
  unique (organisation_id, numero),
  foreign key (organisation_id, client_id) references public.clients (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, facture_origine_id) references public.factures (organisation_id, id) on delete restrict,
  check (total_ttc_cents = total_ht_cents + total_tva_cents),
  check (regime_tva = ''assujetti'' or (total_tva_cents = 0 and not autoliquidation)),
  check (not autoliquidation or total_tva_cents = 0),
  check ((type = ''avoir'') = (facture_origine_id is not null)),
  check ((type = ''avoir'') = (nature_avoir is not null)),
  -- Un avoir n''est rattaché QUE par sa facture d''origine : ni devis ni chantier
  -- propres (sinon il pourrait libérer du « déjà facturé » sur un autre devis).
  check (type <> ''avoir'' or (devis_id is null and chantier_id is null)),
  check (public.ventilation_bien_formee(ventilation_tva)),
  check (public.deductions_bien_formees(deductions)),
  check (type not in (''acompte'', ''situation'', ''finale'') or devis_id is not null),
  check (type <> ''situation'' or avancement_bp is not null),
  check (statut = ''brouillon'' or (numero is not null and date_emission is not null
                                  and date_echeance is not null and pdf_sha256 is not null))
)","create index factures_client_idx on public.factures (organisation_id, client_id)","create index factures_devis_idx on public.factures (organisation_id, devis_id)","create index factures_echeance_idx on public.factures (organisation_id, statut, date_echeance)","create table public.facture_lignes (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null,
  facture_id            uuid not null,
  ordre                 integer not null,
  type                  public.type_ligne not null default ''ligne'',
  designation           text not null,
  description           text,
  quantite_e4           bigint check (quantite_e4 is null or quantite_e4 >= 0),
  unite                 text check (unite is null or unite in (''m2'', ''ml'', ''u'', ''h'', ''forfait'', ''L'', ''kg'')),
  prix_unitaire_ht_cents bigint check (prix_unitaire_ht_cents is null or prix_unitaire_ht_cents >= 0),
  remise_bp             integer not null default 0 check (remise_bp between 0 and 10000),
  taux_tva_bp           integer check (taux_tva_bp is null or taux_tva_bp between 0 and 10000),
  avancement_bp         integer check (avancement_bp is null or avancement_bp between 0 and 10000),
  total_ht_cents        bigint check (total_ht_cents is null or total_ht_cents >= 0),
  devis_ligne_id        uuid,
  unique (organisation_id, id),
  unique (facture_id, ordre),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete cascade,
  foreign key (organisation_id, devis_ligne_id) references public.devis_lignes (organisation_id, id) on delete restrict,
  check (type <> ''ligne'' or (quantite_e4 is not null and unite is not null
                             and prix_unitaire_ht_cents is not null and taux_tva_bp is not null
                             and total_ht_cents is not null)),
  -- R4 : arrondi demi-supérieur, en une seule fois, de
  -- quantité x PU x (1 - remise) x avancement (situation ; 100 % sinon).
  check (type <> ''ligne'' or total_ht_cents = floor(
    (quantite_e4::numeric * prix_unitaire_ht_cents * (10000 - remise_bp) * coalesce(avancement_bp, 10000)
     + 500000000000) / 1000000000000))
)","select public.appliquer_rls_standard(''public.factures'')","select public.appliquer_rls_standard(''public.facture_lignes'')","revoke insert, update on public.factures from authenticated","grant insert (id, organisation_id, type, client_id, chantier_id, devis_id, facture_origine_id, nature_avoir,
              date_prestation_debut, date_prestation_fin, delai_paiement_jours, regime_tva,
              autoliquidation, avancement_bp, acompte_pct_bp, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
  on public.factures to authenticated","grant update (client_id, chantier_id, nature_avoir, date_prestation_debut, date_prestation_fin, delai_paiement_jours,
              regime_tva, autoliquidation, avancement_bp, acompte_pct_bp, remise_globale_bp, notes_client,
              total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
  on public.factures to authenticated","create trigger factures_updated_at before update on public.factures
  for each row execute function public.maj_updated_at()","create trigger factures_audit after insert or update or delete on public.factures
  for each row execute function public.tracer_audit()","create trigger facture_lignes_audit after insert or update or delete on public.facture_lignes
  for each row execute function public.tracer_audit()","create or replace function public.proteger_facture()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  v_modifiables constant text[] := array[''statut'', ''envoyee_le'', ''annulee_le'', ''facturx_chemin'', ''updated_at''];
begin
  if tg_op = ''DELETE'' then
    if old.statut <> ''brouillon'' then
      raise exception ''Une facture émise ne peut pas être supprimée : établissez un avoir.''
        using errcode = ''P0001'';
    end if;
    return old;
  end if;

  if old.statut = ''brouillon'' then
    return new;
  end if;

  if (to_jsonb(new) - v_modifiables) is distinct from (to_jsonb(old) - v_modifiables) then
    raise exception ''Une facture émise ne peut pas être modifiée : établissez un avoir.''
      using errcode = ''P0001'';
  end if;
  if new.statut is distinct from old.statut and not (old.statut = ''emise'' and new.statut = ''annulee'') then
    raise exception ''Changement de statut de facture interdit : % -> %.'', old.statut, new.statut
      using errcode = ''P0001'';
  end if;
  if old.envoyee_le is not null and new.envoyee_le is distinct from old.envoyee_le then
    raise exception ''La date d''''envoi est déjà fixée.'' using errcode = ''P0001'';
  end if;
  if old.facturx_chemin is not null and new.facturx_chemin is distinct from old.facturx_chemin then
    raise exception ''Le fichier Factur-X est déjà fixé.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger factures_protection before update or delete on public.factures
  for each row execute function public.proteger_facture()","create or replace function public.proteger_facture_lignes()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  -- Ancien ET nouveau parent (voir proteger_devis_lignes).
  if exists (
    select 1 from public.factures f
    where f.statut <> ''brouillon''
      and f.id in (case when tg_op <> ''INSERT'' then old.facture_id end,
                   case when tg_op <> ''DELETE'' then new.facture_id end)
  ) then
    raise exception ''Les lignes d''''une facture émise sont figées.'' using errcode = ''P0001'';
  end if;
  return case when tg_op = ''DELETE'' then old else new end;
end;
$$","create trigger facture_lignes_protection before insert or update or delete on public.facture_lignes
  for each row execute function public.proteger_facture_lignes()","-- Une ligne reprise d''un devis ne peut venir que du devis de SA facture (donc
-- du même client) : aucune référence croisée qui bloquerait un effacement.
create or replace function public.controler_ligne_reprise()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if new.devis_ligne_id is not null and not exists (
       select 1 from public.devis_lignes dl
       join public.factures f on f.id = new.facture_id
       where dl.id = new.devis_ligne_id and dl.devis_id = f.devis_id) then
    raise exception ''Une ligne reprise doit provenir du devis de la facture.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger facture_lignes_reprise before insert or update on public.facture_lignes
  for each row execute function public.controler_ligne_reprise()","-- -----------------------------------------------------------------------------
-- Émission d''une facture ou d''un avoir.
-- -----------------------------------------------------------------------------

create or replace function public.emettre_facture(
  p_facture_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text)
returns text
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_f        public.factures%rowtype;
  v_numero   text;
  v_date     date := public.aujourd_hui_paris();
  v_somme    bigint;
  v_devis    public.devis%rowtype;
  v_deja     bigint;
  v_origine  public.factures%rowtype;
  v_avoirs   bigint;
  v_deductions_ttc bigint;
begin
  select * into v_f from public.factures where id = p_facture_id for update;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception ''Facture introuvable.'' using errcode = ''P0002'';
  end if;
  if v_f.statut <> ''brouillon'' then
    raise exception ''Cette facture a déjà été émise.'' using errcode = ''P0001'';
  end if;
  if v_f.delai_paiement_jours > coalesce(
       (select delai_paiement_max_jours from public.parametres_entreprise where organisation_id = v_f.organisation_id), 0) then
    raise exception ''Délai de paiement supérieur au maximum paramétré.'' using errcode = ''P0001'';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme
  from public.facture_lignes where facture_id = p_facture_id and type = ''ligne'';
  if v_somme = 0 then
    raise exception ''Une facture sans ligne chiffrée ne peut pas être émise.'' using errcode = ''P0001'';
  end if;
  -- Même règle que le devis : totaux recontrôlés contre les lignes et la remise.
  perform public.controler_totaux_lignes(
    (select coalesce(jsonb_agg(jsonb_build_object(''taux_bp'', t, ''somme_ht_cents'', m)), ''[]''::jsonb)
     from (select taux_tva_bp as t, sum(total_ht_cents)::bigint as m
           from public.facture_lignes where facture_id = p_facture_id and type = ''ligne''
           group by taux_tva_bp having sum(total_ht_cents) > 0) x),
    v_f.remise_globale_bp,
    -- Autoliquidation : aucune TVA facturée (mention dédiée sur le PDF).
    case when v_f.autoliquidation then ''franchise''::public.regime_tva else v_f.regime_tva end,
    v_f.ventilation_tva, v_f.total_ht_cents, v_f.total_tva_cents);

  -- Verrou du devis AVANT tout contrôle de cumul : deux émissions
  -- simultanées sur le même devis sont sérialisées (pas de sur-facturation,
  -- pas de double déduction).
  if v_f.devis_id is not null then
    select * into v_devis from public.devis where id = v_f.devis_id for update;
  end if;
  -- Verrou des acomptes déduits (ordre stable) : un avoir émis au même
  -- instant sur l''un d''eux (qui, lui, verrouille l''acompte) est sérialisé
  -- avec cette émission, et l''un des deux est refusé.
  perform 1 from public.factures
  where id in (select (d ->> ''facture_id'')::uuid from jsonb_array_elements(v_f.deductions) d)
  order by id
  for update;
  perform public.controler_ventilation(v_f.ventilation_tva, v_f.total_ht_cents, v_f.total_tva_cents,
    case when v_f.autoliquidation then ''franchise''::public.regime_tva else v_f.regime_tva end);

  -- Rattachements cohérents (cause racine des refus de passes 3 et 4 : tout
  -- lien qui alimente un cumul doit être contraint) :
  --   * facture liée à un devis : même client, et même chantier que le devis ;
  --   * facture liée à un chantier : chantier du même client ;
  --   * avoir : même client que sa facture d''origine, qui n''est pas un avoir.
  -- FOR SHARE sur le(s) chantier(s) concerné(s) : voir emettre_devis.
  perform 1 from public.chantiers
  where id = v_f.chantier_id or id = (select chantier_id from public.devis where id = v_f.devis_id)
  order by id for share;
  if v_f.devis_id is not null and exists (
       select 1 from public.devis d where d.id = v_f.devis_id
       and (d.client_id <> v_f.client_id
            or (v_f.chantier_id is not null and d.chantier_id is distinct from v_f.chantier_id))) then
    raise exception ''La facture doit avoir le client et le chantier de son devis.'' using errcode = ''P0001'';
  end if;
  if v_f.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_f.chantier_id and c.client_id <> v_f.client_id) then
    raise exception ''Le chantier de la facture appartient à un autre client.'' using errcode = ''P0001'';
  end if;
  if v_f.type = ''avoir'' and exists (
       select 1 from public.factures o where o.id = v_f.facture_origine_id
       and (o.client_id <> v_f.client_id or o.type = ''avoir'')) then
    raise exception ''Un avoir corrige une facture (pas un avoir) du même client.'' using errcode = ''P0001'';
  end if;

  -- Une ligne reprise d''un devis doit venir du devis ACCEPTÉ de cette facture.
  if exists (
       select 1 from public.facture_lignes fl
       join public.devis_lignes dl on dl.id = fl.devis_ligne_id
       join public.devis d on d.id = dl.devis_id
       where fl.facture_id = p_facture_id
         and (d.statut <> ''accepte'' or d.id is distinct from v_f.devis_id)) then
    raise exception ''Une ligne reprise doit provenir du devis accepté de la facture.'' using errcode = ''P0001'';
  end if;

  -- Situation : chaque ligne porte son avancement (pas de 100 % implicite).
  if v_f.type = ''situation'' and exists (
       select 1 from public.facture_lignes where facture_id = p_facture_id and type = ''ligne'' and avancement_bp is null) then
    raise exception ''Facture de situation : avancement manquant sur une ligne.'' using errcode = ''P0001'';
  end if;

  -- Acomptes déduits : chacun doit être une facture d''acompte ou de situation
  -- ÉMISE, du même devis, déduite pour son montant exact, une seule fois.
  -- (Un avoir qui annule une facture reprend ses déductions : contrôlé plus bas.)
  if jsonb_array_length(v_f.deductions) > 0 and v_f.type <> ''avoir'' then
    if v_f.type not in (''finale'', ''situation'') then
      raise exception ''Seules une facture finale ou de situation déduisent des acomptes.'' using errcode = ''P0001'';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_f.deductions) d
      left join public.factures a on a.id = (d ->> ''facture_id'')::uuid
      where a.id is null
         or v_f.devis_id is null
         or a.organisation_id <> v_f.organisation_id
         or a.devis_id is distinct from v_f.devis_id
         or a.type not in (''acompte'', ''situation'')
         or a.statut <> ''emise''
         or (d ->> ''numero'') is distinct from a.numero
         or (d ->> ''ht'')::bigint is distinct from a.total_ht_cents
         or (d ->> ''tva'')::bigint is distinct from a.total_tva_cents
         or (d ->> ''ttc'')::bigint is distinct from a.total_ttc_cents
    ) then
      raise exception ''Acompte déduit introuvable ou montant différent de la facture d''''acompte.''
        using errcode = ''P0001'';
    end if;
    if (select count(*) from jsonb_array_elements(v_f.deductions))
       <> (select count(distinct (d ->> ''facture_id'')::uuid) from jsonb_array_elements(v_f.deductions) d) then
      raise exception ''Un acompte ne peut être déduit qu''''une fois.'' using errcode = ''P0001'';
    end if;
    if exists (
      select 1 from public.factures autre, jsonb_array_elements(autre.deductions) d
      where autre.organisation_id = v_f.organisation_id and autre.statut = ''emise''   -- une facture annulée libère ses acomptes
        and autre.type <> ''avoir''                                                    -- l''avoir d''annulation les reprend sans les déduire
        and autre.id <> v_f.id
        and (d ->> ''facture_id'')::uuid in (select (e ->> ''facture_id'')::uuid from jsonb_array_elements(v_f.deductions) e)
    ) then
      raise exception ''Cet acompte a déjà été déduit sur une autre facture.'' using errcode = ''P0001'';
    end if;
  end if;

  select coalesce(sum((d ->> ''ttc'')::bigint), 0) into v_deductions_ttc
  from jsonb_array_elements(v_f.deductions) d;
  if v_f.net_a_payer_cents <> v_f.total_ttc_cents - v_deductions_ttc then
    raise exception ''Net à payer incohérent avec les acomptes déduits.'' using errcode = ''P0001'';
  end if;

  -- Factures liées à un devis : uniquement un devis accepté, et jamais plus
  -- que son total accepté (somme des factures émises, avoirs déduits).
  if v_f.devis_id is not null then
    if v_devis.statut <> ''accepte'' then
      raise exception ''Le devis lié n''''est pas accepté.'' using errcode = ''P0001'';
    end if;
    -- Cumul calculé par la SOURCE UNIQUE solde_devis() (voir plus bas).
    select engage_cents into v_deja from public.solde_devis(v_f.devis_id);
    if v_deja + v_f.net_a_payer_cents > v_devis.total_accepte_ttc_cents then
      raise exception ''Le total facturé dépasserait le devis accepté.'' using errcode = ''P0001'';
    end if;
  end if;

  if v_f.type = ''avoir'' then
    select * into v_origine from public.factures where id = v_f.facture_origine_id for update;
    if v_origine.statut <> ''emise'' then
      raise exception ''Un avoir ne peut corriger qu''''une facture émise et non annulée.'' using errcode = ''P0001'';
    end if;
    -- Un avoir porte sur ce qui est DÛ : le net à payer de la facture
    -- d''origine (acomptes déjà déduits), moins les avoirs déjà émis. Le
    -- montant d''un avoir est son NET (égal à son TTC, sauf avoir d''annulation
    -- qui reprend les lignes ET les déductions de l''origine : TVA nette exacte par taux).
    select avoirs_cents into v_avoirs from public.solde_facture(v_origine.id);
    if v_avoirs + v_f.net_a_payer_cents > v_origine.net_a_payer_cents then
      raise exception ''Le total des avoirs dépasserait le net à payer de la facture d''''origine.'' using errcode = ''P0001'';
    end if;
    if jsonb_array_length(v_f.deductions) > 0 and (
         v_avoirs <> 0 or v_f.net_a_payer_cents <> v_origine.net_a_payer_cents
         or v_f.deductions <> v_origine.deductions
         or v_f.total_ttc_cents <> v_origine.total_ttc_cents
         or v_f.ventilation_tva <> v_origine.ventilation_tva) then
      raise exception ''Un avoir qui reprend les acomptes déduits annule toute la facture d''''origine.'' using errcode = ''P0001'';
    end if;
    -- Acompte ou situation : un avoir de CORRECTION l''annule en totalité (une
    -- correction partielle ne pourrait plus être déduite exactement ensuite).
    if v_origine.type in (''acompte'', ''situation'') and v_f.nature_avoir = ''correction''
       and v_avoirs + v_f.net_a_payer_cents <> v_origine.net_a_payer_cents then
      raise exception ''Une facture d''''acompte ou de situation se corrige par un avoir total (puis une nouvelle facture).'' using errcode = ''P0001'';
    end if;
    -- Un acompte déduit par une facture encore valable ne se corrige pas
    -- directement : il faut d''abord annuler la facture qui le déduit.
    if exists (
      select 1 from public.factures autre, jsonb_array_elements(autre.deductions) d
      where autre.organisation_id = v_f.organisation_id and autre.statut = ''emise'' and autre.type <> ''avoir''
        and (d ->> ''facture_id'')::uuid = v_origine.id) then
      raise exception ''Cet acompte est déduit sur une facture en cours : annulez d''''abord cette facture.''
        using errcode = ''P0001'';
    end if;
    v_numero := public.prochain_numero(v_f.organisation_id, ''AVO'', extract(year from v_date)::integer);
  else
    v_numero := public.prochain_numero(v_f.organisation_id, ''FAC'', extract(year from v_date)::integer);
  end if;

  update public.factures set
    numero = v_numero,
    statut = ''emise'',
    date_emission = v_date,
    date_echeance = v_date + v_f.delai_paiement_jours,
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_facture_id;

  -- Avoirs = net à payer : la facture d''origine est annulée (ses acomptes
  -- déduits sont alors libérés pour la facture qui la remplacera).
  if v_f.type = ''avoir'' and v_avoirs + v_f.net_a_payer_cents = v_origine.net_a_payer_cents then
    update public.factures set statut = ''annulee'', annulee_le = now() where id = v_origine.id;
  end if;

  return v_numero;
end;
$$","create or replace function public.marquer_facture_envoyee(p_facture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.factures where id = p_facture_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Facture introuvable.'' using errcode = ''P0002'';
  end if;
  update public.factures set envoyee_le = coalesce(envoyee_le, now())
  where id = p_facture_id and statut <> ''brouillon'';
end;
$$","-- -----------------------------------------------------------------------------
-- Paiements : registre en ajout seul. Une erreur se corrige par une écriture
-- d''annulation (montant opposé) qui référence le paiement annulé.
-- Un paiement rattaché à un AVOIR est un remboursement versé au client : il
-- apparaît en négatif dans le livre des recettes.
-- -----------------------------------------------------------------------------

create type public.mode_paiement as enum (''virement'', ''cheque'', ''especes'', ''carte'', ''stripe'')","create table public.paiements (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  facture_id            uuid not null,
  date_paiement         date not null,
  montant_cents         bigint not null check (montant_cents <> 0),
  mode                  public.mode_paiement not null,
  reference             text,
  notes                 text,
  annule_paiement_id    uuid unique,
  stripe_evenement_id   text unique,                 -- idempotence des webhooks
  cree_par              uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict,
  foreign key (organisation_id, annule_paiement_id) references public.paiements (organisation_id, id) on delete restrict,
  check ((montant_cents < 0) = (annule_paiement_id is not null))
)","create index paiements_facture_idx on public.paiements (organisation_id, facture_id)","create index paiements_date_idx on public.paiements (organisation_id, date_paiement)","alter table public.paiements enable row level security","create policy paiements_lecture on public.paiements
  for select to authenticated using (public.est_membre(organisation_id))","create policy paiements_ajout on public.paiements
  for insert to authenticated with check (public.est_membre(organisation_id))","-- Ni UPDATE ni DELETE : aucune politique, et trigger en défense.
create trigger paiements_audit after insert on public.paiements
  for each row execute function public.tracer_audit()","-- =============================================================================
-- SOURCE UNIQUE DES CUMULS (refonte phase 0, cause racine des refus 3 à 5).
-- Tous les montants cumulés (dû, payé, remboursé, reste, trop-perçu, déjà
-- facturé, reste à facturer) sont calculés ICI et nulle part ailleurs :
-- emettre_facture, controler_paiement, v_factures et v_chantiers les lisent.
-- Base commune : le NET À PAYER (une finale ne recompte jamais les acomptes
-- qu''elle déduit), les avoirs étant plafonnés à ce net.
-- =============================================================================

-- Solde d''une facture (hors avoir).
--   dû          = net à payer - avoirs émis
--   reste       = dû - payé                       (jamais négatif)
--   trop-perçu  = payé - dû                       (jamais négatif)
--   à rembourser = trop-perçu - déjà remboursé sur ses avoirs
create or replace function public.solde_facture(p_facture_id uuid)
returns table (du_cents bigint, avoirs_cents bigint, paye_cents bigint, rembourse_cents bigint,
               reste_a_payer_cents bigint, trop_percu_cents bigint, reste_a_rembourser_cents bigint)
language sql
stable
set search_path = ''''
as $$
  with f as (select net_a_payer_cents as net from public.factures where id = p_facture_id and type <> ''avoir''),
  a as (select coalesce(sum(net_a_payer_cents), 0)::bigint as s from public.factures
        where facture_origine_id = p_facture_id and statut <> ''brouillon''),
  p as (select coalesce(sum(montant_cents), 0)::bigint as s from public.paiements where facture_id = p_facture_id),
  r as (select coalesce(sum(pp.montant_cents), 0)::bigint as s
        from public.paiements pp join public.factures av on av.id = pp.facture_id
        where av.facture_origine_id = p_facture_id)
  select greatest(0, f.net - a.s)::bigint, a.s, p.s, r.s,
         greatest(0, f.net - a.s - p.s)::bigint,
         greatest(0, p.s - (f.net - a.s))::bigint,
         greatest(0, greatest(0, p.s - (f.net - a.s)) - r.s)::bigint
  from f, a, p, r;
$$","-- Solde d''un devis.
--   engagé = somme des nets des factures émises du devis (annulées comprises)
--            - avoirs de CORRECTION sur ces factures.
--   Un avoir de RÉDUCTION (geste commercial) ne libère rien : la somme
--   abandonnée ne se refacture pas.
--   reste à facturer = total accepté - engagé (jamais négatif).
create or replace function public.solde_devis(p_devis_id uuid)
returns table (accepte_ttc_cents bigint, engage_cents bigint, reste_a_facturer_cents bigint)
language sql
stable
set search_path = ''''
as $$
  with d as (select coalesce(total_accepte_ttc_cents, 0)::bigint as accepte from public.devis where id = p_devis_id),
  fac as (select id, net_a_payer_cents from public.factures
          where devis_id = p_devis_id and statut <> ''brouillon'' and type <> ''avoir''),
  e as (select coalesce((select sum(net_a_payer_cents) from fac), 0)
             - coalesce((select sum(av.net_a_payer_cents) from public.factures av
                         where av.facture_origine_id in (select id from fac)
                           and av.statut <> ''brouillon'' and av.nature_avoir = ''correction''), 0) as engage)
  select d.accepte, e.engage::bigint, greatest(0, d.accepte - e.engage)::bigint
  from d, e;
$$","-- Solde d''un avoir : remboursé sur CET avoir, et reste à rembourser
-- (plafonné à l''avoir et au trop-perçu réel de la facture d''origine).
create or replace function public.solde_avoir(p_avoir_id uuid)
returns table (rembourse_cents bigint, reste_a_rembourser_cents bigint)
language sql
stable
set search_path = ''''
as $$
  with a as (select net_a_payer_cents, facture_origine_id from public.factures where id = p_avoir_id and type = ''avoir''),
  p as (select coalesce(sum(montant_cents), 0)::bigint as s from public.paiements where facture_id = p_avoir_id)
  select p.s,
         greatest(0, least(a.net_a_payer_cents - p.s, so.reste_a_rembourser_cents))::bigint
  from a, p, lateral public.solde_facture(a.facture_origine_id) so;
$$","create or replace function public.controler_paiement()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  v_f       public.factures%rowtype;
  v_s       record;
  v_annule  public.paiements%rowtype;
begin
  if tg_op <> ''INSERT'' then
    raise exception ''Un paiement enregistré ne se modifie pas : saisissez une annulation.''
      using errcode = ''P0001'';
  end if;

  select * into v_f from public.factures where id = new.facture_id for update;
  if v_f.statut = ''brouillon'' then
    raise exception ''Un paiement ne peut être rattaché qu''''à une facture émise.'' using errcode = ''P0001'';
  end if;

  -- Annulation d''une écriture erronée : possible même sur une facture annulée,
  -- sauf si elle rendait « trop remboursé » ce qui a déjà été remboursé.
  if new.annule_paiement_id is not null then
    select * into v_annule from public.paiements where id = new.annule_paiement_id;
    if v_annule.facture_id <> new.facture_id or v_annule.montant_cents <> -new.montant_cents
       or v_annule.montant_cents <= 0 then
      raise exception ''L''''annulation doit reprendre exactement le paiement annulé.'' using errcode = ''P0001'';
    end if;
    if v_f.type <> ''avoir'' then
      select * into v_s from public.solde_facture(v_f.id);
      if v_s.rembourse_cents > greatest(0, v_s.paye_cents + new.montant_cents - v_s.du_cents) then
        raise exception ''Annulation impossible : le client a déjà été remboursé de ce montant. Annulez d''''abord le remboursement.''
          using errcode = ''P0001'';
      end if;
    end if;
    return new;
  end if;

  if v_f.statut <> ''emise'' then
    raise exception ''Un paiement ne peut être rattaché qu''''à une facture émise.'' using errcode = ''P0001'';
  end if;

  if v_f.type = ''avoir'' then
    -- Remboursement : plafonné à l''avoir ET au trop-perçu réel de l''origine.
    perform 1 from public.factures where id = v_f.facture_origine_id for update;
    select * into v_s from public.solde_avoir(v_f.id);
    if new.montant_cents > v_s.reste_a_rembourser_cents then
      raise exception ''Ce remboursement dépasse ce que le client a payé en trop (ou le montant de l''''avoir).''
        using errcode = ''P0001'';
    end if;
    return new;
  end if;

  select * into v_s from public.solde_facture(v_f.id);
  if new.montant_cents > v_s.reste_a_payer_cents then
    raise exception ''Ce paiement dépasse le reste à payer.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger paiements_controle before insert or update or delete on public.paiements
  for each row execute function public.controler_paiement()","-- Vue avec les états dérivés, lus dans la source unique.
create view public.v_factures with (security_invoker = true) as
select f.*,
  case when f.type = ''avoir'' then sa.rembourse_cents else s.paye_cents end as paye_cents,
  coalesce(s.avoirs_cents, 0) as avoirs_cents,
  coalesce(s.reste_a_payer_cents, 0) as reste_a_payer_cents,
  case when f.type = ''avoir'' then sa.reste_a_rembourser_cents else 0::bigint end as reste_a_rembourser_cents,
  case
    when f.statut <> ''emise'' then f.statut::text
    when f.type = ''avoir'' then ''emise''
    when s.reste_a_payer_cents = 0 then ''payee''
    when f.date_echeance < public.aujourd_hui_paris() then ''en_retard''
    when s.paye_cents > 0 then ''partiellement_payee''
    when f.envoyee_le is not null then ''envoyee''
    else ''emise''
  end as statut_affiche
from public.factures f
left join lateral public.solde_facture(f.id) s on f.type <> ''avoir''
left join lateral public.solde_avoir(f.id) sa on f.type = ''avoir''"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000650', 'liens_publics', '{"-- =============================================================================
-- H''DECOR : liens publics (consultation / signature à distance du devis,
-- consultation de facture).
--
-- * Seule l''empreinte SHA-256 du jeton est stockée : une fuite de la base ne
--   donne aucun lien utilisable. Jeton : 32 octets aléatoires (256 bits).
-- * Le document est référencé par devis_id OU facture_id, avec clé étrangère
--   COMPOSITE (organisation_id, …) : un lien ne peut viser qu''un document de
--   sa propre organisation (correctif audit sécurité phase 0, critique 1).
-- * Les fonctions par jeton ne sont exécutables que par le rôle service : le
--   serveur Next les appelle après avoir relevé l''IP réelle de la requête.
-- * Durée maximale d''un lien : 90 jours (limite de sécurité, pas une règle
--   métier ; la durée choisie dans l''interface est plus courte).
-- =============================================================================

create table public.liens_publics (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  devis_id          uuid,
  facture_id        uuid,
  finalite          text not null check (finalite in (''consultation'', ''signature'')),
  jeton_sha256      text not null unique check (jeton_sha256 ~ ''^[0-9a-f]{64}$''),
  expire_le         timestamptz not null,
  utilise_le        timestamptz,
  revoque_le        timestamptz,
  cree_le           timestamptz not null default now(),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict,
  check ((devis_id is null) <> (facture_id is null)),
  check (finalite = ''consultation'' or devis_id is not null),
  check (expire_le > cree_le and expire_le <= cree_le + interval ''90 days'')
)","create index liens_publics_devis_idx on public.liens_publics (devis_id)","create index liens_publics_facture_idx on public.liens_publics (facture_id)","alter table public.liens_publics enable row level security","create policy liens_lecture on public.liens_publics
  for select to authenticated using (public.est_membre(organisation_id))","create policy liens_ajout on public.liens_publics
  for insert to authenticated with check (public.est_membre(organisation_id))","create policy liens_revocation on public.liens_publics
  for update to authenticated using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id))","-- L''API ne choisit ni cree_le, ni utilise_le, ni revoque_le à la création, et
-- ne peut modifier que revoque_le.
revoke insert, update, delete, truncate on public.liens_publics from authenticated","grant insert (organisation_id, devis_id, facture_id, finalite, jeton_sha256, expire_le)
  on public.liens_publics to authenticated","grant update (revoque_le) on public.liens_publics to authenticated","create or replace function public.proteger_lien_public()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if tg_op = ''INSERT'' then
    -- Un brouillon n''a pas de lien public.
    if exists (select 1 from public.devis where id = new.devis_id and statut = ''brouillon'')
       or exists (select 1 from public.factures where id = new.facture_id and statut = ''brouillon'') then
      raise exception ''Un brouillon ne peut pas être partagé.'' using errcode = ''P0001'';
    end if;
    return new;
  end if;
  if old.revoque_le is not null and new.revoque_le is distinct from old.revoque_le then
    raise exception ''Une révocation est définitive.'' using errcode = ''P0001'';
  end if;
  if old.utilise_le is not null and new.utilise_le is distinct from old.utilise_le then
    raise exception ''Un lien utilisé le reste.'' using errcode = ''P0001'';
  end if;
  if (to_jsonb(new) - array[''revoque_le'', ''utilise_le'']) is distinct from (to_jsonb(old) - array[''revoque_le'', ''utilise_le'']) then
    raise exception ''Un lien public ne se modifie pas.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger liens_publics_protection before insert or update on public.liens_publics
  for each row execute function public.proteger_lien_public()","create or replace function public.lien_valide(p_jeton text, p_finalite text)
returns public.liens_publics
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_lien public.liens_publics%rowtype;
begin
  if p_jeton is null or length(p_jeton) < 43 then
    raise exception ''Lien invalide ou expiré.'' using errcode = ''P0002'';
  end if;
  select * into v_lien from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, ''sha256''), ''hex'')
    and finalite = p_finalite;
  if not found or v_lien.revoque_le is not null or v_lien.expire_le < now()
     or (v_lien.finalite = ''signature'' and v_lien.utilise_le is not null) then
    -- Même message dans tous les cas : aucune information sur la cause.
    raise exception ''Lien invalide ou expiré.'' using errcode = ''P0002'';
  end if;
  return v_lien;
end;
$$","create or replace function public.devis_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_lien  public.liens_publics%rowtype;
  v_devis public.devis%rowtype;
begin
  begin
    v_lien := public.lien_valide(p_jeton, ''signature'');
  exception when sqlstate ''P0002'' then
    v_lien := public.lien_valide(p_jeton, ''consultation'');
  end;
  -- Défense en profondeur : même organisation que le lien (déjà garanti par la FK).
  select * into v_devis from public.devis
  where id = v_lien.devis_id and organisation_id = v_lien.organisation_id;
  if not found or v_devis.statut = ''brouillon'' then
    raise exception ''Lien invalide ou expiré.'' using errcode = ''P0002'';
  end if;
  if v_devis.consulte_le is null then
    update public.devis set consulte_le = now() where id = v_devis.id;
  end if;
  return jsonb_build_object(
    ''devis_id'', v_devis.id, ''numero'', v_devis.numero, ''version'', v_devis.version,
    ''statut'', v_devis.statut, ''pdf_chemin'', v_devis.pdf_chemin, ''pdf_sha256'', v_devis.pdf_sha256,
    ''peut_signer'', v_lien.finalite = ''signature'' and v_devis.statut = ''envoye'',
    ''organisation_id'', v_devis.organisation_id);
end;
$$","create or replace function public.signer_devis_par_jeton(
  p_jeton text, p_nom text, p_mention text, p_image_chemin text, p_document_sha256 text,
  p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_sig  uuid;
begin
  perform 1 from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, ''sha256''), ''hex'')
  for update;                                   -- usage unique, même en double clic
  v_lien := public.lien_valide(p_jeton, ''signature'');
  if not exists (select 1 from public.devis
                 where id = v_lien.devis_id and organisation_id = v_lien.organisation_id) then
    raise exception ''Lien invalide ou expiré.'' using errcode = ''P0002'';
  end if;
  v_sig := public.signer_devis_interne(v_lien.devis_id, ''lien'', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_options, p_ip, p_user_agent);
  update public.liens_publics set utilise_le = now() where id = v_lien.id;
  return v_sig;
end;
$$","create or replace function public.facture_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_f    public.v_factures%rowtype;
begin
  v_lien := public.lien_valide(p_jeton, ''consultation'');
  select * into v_f from public.v_factures
  where id = v_lien.facture_id and organisation_id = v_lien.organisation_id;
  if not found or v_f.statut = ''brouillon'' then
    raise exception ''Lien invalide ou expiré.'' using errcode = ''P0002'';
  end if;
  return jsonb_build_object(
    ''facture_id'', v_f.id, ''numero'', v_f.numero, ''type'', v_f.type,
    ''pdf_chemin'', v_f.pdf_chemin, ''pdf_sha256'', v_f.pdf_sha256,
    ''date_echeance'', v_f.date_echeance, ''reste_a_payer_cents'', v_f.reste_a_payer_cents,
    ''organisation_id'', v_f.organisation_id);
end;
$$","revoke execute on function public.lien_valide(text, text) from public, anon, authenticated","revoke execute on function public.devis_par_jeton(text) from public, anon, authenticated","revoke execute on function public.facture_par_jeton(text) from public, anon, authenticated","revoke execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  from public, anon, authenticated","grant execute on function public.devis_par_jeton(text) to service_role","grant execute on function public.facture_par_jeton(text) to service_role","grant execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  to service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000700', 'pilotage_documents', '{"-- =============================================================================
-- H''DECOR : relances, comptabilité simplifiée, planning, documents de chantier,
-- PV de réception, photos.
-- =============================================================================

-- Modèles de messages (relances devis, impayés niveaux 1 à 3, avis client)
create table public.modeles_messages (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null check (code in (''relance_devis'', ''impaye_1'', ''impaye_2'', ''impaye_3'',
                                                  ''envoi_devis'', ''envoi_facture'', ''demande_avis'')),
  sujet             text not null,
  corps             text not null,
  delai_jours       integer check (delai_jours is null or delai_jours between 0 and 365),
  actif             boolean not null default true,
  unique (organisation_id, code)
)","select public.appliquer_rls_standard(''public.modeles_messages'')","-- Historique des envois (email ou message), y compris relances.
create table public.envois (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  document_type     text not null check (document_type in (''devis'', ''facture'', ''pv_reception'', ''liste_achat'')),
  document_id       uuid not null,
  nature            text not null check (nature in (''envoi'', ''relance_devis'', ''impaye_1'', ''impaye_2'', ''impaye_3'', ''demande_avis'')),
  canal             text not null check (canal in (''email'', ''manuel'')),
  destinataire      text,
  fournisseur_id    text,              -- identifiant Resend
  statut            text not null default ''envoye'' check (statut in (''envoye'', ''echec'')),
  erreur            text,
  envoye_le         timestamptz not null default now()
)","create index envois_doc_idx on public.envois (document_type, document_id, envoye_le desc)","alter table public.envois enable row level security","create policy envois_lecture on public.envois
  for select to authenticated using (public.est_membre(organisation_id))","create policy envois_ajout on public.envois
  for insert to authenticated with check (public.est_membre(organisation_id))","-- Registre des achats
create table public.categories_depenses (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  libelle           text not null,
  unique (organisation_id, id),
  unique (organisation_id, libelle)
)","select public.appliquer_rls_standard(''public.categories_depenses'')","create table public.depenses (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  date_depense        date not null,
  fournisseur         text not null,
  libelle             text,
  categorie_id        uuid,
  chantier_id         uuid,
  montant_ht_cents    bigint not null check (montant_ht_cents >= 0),
  tva_cents           bigint not null default 0 check (tva_cents >= 0),
  montant_ttc_cents   bigint not null check (montant_ttc_cents >= 0),
  mode_paiement       public.mode_paiement,
  justificatif_chemin text,
  created_at          timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, categorie_id) references public.categories_depenses (organisation_id, id) on delete restrict,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  check (montant_ttc_cents = montant_ht_cents + tva_cents)
)","create index depenses_date_idx on public.depenses (organisation_id, date_depense)","select public.appliquer_rls_standard(''public.depenses'')","create trigger depenses_audit after insert or update or delete on public.depenses
  for each row execute function public.tracer_audit()","create table public.materiel (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  libelle           text not null,
  date_achat        date,
  valeur_cents      bigint check (valeur_cents is null or valeur_cents >= 0),
  depense_id        uuid,
  notes             text,
  foreign key (organisation_id, depense_id) references public.depenses (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.materiel'')","-- Planning et rappels
create table public.evenements (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid,
  type              text not null check (type in (''chantier'', ''sechage'', ''rappel'', ''rendez_vous'')),
  titre             text not null,
  debut             timestamptz not null,
  fin               timestamptz not null,
  journee_entiere   boolean not null default false,
  notes             text,
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  check (fin >= debut)
)","create index evenements_periode_idx on public.evenements (organisation_id, debut)","select public.appliquer_rls_standard(''public.evenements'')","-- Rappels et notifications (§5.9) : début de chantier, séchage entre couches,
-- relance devis, échéance facture. Envoyés par le cron ; le canal est une
-- décision humaine en attente (application seule par défaut).
create table public.rappels (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in (''debut_chantier'', ''sechage'', ''relance_devis'', ''echeance_facture'', ''libre'')),
  echeance          timestamptz not null,
  titre             text not null,
  canal             text not null default ''application'' check (canal in (''application'', ''email'', ''push'')),
  chantier_id       uuid,
  evenement_id      uuid,
  document_type     text check (document_type is null or document_type in (''devis'', ''facture'')),
  document_id       uuid,
  envoye_le         timestamptz,
  lu_le             timestamptz,
  statut            text not null default ''a_envoyer'' check (statut in (''a_envoyer'', ''envoye'', ''echec'', ''annule'')),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, evenement_id) references public.evenements (organisation_id, id) on delete cascade,
  check ((document_type is null) = (document_id is null))
)","create index rappels_echeance_idx on public.rappels (statut, echeance)","select public.appliquer_rls_standard(''public.rappels'')","-- Photos et documents de chantier
create table public.photos (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  piece_id          uuid,
  moment            text not null default ''autre'' check (moment in (''avant'', ''pendant'', ''apres'', ''autre'')),
  chemin            text not null,
  annotations       jsonb,
  legende           text,
  prise_le          timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  foreign key (organisation_id, piece_id) references public.pieces (organisation_id, id) on delete set null (piece_id)
)","select public.appliquer_rls_standard(''public.photos'')","create table public.documents_chantier (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  type              text not null check (type in (''fiche_technique'', ''attestation'', ''assurance'', ''plan'', ''autre'')),
  nom               text not null,
  chemin            text not null,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
)","select public.appliquer_rls_standard(''public.documents_chantier'')","create table public.checklists_fin_chantier (
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  items             jsonb not null default ''[]''::jsonb,   -- [{libelle, fait, fait_le}]
  primary key (organisation_id, chantier_id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade
)","select public.appliquer_rls_standard(''public.checklists_fin_chantier'')","-- PV de réception
create table public.pv_reception (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  date_reception    date not null,
  avec_reserves     boolean not null default false,
  reserves          jsonb not null default ''[]''::jsonb,   -- [{description, photo_id, levee_le}]
  signature_id      uuid,
  pdf_chemin        text,
  pdf_sha256        text check (pdf_sha256 is null or pdf_sha256 ~ ''^[0-9a-f]{64}$''),
  created_at        timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete restrict,
  foreign key (organisation_id, signature_id) references public.signatures (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.pv_reception'')","create trigger pv_reception_audit after insert or update or delete on public.pv_reception
  for each row execute function public.tracer_audit()","-- Attestations simplifiées de TVA à taux réduit (assujetti uniquement).
create table public.attestations_tva (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  devis_id          uuid not null,
  -- Le taux doit exister dans taux_tva avec attestation_requise (contrôlé par
  -- le serveur) ; aucun taux légal codé en dur.
  taux_bp           integer not null,
  signature_id      uuid,
  pdf_chemin        text,
  created_at        timestamptz not null default now(),
  foreign key (organisation_id, taux_bp) references public.taux_tva (organisation_id, taux_bp) on delete restrict,
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, signature_id) references public.signatures (organisation_id, id) on delete restrict
)","select public.appliquer_rls_standard(''public.attestations_tva'')","-- -----------------------------------------------------------------------------
-- PV de réception et attestations de TVA : documents SIGNÉS figés.
-- * l''API ne pose ni signature_id, ni pdf_chemin, ni pdf_sha256 (privilèges
--   de colonne) : seules les fonctions de signature (Phase 7) le feront ;
-- * la signature rattachée doit être celle de CE document (type et id) ;
-- * dès qu''une signature est posée : ni modification, ni suppression.
-- -----------------------------------------------------------------------------
revoke insert, update on public.pv_reception from authenticated","grant insert (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves)
  on public.pv_reception to authenticated","grant update (date_reception, avec_reserves, reserves) on public.pv_reception to authenticated","revoke insert, update on public.attestations_tva from authenticated","grant insert (id, organisation_id, devis_id, taux_bp) on public.attestations_tva to authenticated","grant update (taux_bp) on public.attestations_tva to authenticated","create or replace function public.proteger_document_signe()
returns trigger
language plpgsql
set search_path = ''''
as $$
declare
  v_type text := case tg_table_name when ''pv_reception'' then ''pv_reception'' else ''attestation_tva'' end;
begin
  if tg_op in (''UPDATE'', ''DELETE'') and old.signature_id is not null then
    raise exception ''Un document signé ne se modifie ni ne se supprime.'' using errcode = ''P0001'';
  end if;
  -- Une attestation ne se signe que pour un devis émis (envoyé ou accepté) :
  -- jamais sur un brouillon, qui doit rester supprimable (effacement RGPD).
  if tg_table_name = ''attestations_tva'' and tg_op in (''INSERT'', ''UPDATE'') and new.signature_id is not null
     and not exists (select 1 from public.devis d where d.id = (to_jsonb(new) ->> ''devis_id'')::uuid
                     and d.statut in (''envoye'', ''accepte'')) then
    raise exception ''Une attestation ne se signe que pour un devis envoyé ou accepté.'' using errcode = ''P0001'';
  end if;
  if tg_op in (''INSERT'', ''UPDATE'') and new.signature_id is not null and not exists (
       select 1 from public.signatures s
       where s.id = new.signature_id and s.organisation_id = new.organisation_id
         and s.document_type = v_type and s.document_id = new.id) then
    raise exception ''Cette signature ne correspond pas à ce document.'' using errcode = ''P0001'';
  end if;
  return case when tg_op = ''DELETE'' then old else new end;
end;
$$","create trigger pv_reception_signe before insert or update or delete on public.pv_reception
  for each row execute function public.proteger_document_signe()","create trigger attestations_tva_signee before insert or update or delete on public.attestations_tva
  for each row execute function public.proteger_document_signe()","-- -----------------------------------------------------------------------------
-- Livre des recettes : généré depuis les encaissements (vue, jamais saisi).
-- -----------------------------------------------------------------------------
create view public.v_livre_recettes with (security_invoker = true) as
select p.organisation_id, p.date_paiement,
       case when f.type = ''avoir'' then -p.montant_cents else p.montant_cents end as montant_cents,
       case when f.type = ''avoir'' then ''remboursement'' else ''encaissement'' end as nature,
       p.mode, p.reference,
       f.numero as facture_numero, f.id as facture_id,
       coalesce(f.copie_client ->> ''nom_affiche'', '''') as client
from public.paiements p
join public.factures f on f.id = p.facture_id","-- Références polymorphes (envois, rappels) : le document visé doit exister
-- dans la MÊME organisation (pas de FK possible sur une colonne polymorphe).
create or replace function public.verifier_document_meme_org()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_ok boolean;
begin
  if new.document_id is null then
    return new;
  end if;
  v_ok := case new.document_type
    when ''devis'' then exists (select 1 from public.devis where id = new.document_id and organisation_id = new.organisation_id)
    when ''facture'' then exists (select 1 from public.factures where id = new.document_id and organisation_id = new.organisation_id)
    when ''pv_reception'' then exists (select 1 from public.pv_reception where id = new.document_id and organisation_id = new.organisation_id)
    when ''liste_achat'' then exists (select 1 from public.chantiers where id = new.document_id and organisation_id = new.organisation_id)
    else false end;
  if not v_ok then
    raise exception ''Document introuvable.'' using errcode = ''P0002'';
  end if;
  return new;
end;
$$","create trigger envois_document before insert or update on public.envois
  for each row execute function public.verifier_document_meme_org()","create trigger rappels_document before insert or update on public.rappels
  for each row execute function public.verifier_document_meme_org()","-- Statut de chantier, lu dans la SOURCE UNIQUE (solde_devis, solde_facture) :
--   * reste à facturer = somme des restes à facturer des devis ACCEPTÉS du
--     chantier. Une facture « libre » (travaux supplémentaires) ne solde pas
--     un devis (décision P23) ;
--   * reste à payer = somme des restes des factures émises du chantier
--     (liées au devis ou au chantier).
--   « terminé » (à facturer) tant qu''un devis n''est pas entièrement facturé
--   ou que rien n''est facturé ; « facturé » tant qu''il reste à payer ;
--   « payé » sinon.
create view public.v_chantiers with (security_invoker = true) as
with dv as (
  select d.chantier_id, sd.accepte_ttc_cents, sd.engage_cents, sd.reste_a_facturer_cents
  from public.devis d, lateral public.solde_devis(d.id) sd
  where d.statut = ''accepte'' and d.chantier_id is not null
),
fa as (
  select c.id as ch_id, f.id, sf.reste_a_payer_cents
  from public.chantiers c
  join public.factures f
    on f.statut = ''emise'' and f.type <> ''avoir''
   and (f.chantier_id = c.id or f.devis_id in (select d.id from public.devis d where d.chantier_id = c.id))
  cross join lateral public.solde_facture(f.id) sf
)
select c.*,
  coalesce((select sum(accepte_ttc_cents) from dv where dv.chantier_id = c.id), 0)::bigint as accepte_ttc_cents,
  coalesce((select sum(engage_cents) from dv where dv.chantier_id = c.id), 0)::bigint as engage_cents,
  coalesce((select sum(reste_a_facturer_cents) from dv where dv.chantier_id = c.id), 0)::bigint as reste_a_facturer_cents,
  coalesce((select sum(reste_a_payer_cents) from fa where fa.ch_id = c.id), 0)::bigint as reste_a_payer_cents,
  case
    when c.statut <> ''termine'' then c.statut::text
    when coalesce((select sum(reste_a_facturer_cents) from dv where dv.chantier_id = c.id), 0) > 0 then ''termine''
    when not exists (select 1 from public.factures f
                     where f.statut <> ''brouillon'' and f.type <> ''avoir''
                       and (f.chantier_id = c.id or f.devis_id in (select d.id from public.devis d where d.chantier_id = c.id)))
      then ''termine''
    when coalesce((select sum(reste_a_payer_cents) from fa where fa.ch_id = c.id), 0) > 0 then ''facture''
    else ''paye''
  end as statut_affiche
from public.chantiers c","-- -----------------------------------------------------------------------------
-- Client d''un chantier FIGÉ dès qu''un document non brouillon y est rattaché
-- (devis émis ou facture émise, directement ou via un devis du chantier) :
-- les cumuls par chantier et l''anonymisation reposent sur ce lien.
-- -----------------------------------------------------------------------------
create or replace function public.proteger_client_chantier()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if new.client_id is distinct from old.client_id and (
       exists (select 1 from public.devis d where d.chantier_id = old.id and d.statut <> ''brouillon'')
       or exists (select 1 from public.factures f where f.chantier_id = old.id and f.statut <> ''brouillon'')) then
    raise exception ''Ce chantier porte des documents émis : son client ne peut plus changer.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","create trigger chantiers_client_fige before update on public.chantiers
  for each row execute function public.proteger_client_chantier()"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261008000800', 'stockage_droits', E'{"-- =============================================================================
-- H''DECOR : stockage des fichiers et droits finaux.
--
-- Tous les buckets sont PRIVÉS. Convention de chemin :
--   <organisation_id>/<...>/<uuid aléatoire>.<ext>
-- Le premier segment détermine l''accès. Les PDF émis et les signatures ne
-- sont jamais ni remplacés ni supprimés (aucune politique UPDATE / DELETE).
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  (''documents'',     ''documents'',     false, 10485760, array[''application/pdf'', ''application/xml'']),
  (''signatures'',    ''signatures'',    false,   524288, array[''image/png'']),
  (''photos'',        ''photos'',        false, 15728640, array[''image/jpeg'', ''image/png'', ''image/webp'', ''image/heic'']),
  (''justificatifs'', ''justificatifs'', false, 15728640, array[''image/jpeg'', ''image/png'', ''image/webp'', ''application/pdf'']),
  -- Pas de SVG (contenu actif) : PNG / JPEG seulement, signature binaire
  -- vérifiée par le serveur avant dépôt.
  (''marque'',        ''marque'',        false,  2097152, array[''image/png'', ''image/jpeg''])
on conflict (id) do nothing","create or replace function public.organisation_du_chemin(p_nom text)
returns uuid
language plpgsql
immutable
set search_path = ''''
as $$
begin
  return split_part(p_nom, ''/'', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$","-- Lecture : tous les buckets de l''organisation.
create policy hdecor_lecture on storage.objects for select to authenticated
  using (bucket_id in (''documents'', ''signatures'', ''photos'', ''justificatifs'', ''marque'')
         and public.est_membre(public.organisation_du_chemin(name)))","-- Ajout : tous les buckets de l''organisation.
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in (''documents'', ''signatures'', ''photos'', ''justificatifs'', ''marque'')
              and public.est_membre(public.organisation_du_chemin(name)))","-- Remplacement / suppression : uniquement photos, justificatifs, logo.
-- Jamais les documents émis ni les signatures.
create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id in (''photos'', ''justificatifs'', ''marque'')
         and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id in (''photos'', ''justificatifs'', ''marque'')
              and public.est_membre(public.organisation_du_chemin(name)))","create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id in (''photos'', ''justificatifs'', ''marque'')
         and public.est_membre(public.organisation_du_chemin(name)))","-- -----------------------------------------------------------------------------
-- Chemins de fichiers : toujours sous le dossier de l''organisation de la
-- ligne. Empêche de faire servir le fichier d''une autre organisation par une
-- page publique (URL signée avec la clé de service).
-- -----------------------------------------------------------------------------
create or replace function public.chemin_de_l_organisation(p_chemin text, p_organisation_id uuid)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select p_chemin is null
      or (p_chemin like p_organisation_id::text || ''/%'' and position(''..'' in p_chemin) = 0);
$$","alter table public.parametres_entreprise add constraint logo_chemin_org check (public.chemin_de_l_organisation(logo_chemin, organisation_id))","alter table public.assurances add constraint attestation_chemin_org check (public.chemin_de_l_organisation(attestation_chemin, organisation_id))","alter table public.devis add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id))","alter table public.factures add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id))","alter table public.factures add constraint facturx_chemin_org check (public.chemin_de_l_organisation(facturx_chemin, organisation_id))","alter table public.signatures add constraint image_chemin_org check (public.chemin_de_l_organisation(image_chemin, organisation_id))","alter table public.signatures add constraint pdf_signe_chemin_org check (public.chemin_de_l_organisation(pdf_signe_chemin, organisation_id))","alter table public.pv_reception add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id))","alter table public.attestations_tva add constraint pdf_chemin_org check (public.chemin_de_l_organisation(pdf_chemin, organisation_id))","alter table public.photos add constraint chemin_org check (public.chemin_de_l_organisation(chemin, organisation_id))","alter table public.documents_chantier add constraint chemin_org check (public.chemin_de_l_organisation(chemin, organisation_id))","alter table public.depenses add constraint justificatif_chemin_org check (public.chemin_de_l_organisation(justificatif_chemin, organisation_id))","-- -----------------------------------------------------------------------------
-- Paiements : l''API ne choisit ni l''auteur, ni l''identifiant Stripe ; le mode
-- « stripe » est réservé au webhook signé (rôle service).
-- -----------------------------------------------------------------------------
revoke insert on public.paiements from authenticated","grant insert (organisation_id, facture_id, date_paiement, montant_cents, mode, reference, notes, annule_paiement_id)
  on public.paiements to authenticated","create or replace function public.paiement_origine()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if current_user in (''authenticated'', ''anon'') then
    if new.mode = ''stripe'' then
      raise exception ''Un paiement Stripe n''''est enregistré que par le webhook.'' using errcode = ''P0001'';
    end if;
    new.cree_par := auth.uid();
  end if;
  return new;
end;
$$","create trigger paiements_origine before insert on public.paiements
  for each row execute function public.paiement_origine()","-- Historique des prix : écrit uniquement par le trigger (definer).
revoke insert, update, delete, truncate on public.historique_prix from authenticated","-- -----------------------------------------------------------------------------
-- Anonymisation d''un client (droit à l''effacement), dans les limites de
-- l''obligation de conservation :
--   * EFFACÉ : fiche client ; chantiers (nom, adresse, notes) ; pièces
--     (notes) ; planning, rappels, temps passés, check-lists (textes) ;
--     envois (destinataire) ; PV de réception non signés ; brouillons de
--     devis et de factures (supprimés : ils n''ont pas de numéro) ;
--   * devis émis JAMAIS acceptés : copies, objet et textes des lignes
--     remplacés par des valeurs constantes, liens publics révoqués, devis
--     encore « envoyé » passé à « refusé » (il ne peut plus être signé) ;
--     leurs PDF sont renvoyés pour suppression du stockage ;
--   * photos et documents de chantier : lignes supprimées, chemins renvoyés ;
--   * CONSERVÉ : factures émises, devis acceptés, signatures, PV signés
--     (obligation légale, durée À VÉRIFIER par le comptable).
-- Le journal d''audit ne contient aucun texte libre (liste blanche) : rien à
-- y expurger.
-- Renvoie la liste des fichiers que le serveur doit supprimer du stockage.
-- -----------------------------------------------------------------------------
create or replace function public.anonymiser_client(p_client_id uuid)
returns setof text
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
  v_chantiers uuid[];
  v_devis_non_acceptes uuid[];
begin
  select organisation_id into v_org from public.clients where id = p_client_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Client introuvable.'' using errcode = ''P0002'';
  end if;
  select coalesce(array_agg(id), ''{}'') into v_chantiers from public.chantiers where client_id = p_client_id;

  update public.clients set
    civilite = null, nom = ''Client anonymisé'', prenom = null, raison_sociale = null,
    siret = null, tva_intra = null, email = null, telephone = null,
    fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
    notes = null, source = null, anonymise_le = now()
  where id = p_client_id;

  update public.chantiers set
    nom = ''Chantier anonymisé'', adresse_ligne1 = null, adresse_ligne2 = null,
    code_postal = null, ville = null, notes = null
  where id = any (v_chantiers);
  update public.pieces set notes = null, nom = ''Pièce'', etage = null where chantier_id = any (v_chantiers);
  update public.elements set notes = null
  where piece_id in (select id from public.pieces where chantier_id = any (v_chantiers));
  update public.evenements set titre = ''Événement'', notes = null where chantier_id = any (v_chantiers);
  update public.rappels set titre = ''Rappel''
  where chantier_id = any (v_chantiers)
     or evenement_id in (select id from public.evenements where chantier_id = any (v_chantiers))
     or (document_type = ''devis'' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = ''facture'' and document_id in (select id from public.factures where client_id = p_client_id));
  update public.temps_passes set tache = null, note = null where chantier_id = any (v_chantiers);
  update public.checklists_fin_chantier set items = ''[]''::jsonb where chantier_id = any (v_chantiers);
  update public.envois set destinataire = null, erreur = null
  where (document_type = ''pv_reception'' and document_id in (select id from public.pv_reception where chantier_id = any (v_chantiers)))
     or (document_type = ''devis'' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = ''facture'' and document_id in (select id from public.factures where client_id = p_client_id))
     or (document_type = ''liste_achat'' and document_id = any (v_chantiers));

  -- PV non signés et attestations de devis jamais acceptés : supprimés,
  -- leurs PDF renvoyés pour suppression du stockage.
  return query delete from public.pv_reception
    where chantier_id = any (v_chantiers) and signature_id is null and pdf_chemin is not null returning pdf_chemin;
  delete from public.pv_reception where chantier_id = any (v_chantiers) and signature_id is null;
  -- (Une attestation SIGNÉE est conservée comme preuve : elle est figée, et
  -- sa durée de conservation est À VÉRIFIER par le comptable.)
  return query delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> ''accepte'')
      and signature_id is null and pdf_chemin is not null returning pdf_chemin;
  delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> ''accepte'')
      and signature_id is null;

  -- Brouillons : supprimés (aucun numéro attribué, aucune obligation).
  delete from public.factures where client_id = p_client_id and statut = ''brouillon'';
  delete from public.devis d where d.client_id = p_client_id and d.statut = ''brouillon''
    and not exists (select 1 from public.devis v where v.devis_precedent_id = d.id);

  -- Devis émis jamais acceptés.
  select coalesce(array_agg(id), ''{}'') into v_devis_non_acceptes
  from public.devis where client_id = p_client_id and statut in (''envoye'', ''refuse'', ''remplace'');

  -- Tous les liens publics des documents du client sont révoqués (devis ET
  -- factures) : plus aucune consultation de PDF nominatif par lien.
  update public.liens_publics set revoque_le = now()
  where revoque_le is null
    and (devis_id in (select id from public.devis where client_id = p_client_id)
         or facture_id in (select id from public.factures where client_id = p_client_id));

  -- 1) un devis encore « envoyé » passe à « refusé » (il ne peut plus être signé) ;
  -- 2) puis les devis refusés / remplacés perdent tous leurs textes libres.
  update public.devis set statut = ''refuse'', refuse_le = now(), motif_refus = ''Anonymisation (RGPD)''
  where id = any (v_devis_non_acceptes) and statut = ''envoye'';
  perform set_config(''hdecor.anonymisation'', ''on'', true);
  update public.devis set
    copie_client = ''{\\"nom_affiche\\": \\"Client anonymisé\\"}''::jsonb, copie_chantier = ''{}''::jsonb, objet = null,
    notes_client = null, conditions_paiement = null, delai_debut_texte = null,
    motif_refus = case when statut = ''refuse'' then ''Anonymisation (RGPD)'' end
  where id = any (v_devis_non_acceptes);
  update public.devis_lignes set designation = ''Prestation (anonymisée)'', description = null, origine = null
  where devis_id = any (v_devis_non_acceptes);
  update public.devis_echeances set libelle = ''Échéance (anonymisée)''
  where devis_id = any (v_devis_non_acceptes);
  perform set_config(''hdecor.anonymisation'', ''off'', true);

  return query select pdf_chemin from public.devis where id = any (v_devis_non_acceptes) and pdf_chemin is not null;
  return query delete from public.photos where chantier_id = any (v_chantiers) returning chemin;
  return query delete from public.documents_chantier where chantier_id = any (v_chantiers) returning chemin;
end;
$$","-- -----------------------------------------------------------------------------
-- Droits : le rôle anonyme n''a accès à rien dans le schéma public.
-- Les pages publiques passent par le serveur et les fonctions par jeton.
-- PostgreSQL accorde EXECUTE à PUBLIC par défaut : on le retire, puis on
-- accorde explicitement, puis on retire les fonctions internes.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon","revoke all on all sequences in schema public from anon","alter default privileges in schema public revoke all on tables from anon","alter default privileges in schema public revoke all on sequences from anon","revoke execute on all functions in schema public from public, anon","grant execute on all functions in schema public to authenticated, service_role","-- Toute FUTURE fonction est fermée par défaut : chaque migration accorde
-- explicitement ce qui doit être appelable depuis l''API.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated","-- EXECUTE à PUBLIC est un défaut GLOBAL (pas par schéma) : il faut le retirer
-- aussi à ce niveau, sinon authenticated en hérite via PUBLIC.
alter default privileges revoke execute on functions from public","-- Les privilèges par défaut ne valent que pour le rôle qui les pose : on les
-- pose aussi pour le propriétaire réel des objets sur Supabase (postgres).
-- Filet de sécurité permanent : le test de la liste exacte des fonctions
-- SECURITY DEFINER appelables par une session, exécuté en CI.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated","alter default privileges for role postgres revoke execute on functions from public","-- (ventilation_attendue reste appelable : fonction pure, sans accès aux
-- données, utile pour vérifier un aperçu.)
-- Internes (triggers, contrôles, numérotation) et réservées au serveur
-- (liens publics) : jamais appelables par une session utilisateur.
revoke execute on function
  public.maj_updated_at(),
  public.appliquer_rls_standard(regclass),
  public.interdire_modification_journal(),
  public.tracer_audit(),
  public.prochain_numero(uuid, text, integer),
  public.historiser_prix(),
  public.proteger_devis(),
  public.proteger_devis_lignes(),
  public.controler_ventilation(jsonb, bigint, bigint, public.regime_tva),
  public.proteger_signature(),
  public.signer_devis_interne(uuid, text, text, text, text, text, uuid[], inet, text),
  public.lien_valide(text, text),
  public.devis_par_jeton(text),
  public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text),
  public.facture_par_jeton(text),
  public.proteger_lien_public(),
  public.controler_totaux_lignes(jsonb, integer, public.regime_tva, jsonb, bigint, bigint),
  public.lignes_devis_par_taux(uuid, uuid[]),
  public.audit_sans_donnees_perso(jsonb),
  public.purger_journal_audit(timestamptz),
  public.paiement_origine(),
  public.proteger_client_chantier(),
  public.proteger_document_signe(),
  public.controler_ligne_reprise(),
  public.verifier_document_meme_org(),
  public.proteger_facture(),
  public.proteger_facture_lignes(),
  public.controler_paiement()
from authenticated","-- Tables en ajout seul : on retire le privilège lui-même, pas seulement la
-- politique RLS (défense en profondeur ; une erreur explicite vaut mieux
-- qu''une mise à jour silencieusement sans effet).
revoke insert, update, delete, truncate on public.signatures, public.journal_audit, public.sequences_documents
  from authenticated","revoke update, delete, truncate on public.paiements from authenticated","-- envois : en ajout seul (seule l''anonymisation, en definer, efface le destinataire).
revoke update, delete, truncate on public.envois from authenticated","revoke delete, truncate on public.liens_publics from authenticated","revoke truncate on all tables in schema public from authenticated, service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000100', 'initialisation_organisation', '{"-- =============================================================================
-- H''DECOR (Phase 1) : création atomique d''une organisation pour un compte.
-- Appelée par scripts/creer-compte.ts avec la clé de service (rôle serveur
-- uniquement). Tout ou rien : organisation, membre, paramètres et taux de TVA
-- proposés (tous À VÉRIFIER).
-- =============================================================================
create or replace function public.initialiser_organisation(
  p_user_id uuid, p_raison_sociale text, p_nom_dirigeant text, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception ''Compte inconnu.'' using errcode = ''P0002'';
  end if;
  if exists (select 1 from public.membres where user_id = p_user_id) then
    raise exception ''Ce compte est déjà rattaché à une organisation.'' using errcode = ''P0001'';
  end if;
  if coalesce(length(trim(p_raison_sociale)), 0) = 0 then
    raise exception ''Raison sociale requise.'' using errcode = ''P0001'';
  end if;

  insert into public.organisations (nom) values (trim(p_raison_sociale)) returning id into v_org;
  insert into public.membres (organisation_id, user_id, role) values (v_org, p_user_id, ''proprietaire'');
  insert into public.parametres_entreprise (organisation_id, raison_sociale, nom_dirigeant, email)
  values (v_org, trim(p_raison_sociale), nullif(trim(p_nom_dirigeant), ''''), nullif(trim(p_email), ''''));
  insert into public.taux_tva (organisation_id, taux_bp, libelle, attestation_requise, a_verifier) values
    (v_org, 0,    ''0 % (franchise en base ou exonération)'', false, true),
    (v_org, 550,  ''5,5 %'', true,  true),
    (v_org, 1000, ''10 %'',  true,  true),
    (v_org, 2000, ''20 %'',  false, true);
  return v_org;
end;
$$","revoke execute on function public.initialiser_organisation(uuid, text, text, text) from public, anon, authenticated","grant execute on function public.initialiser_organisation(uuid, text, text, text) to service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000200', 'double_authentification_rls', '{"-- =============================================================================
-- H''DECOR (Phase 1) : la double authentification est imposée PAR LA BASE.
--
-- Sans cela, un utilisateur qui a activé le code TOTP mais ne s''est connecté
-- qu''avec son mot de passe (session « aal1 ») pourrait appeler l''API de
-- données directement et tout lire : la vérification de l''application ne
-- suffit pas. Règle : si le compte a au moins un facteur VÉRIFIÉ, la session
-- doit être de niveau aal2 pour être reconnue membre de son organisation.
-- Comme toutes les politiques RLS et les fonctions métier passent par
-- est_membre(), la règle s''applique partout d''un coup.
-- =============================================================================
create or replace function public.niveau_auth_suffisant()
returns boolean
language sql
stable
security definer
set search_path = ''''
as $$
  select coalesce(auth.jwt() ->> ''aal'', ''aal1'') = ''aal2''
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status::text = ''verified'');
$$","revoke execute on function public.niveau_auth_suffisant() from public, anon, authenticated","create or replace function public.est_membre(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''''
as $$
  select exists (
    select 1
    from public.membres m
    where m.organisation_id = p_organisation_id
      and m.user_id = (select auth.uid())
  ) and public.niveau_auth_suffisant();
$$"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000300', 'clients_recherche_conservation', E'{"-- =============================================================================
-- H''DECOR (Phase 1) : recherche de clients et conservation des prospects.
-- =============================================================================

-- Texte « à plat » pour la recherche : minuscules, sans accents.
create or replace function public.texte_recherche(p text)
returns text
language sql
immutable
set search_path = ''''
as $$
  -- Ligatures développées (« Lætitia » est trouvée par « laetitia »).
  select translate(replace(replace(lower(coalesce(p, '''')), ''œ'', ''oe''), ''æ'', ''ae''),
    ''àâäáãåçéèêëíìîïñóòôöõúùûüýÿ'',
    ''aaaaaaceeeeiiiinooooouuuuyy'');
$$","-- Recherche instantanée (nom, prénom, raison sociale, email, téléphone,
-- ville). SECURITY INVOKER : la RLS s''applique. Le texte saisi n''est jamais
-- interprété comme une syntaxe de filtre (paramètre de fonction).
create or replace function public.rechercher_clients(
  p_texte text default null,
  p_type public.type_client default null,
  p_inclure_anonymises boolean default false,
  p_limite integer default 50,
  p_decalage integer default 0)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''''
as $$
  select c.*
  from public.clients c
  where (p_inclure_anonymises or c.anonymise_le is null)
    and (p_type is null or c.type = p_type)
    and (
      coalesce(trim(p_texte), '''') = ''''
      or public.texte_recherche(concat_ws('' '', c.nom, c.prenom, c.raison_sociale, c.email,
           regexp_replace(coalesce(c.telephone, ''''), ''\\\\D'', '''', ''g''), c.fact_ville))
         like ''%'' || replace(replace(replace(public.texte_recherche(trim(p_texte)), ''\\\\'', ''\\\\\\\\''), ''%'', ''\\\\%''), ''_'', ''\\\\_'') || ''%''
      -- Recherche par numéro (« 06 12 », « 06.12 », « +33 6 ») : seulement si
      -- la saisie EST un numéro (au moins 2 chiffres, aucune lettre), sinon
      -- « Dupont 2 » trouverait tous les téléphones contenant un 2.
      -- L''indicatif +33 / 0033 vaut 0 des deux côtés (« +33 6 12 » trouve « 06 12 »).
      or (p_texte ~ ''^[\\\\s\\\\d.+()-]+$'' and length(regexp_replace(p_texte, ''\\\\D'', '''', ''g'')) >= 2
          and regexp_replace(regexp_replace(trim(coalesce(c.telephone, '''')), ''^(\\\\+|00)33'', ''0''), ''\\\\D'', '''', ''g'')
              like ''%'' || regexp_replace(regexp_replace(trim(p_texte), ''^(\\\\+|00)33'', ''0''), ''\\\\D'', '''', ''g'') || ''%'')
    )
  order by c.anonymise_le nulls first, lower(coalesce(c.raison_sociale, c.nom)), lower(coalesce(c.prenom, ''''))
  limit least(greatest(p_limite, 1), 200)
  offset greatest(p_decalage, 0);
$$","-- -----------------------------------------------------------------------------
-- Conservation des prospects (clients sans aucun document ni chantier) :
-- durée paramétrable, À VÉRIFIER (registre des traitements).
-- -----------------------------------------------------------------------------
alter table public.parametres_entreprise
  add column duree_conservation_prospects_mois integer not null default 36
    check (duree_conservation_prospects_mois between 1 and 120)","alter table public.parametres_entreprise
  alter column valeurs_a_verifier set default array[
    ''delai_paiement_jours'', ''delai_paiement_max_jours'', ''indemnite_recouvrement_cents'',
    ''escompte_texte'', ''validite_devis_jours'', ''acompte_pct_defaut_bp'', ''taux_penalites_bp'',
    ''duree_conservation_prospects_mois'']","update public.parametres_entreprise
  set valeurs_a_verifier = array_append(valeurs_a_verifier, ''duree_conservation_prospects_mois'')
  where not (''duree_conservation_prospects_mois'' = any (valeurs_a_verifier))","-- Prospects inactifs au-delà de la durée : anonymisés. Réservé au serveur
-- (tâche planifiée). Renvoie le nombre de clients anonymisés.
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_client record;
  n integer := 0;
begin
  for v_client in
    select c.id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and greatest(c.created_at, c.updated_at) < now() - make_interval(months => p.duree_conservation_prospects_mois)
      and not exists (select 1 from public.devis d where d.client_id = c.id)
      and not exists (select 1 from public.factures f where f.client_id = c.id)
      and not exists (select 1 from public.chantiers ch where ch.client_id = c.id)
  loop
    update public.clients set
      civilite = null, nom = ''Client anonymisé'', prenom = null, raison_sociale = null,
      siret = null, tva_intra = null, email = null, telephone = null,
      fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
      notes = null, source = null, anonymise_le = now()
    where id = v_client.id;
    n := n + 1;
  end loop;
  return n;
end;
$$","revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated","grant execute on function public.purger_prospects_inactifs() to service_role","-- Les privilèges par défaut (migration 0800) ferment toute nouvelle fonction :
-- ouverture explicite des seules fonctions appelables par une session.
grant execute on function public.texte_recherche(text) to authenticated","grant execute on function public.rechercher_clients(text, public.type_client, boolean, integer, integer) to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000400', 'effacement_fichiers', '{"-- =============================================================================
-- H''DECOR (Phase 1) : effacement d''un client sans perte des fichiers à
-- supprimer.
--
-- anonymiser_client renvoie les chemins des fichiers à retirer du stockage.
-- Si le serveur s''arrêtait entre la transaction et la suppression, ces
-- chemins seraient perdus (les lignes qui les portaient sont supprimées) et
-- les fichiers resteraient indéfiniment. effacer_client les inscrit donc dans
-- une file, DANS LA MÊME TRANSACTION ; le serveur la vide ensuite (et la
-- tâche planifiée reprend ce qui a échoué).
-- =============================================================================

create table public.fichiers_a_supprimer (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  chemin           text not null,
  cree_le          timestamptz not null default now(),
  tentatives       integer not null default 0,
  derniere_erreur  text,
  check (public.chemin_de_l_organisation(chemin, organisation_id))
)","-- Invisible pour une session : seul le serveur (service_role) la lit et la
-- vide. Politique explicite réservée à service_role (aucune pour authenticated).
alter table public.fichiers_a_supprimer enable row level security","create policy serveur_uniquement on public.fichiers_a_supprimer for all to service_role
  using (true) with check (true)","revoke all on public.fichiers_a_supprimer from public, anon, authenticated","grant select, insert, update, delete on public.fichiers_a_supprimer to service_role","-- Point d''entrée de l''application pour l''effacement d''un client.
-- Renvoie le nombre de fichiers mis en file.
create or replace function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
  n integer;
begin
  -- anonymiser_client contrôle l''appartenance (est_membre) et verrouille la fiche.
  select organisation_id into v_org from public.clients where id = p_client_id;
  insert into public.fichiers_a_supprimer (organisation_id, chemin)
  select v_org, c from public.anonymiser_client(p_client_id) c;
  get diagnostics n = row_count;
  return n;
end;
$$","revoke execute on function public.effacer_client(uuid) from public, anon","grant execute on function public.effacer_client(uuid) to authenticated, service_role","-- L''application passe obligatoirement par effacer_client : un appel direct
-- d''anonymiser_client par une session perdrait la liste des fichiers.
revoke execute on function public.anonymiser_client(uuid) from authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000500', 'audit_clients_parametres', '{"-- =============================================================================
-- H''DECOR (Phase 1) : journal d''audit étendu aux clients, assurances et taux
-- de TVA. La liste blanche audit_sans_donnees_perso s''applique : pour un
-- client, le journal garde QUI a créé / modifié / anonymisé QUELLE fiche et
-- QUAND, jamais le nom, l''adresse ni le téléphone.
-- =============================================================================
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.tracer_audit()","create trigger assurances_audit after insert or update or delete on public.assurances
  for each row execute function public.tracer_audit()","create trigger taux_tva_audit after insert or update or delete on public.taux_tva
  for each row execute function public.tracer_audit()"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000600', 'corrections_audits_phase1', E'{"-- =============================================================================
-- H''DECOR (Phase 1) : corrections demandées par les audits de fin de phase.
--   1. Fichiers à supprimer : l''espace de stockage est connu et enregistré
--      (plus de suppression « dans tous les espaces »).
--   2. Une seule liste des champs effacés d''une fiche client (anonymisation
--      à la demande ET purge automatique passent par la même fonction).
--   3. Une fiche anonymisée ne peut plus être modifiée, même par l''API.
--   4. Purge des prospects étendue aux clients sans devis accepté ni facture
--      émise, et seulement une fois la durée de conservation confirmée.
--   5. Confirmation des valeurs « À VÉRIFIER » atomique (pas de lecture puis
--      écriture côté serveur).
-- =============================================================================

-- 1. Espaces de stockage ------------------------------------------------------
alter table public.documents_chantier
  add column espace text not null default ''justificatifs'' check (espace in (''documents'', ''justificatifs''))","alter table public.fichiers_a_supprimer
  add column espace text not null default ''documents'' check (espace in (''documents'', ''photos'', ''justificatifs'', ''signatures'', ''marque''))","alter table public.fichiers_a_supprimer alter column espace drop default","create index fichiers_a_supprimer_org_idx on public.fichiers_a_supprimer (organisation_id)","create index fichiers_a_supprimer_reprise_idx on public.fichiers_a_supprimer (tentatives, id)","-- 3. Fiche anonymisée figée ---------------------------------------------------
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if old.anonymise_le is not null then
    raise exception ''Fiche anonymisée : modification impossible.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$","revoke execute on function public.client_anonymise_fige() from public, anon, authenticated","create trigger clients_anonymise_fige before update on public.clients
  for each row execute function public.client_anonymise_fige()","-- 2. Anonymisation : cœur commun ----------------------------------------------
-- Effacement de la fiche elle-même : UNIQUE liste des champs personnels.
create or replace function public.vider_fiche_client(p_client_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  update public.clients set
    civilite = null, nom = ''Client anonymisé'', prenom = null, raison_sociale = null,
    siret = null, tva_intra = null, email = null, telephone = null,
    fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
    notes = null, source = null, consentement_le = null, anonymise_le = now()
  where id = p_client_id;
$$","revoke execute on function public.vider_fiche_client(uuid) from public, anon, authenticated","-- Anonymisation complète SANS contrôle d''appartenance : réservée aux
-- fonctions qui ont déjà contrôlé (effacer_client) ou au serveur (purge).
-- Renvoie l''espace et le chemin de chaque fichier à supprimer du stockage.
drop function public.effacer_client(uuid)","drop function public.anonymiser_client(uuid)","create function public.anonymiser_client_interne(p_client_id uuid)
returns table (espace text, chemin text)
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_chantiers uuid[];
  v_devis_non_acceptes uuid[];
begin
  perform 1 from public.clients where id = p_client_id for update;
  select coalesce(array_agg(id), ''{}'') into v_chantiers from public.chantiers where client_id = p_client_id;

  perform public.vider_fiche_client(p_client_id);

  update public.chantiers set
    nom = ''Chantier anonymisé'', adresse_ligne1 = null, adresse_ligne2 = null,
    code_postal = null, ville = null, notes = null
  where id = any (v_chantiers);
  update public.pieces set notes = null, nom = ''Pièce'', etage = null where chantier_id = any (v_chantiers);
  update public.elements set notes = null
  where piece_id in (select id from public.pieces where chantier_id = any (v_chantiers));
  update public.evenements set titre = ''Événement'', notes = null where chantier_id = any (v_chantiers);
  update public.rappels set titre = ''Rappel''
  where chantier_id = any (v_chantiers)
     or evenement_id in (select id from public.evenements where chantier_id = any (v_chantiers))
     or (document_type = ''devis'' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = ''facture'' and document_id in (select id from public.factures where client_id = p_client_id));
  update public.temps_passes set tache = null, note = null where chantier_id = any (v_chantiers);
  update public.checklists_fin_chantier set items = ''[]''::jsonb where chantier_id = any (v_chantiers);
  update public.envois set destinataire = null, erreur = null
  where (document_type = ''pv_reception'' and document_id in (select id from public.pv_reception where chantier_id = any (v_chantiers)))
     or (document_type = ''devis'' and document_id in (select id from public.devis where client_id = p_client_id))
     or (document_type = ''facture'' and document_id in (select id from public.factures where client_id = p_client_id))
     or (document_type = ''liste_achat'' and document_id = any (v_chantiers));

  -- PV non signés et attestations de devis jamais acceptés : supprimés.
  -- (Une attestation SIGNÉE est conservée comme preuve, durée À VÉRIFIER.)
  return query delete from public.pv_reception p
    where p.chantier_id = any (v_chantiers) and p.signature_id is null and p.pdf_chemin is not null
    returning ''documents''::text, p.pdf_chemin;
  delete from public.pv_reception where chantier_id = any (v_chantiers) and signature_id is null;
  return query delete from public.attestations_tva a
    where a.devis_id in (select id from public.devis where client_id = p_client_id and statut <> ''accepte'')
      and a.signature_id is null and a.pdf_chemin is not null
    returning ''documents''::text, a.pdf_chemin;
  delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> ''accepte'')
      and signature_id is null;

  -- Brouillons : supprimés (aucun numéro attribué, aucune obligation).
  delete from public.factures where client_id = p_client_id and statut = ''brouillon'';
  delete from public.devis d where d.client_id = p_client_id and d.statut = ''brouillon''
    and not exists (select 1 from public.devis v where v.devis_precedent_id = d.id);

  select coalesce(array_agg(id), ''{}'') into v_devis_non_acceptes
  from public.devis where client_id = p_client_id and statut in (''envoye'', ''refuse'', ''remplace'');

  update public.liens_publics set revoque_le = now()
  where revoque_le is null
    and (devis_id in (select id from public.devis where client_id = p_client_id)
         or facture_id in (select id from public.factures where client_id = p_client_id));

  update public.devis set statut = ''refuse'', refuse_le = now(), motif_refus = ''Anonymisation (RGPD)''
  where id = any (v_devis_non_acceptes) and statut = ''envoye'';
  perform set_config(''hdecor.anonymisation'', ''on'', true);
  update public.devis set
    copie_client = ''{\\"nom_affiche\\": \\"Client anonymisé\\"}''::jsonb, copie_chantier = ''{}''::jsonb, objet = null,
    notes_client = null, conditions_paiement = null, delai_debut_texte = null,
    motif_refus = case when statut = ''refuse'' then ''Anonymisation (RGPD)'' end
  where id = any (v_devis_non_acceptes);
  update public.devis_lignes set designation = ''Prestation (anonymisée)'', description = null, origine = null
  where devis_id = any (v_devis_non_acceptes);
  update public.devis_echeances set libelle = ''Échéance (anonymisée)''
  where devis_id = any (v_devis_non_acceptes);
  perform set_config(''hdecor.anonymisation'', ''off'', true);

  return query select ''documents''::text, d.pdf_chemin from public.devis d
    where d.id = any (v_devis_non_acceptes) and d.pdf_chemin is not null;
  return query delete from public.photos ph where ph.chantier_id = any (v_chantiers)
    returning ''photos''::text, ph.chemin;
  return query delete from public.documents_chantier dc where dc.chantier_id = any (v_chantiers)
    returning dc.espace, dc.chemin;
end;
$$","revoke execute on function public.anonymiser_client_interne(uuid) from public, anon, authenticated, service_role","-- Point d''entrée de l''application : contrôle d''appartenance, anonymisation et
-- mise en file des fichiers dans la même transaction.
create function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
  v_anonymise timestamptz;
  n integer;
begin
  select organisation_id, anonymise_le into v_org, v_anonymise from public.clients where id = p_client_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Client introuvable.'' using errcode = ''P0002'';
  end if;
  if v_anonymise is not null then
    raise exception ''Client déjà anonymisé.'' using errcode = ''P0001'';
  end if;
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, f.espace, f.chemin from public.anonymiser_client_interne(p_client_id) f;
  get diagnostics n = row_count;
  return n;
end;
$$","revoke execute on function public.effacer_client(uuid) from public, anon","grant execute on function public.effacer_client(uuid) to authenticated, service_role","-- 4. Purge automatique des prospects ------------------------------------------
-- Client sans facture émise ni devis accepté, sans activité (fiche, devis,
-- chantier) depuis la durée paramétrée. Rien n''est purgé tant que cette
-- durée est encore « À VÉRIFIER » (purge irréversible).
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    select c.id, c.organisation_id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and not (''duree_conservation_prospects_mois'' = any (p.valeurs_a_verifier))
      and not exists (select 1 from public.factures f where f.client_id = c.id and f.statut <> ''brouillon'')
      and not exists (select 1 from public.devis d where d.client_id = c.id and d.statut = ''accepte'')
      and greatest(c.created_at, c.updated_at,
                   (select max(d.updated_at) from public.devis d where d.client_id = c.id),
                   (select max(ch.updated_at) from public.chantiers ch where ch.client_id = c.id))
          < now() - make_interval(months => p.duree_conservation_prospects_mois)
  loop
    insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
    select v.organisation_id, f.espace, f.chemin from public.anonymiser_client_interne(v.id) f;
    n := n + 1;
  end loop;
  return n;
end;
$$","revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated","grant execute on function public.purger_prospects_inactifs() to service_role","-- 5. Confirmation atomique des valeurs « À VÉRIFIER » --------------------------
-- SECURITY INVOKER : la RLS limite la mise à jour à l''organisation du membre.
create or replace function public.confirmer_valeurs(p_organisation_id uuid, p_confirmees text[])
returns boolean
language sql
security invoker
set search_path = ''''
as $$
  with maj as (
    update public.parametres_entreprise
    set valeurs_a_verifier = array(select v from unnest(valeurs_a_verifier) v where v <> all (coalesce(p_confirmees, ''{}'')))
    where organisation_id = p_organisation_id
    returning 1)
  select exists (select 1 from maj);
$$","revoke execute on function public.confirmer_valeurs(uuid, text[]) from public, anon","grant execute on function public.confirmer_valeurs(uuid, text[]) to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261009000700', 'fichiers_chantier_cloisonnes', '{"-- =============================================================================
-- H''DECOR (Phase 1) : faille H1 de l''audit sécurité (boucle 2).
-- Une ligne photos / documents_chantier pouvait pointer vers le PDF d''une
-- facture émise ; l''effacement du client propriétaire de cette ligne mettait
-- alors ce PDF en file de suppression (clé de service : la politique de
-- stockage qui protège les documents émis ne s''appliquait pas).
-- Défenses, de la plus forte à la dernière ligne :
--   1. les fichiers de chantier vivent sous <org>/chantiers/<chantier>/… :
--      ils ne peuvent plus désigner un document émis ;
--   2. leur chemin et leur espace ne sont plus modifiables par une session ;
--   3. un document de chantier ne vit que dans l''espace « justificatifs » ;
--   4. la file refuse tout chemin référencé par un document émis, signé ou
--      accepté, et n''accepte que les espaces documents / photos / justificatifs.
-- =============================================================================

-- 1. Préfixe propre au chantier ------------------------------------------------
create or replace function public.chemin_du_chantier(p_chemin text, p_organisation_id uuid, p_chantier_id uuid)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select p_chemin like p_organisation_id::text || ''/chantiers/'' || p_chantier_id::text || ''/%''
     and position(''..'' in p_chemin) = 0
     and position(''//'' in p_chemin) = 0;
$$","-- Fonction pure appelée par les contraintes CHECK : celles-ci s''évaluent avec
-- les droits de la session qui insère (comme chemin_de_l_organisation).
revoke execute on function public.chemin_du_chantier(text, uuid, uuid) from public, anon","grant execute on function public.chemin_du_chantier(text, uuid, uuid) to authenticated, service_role","alter table public.photos add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id))","alter table public.documents_chantier add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id))","-- 3. Un seul espace pour les documents de chantier ----------------------------
alter table public.documents_chantier drop constraint documents_chantier_espace_check","alter table public.documents_chantier add constraint documents_chantier_espace_check check (espace = ''justificatifs'')","-- 2. Chemin et espace figés après dépôt ----------------------------------------
revoke update on public.photos from authenticated","grant update (piece_id, moment, annotations, legende) on public.photos to authenticated","revoke update on public.documents_chantier from authenticated","grant update (type, nom) on public.documents_chantier to authenticated","-- 4. File de suppression : jamais un document protégé --------------------------
alter table public.fichiers_a_supprimer drop constraint fichiers_a_supprimer_espace_check","alter table public.fichiers_a_supprimer add constraint fichiers_a_supprimer_espace_check
  check (espace in (''documents'', ''photos'', ''justificatifs''))","create or replace function public.fichier_protege(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = ''''
as $$
  select exists (select 1 from public.factures f where p_chemin in (f.pdf_chemin, f.facturx_chemin))
      or exists (select 1 from public.devis d where d.pdf_chemin = p_chemin and d.statut = ''accepte'')
      or exists (select 1 from public.signatures s where p_chemin in (s.image_chemin, s.pdf_signe_chemin))
      or exists (select 1 from public.pv_reception p where p.pdf_chemin = p_chemin and p.signature_id is not null)
      or exists (select 1 from public.attestations_tva a where a.pdf_chemin = p_chemin and a.signature_id is not null);
$$","revoke execute on function public.fichier_protege(text) from public, anon, authenticated","-- Une ligne visant un fichier protégé est écartée (pas d''erreur : l''effacement
-- RGPD du reste doit aboutir) ; l''écart est tracé dans les journaux serveur.
create or replace function public.file_sans_fichier_protege()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if public.fichier_protege(new.chemin) then
    raise warning ''Fichier protégé écarté de la file de suppression (organisation %)'', new.organisation_id;
    return null;
  end if;
  return new;
end;
$$","revoke execute on function public.file_sans_fichier_protege() from public, anon, authenticated","create trigger fichiers_a_supprimer_proteges before insert on public.fichiers_a_supprimer
  for each row execute function public.file_sans_fichier_protege()","-- Relecture : la fiche anonymisée reste figée pour les sessions et la clé de
-- service ; le propriétaire (migrations, fonctions internes) garde la main
-- pour une évolution de schéma (nouvelle colonne à remplir, par exemple).
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if old.anonymise_le is not null and current_user in (''authenticated'', ''anon'', ''service_role'') then
    raise exception ''Fiche anonymisée : modification impossible.'' using errcode = ''P0001'';
  end if;
  return new;
end;
$$"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261010000100', 'metre_calculateur', '{"-- =============================================================================
-- H''DECOR (Phase 2) : métré et calculateur de peinture.
--   1. Paramètres : porte par défaut (83 × 204 cm), formats de pots usuels.
--   2. Postes : type de produit (sans produit du catalogue), majoration de temps.
--   3. Éléments : conversion en m² (largeur développée, surface d''une unité).
--   4. Consommables (rouleaux, bâches, adhésif, abrasif) : lignes paramétrables.
--   5. Valeurs de départ du calcul, toutes « À VÉRIFIER », pour chaque organisation.
--   6. Suppression d''un chantier : seulement sans document, fichiers mis en
--      file de suppression (point B11 reporté de la Phase 1).
-- Les calculs restent dans src/domain ; la base ne stocke que la saisie.
-- =============================================================================

-- 1. Paramètres -----------------------------------------------------------------
alter table public.parametres_entreprise
  add column porte_largeur_mm integer not null default 830 check (porte_largeur_mm between 300 and 3000),
  add column porte_hauteur_mm integer not null default 2040 check (porte_hauteur_mm between 1000 and 4000),
  -- Formats proposés quand aucun produit du catalogue n''est choisi (ml).
  add column formats_pots_ml integer[] not null default array[1000, 2500, 5000, 10000, 15000]
    check (cardinality(formats_pots_ml) between 1 and 10 and 0 < all (formats_pots_ml) and 100000 >= all (formats_pots_ml))","-- 2. Postes ---------------------------------------------------------------------
alter table public.postes_travaux
  add column type_produit text check (type_produit is null or type_produit in (
    ''sous_couche'', ''impression'', ''acrylique'', ''glycero'', ''laque'', ''facade'', ''lasure'', ''vernis'', ''enduit'',
    ''anti_humidite'', ''anti_rouille'', ''sous_couche_bloquante'', ''autre'')),
  -- Hauteur, mobilier, état du support : majoration du temps (20 % -> 2 000).
  add column majoration_temps_bp integer not null default 0 check (majoration_temps_bp between 0 and 50000),
  add column ordre smallint not null default 0,
  add column created_at timestamptz not null default now(),
  add constraint poste_produit_ou_type check (produit_id is not null or type_produit is not null)","create index postes_travaux_piece_idx on public.postes_travaux (organisation_id, piece_id, ordre)","-- 3. Éléments -------------------------------------------------------------------
alter table public.elements
  add column developpe_mm integer check (developpe_mm is null or developpe_mm between 1 and 5000),
  add column surface_unitaire_mm2 bigint check (surface_unitaire_mm2 is null or surface_unitaire_mm2 between 1 and 100000000)","-- 4. Consommables -----------------------------------------------------------------
create table public.consommables (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  libelle             text not null check (length(libelle) between 1 and 200),
  mode                text not null check (mode in (''par_chantier'', ''par_m2'')),
  -- Forfait par chantier, ou prix par m² peint (centimes).
  prix_ht_cents       bigint not null check (prix_ht_cents between 0 and 100000000),
  statut_verification public.statut_verification not null default ''a_verifier'',
  actif               boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organisation_id, id)
)","select public.appliquer_rls_standard(''public.consommables'')","-- 5. Valeurs de départ ----------------------------------------------------------
-- Fourchettes du cahier des charges (§5.4), marquées À VÉRIFIER. Aucun temps
-- de pose ni coefficient n''est inventé : temps vides (à renseigner),
-- coefficients à 1,00 (aucun effet tant qu''ils ne sont pas confirmés).
create or replace function public.initialiser_calcul(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.referentiel_calcul (organisation_id, type_produit, rendement_min, rendement_max)
  values (p_organisation_id, ''sous_couche'', 8, 12), (p_organisation_id, ''impression'', 8, 12),
         (p_organisation_id, ''acrylique'', 10, 12), (p_organisation_id, ''glycero'', 12, 14),
         (p_organisation_id, ''laque'', 12, 14), (p_organisation_id, ''lasure'', 10, 14),
         (p_organisation_id, ''vernis'', 10, 14),
         -- Enduit : valeur de départ du cahier des charges (1 m²/kg par passe), À VÉRIFIER sur la fiche du produit utilisé.
         (p_organisation_id, ''enduit'', 1, 1)
  on conflict do nothing;
  insert into public.coefficients_support (organisation_id, support)
  select p_organisation_id, s from unnest(array[''platre_neuf'', ''ancienne_peinture'', ''beton'', ''enduit'', ''bois_brut'',
    ''bois_vernis'', ''metal'', ''papier_peint'', ''carrelage'', ''autre'']) s
  on conflict do nothing;
  insert into public.etapes_preparation (organisation_id, code, libelle, ordre)
  values (p_organisation_id, ''protection'', ''Protection du chantier (bâches, adhésifs)'', 1),
         (p_organisation_id, ''depose_papier_peint'', ''Dépose de papier peint'', 2),
         (p_organisation_id, ''decapage'', ''Décapage'', 3),
         (p_organisation_id, ''lessivage'', ''Lessivage'', 4),
         (p_organisation_id, ''rebouchage'', ''Rebouchage'', 5),
         (p_organisation_id, ''bande_joint'', ''Bande à joint'', 6),
         (p_organisation_id, ''enduit_1_passe'', ''Enduit (une passe)'', 7),
         (p_organisation_id, ''enduit_2_passes'', ''Enduit (deux passes)'', 8),
         (p_organisation_id, ''poncage'', ''Ponçage'', 9),
         (p_organisation_id, ''impression'', ''Impression ou sous-couche'', 10),
         (p_organisation_id, ''sous_couche_bloquante'', ''Sous-couche bloquante (taches)'', 11)
  on conflict do nothing;
$$","revoke execute on function public.initialiser_calcul(uuid) from public, anon, authenticated","create or replace function public.organisation_initialiser_calcul()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform public.initialiser_calcul(new.id);
  return null;
end;
$$","revoke execute on function public.organisation_initialiser_calcul() from public, anon, authenticated","create trigger organisations_initialiser_calcul after insert on public.organisations
  for each row execute function public.organisation_initialiser_calcul()","-- Organisations existantes.
select public.initialiser_calcul(id) from public.organisations","-- 6. Suppression d''un chantier ----------------------------------------------------
create or replace function public.supprimer_chantier(p_chantier_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
  n integer;
begin
  select organisation_id into v_org from public.chantiers where id = p_chantier_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Chantier introuvable.'' using errcode = ''P0002'';
  end if;
  if exists (select 1 from public.devis where chantier_id = p_chantier_id)
     or exists (select 1 from public.factures where chantier_id = p_chantier_id)
     or exists (select 1 from public.pv_reception where chantier_id = p_chantier_id) then
    raise exception ''Ce chantier a des devis, factures ou un PV : il ne peut pas être supprimé.'' using errcode = ''P0001'';
  end if;
  -- Fichiers de chantier : mis en file AVANT la suppression en cascade.
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, ''photos'', chemin from public.photos where chantier_id = p_chantier_id
  union all
  select v_org, espace, chemin from public.documents_chantier where chantier_id = p_chantier_id;
  get diagnostics n = row_count;
  delete from public.chantiers where id = p_chantier_id;
  return n;
end;
$$","revoke execute on function public.supprimer_chantier(uuid) from public, anon","grant execute on function public.supprimer_chantier(uuid) to authenticated","-- Plus de suppression directe : les fichiers seraient orphelins.
revoke delete on public.chantiers from authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261010000200', 'operations_metre', '{"-- =============================================================================
-- H''DECOR (Phase 2) : opérations atomiques du métré, en SECURITY INVOKER
-- (la RLS de la session s''applique à chaque lecture et écriture).
-- =============================================================================

-- Duplication d''une pièce avec ses ouvertures, éléments, postes et préparations.
create or replace function public.dupliquer_piece(p_piece_id uuid, p_nom text)
returns uuid
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_nouvelle uuid := gen_random_uuid();
  v_correspondance jsonb := ''{}'';
  v_element record;
  v_poste record;
  v_nouvel_element uuid;
  v_nouveau_poste uuid;
begin
  if p_nom is null or length(trim(p_nom)) not between 1 and 100 then
    raise exception ''Nom de pièce invalide.'' using errcode = ''P0001'';
  end if;
  insert into public.pieces (id, organisation_id, chantier_id, nom, etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre)
  select v_nouvelle, organisation_id, chantier_id, trim(p_nom), etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre + 1
  from public.pieces where id = p_piece_id;
  if not found then raise exception ''Pièce introuvable.'' using errcode = ''P0002''; end if;

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
$$","revoke execute on function public.dupliquer_piece(uuid, text) from public, anon","grant execute on function public.dupliquer_piece(uuid, text) to authenticated","-- Étapes de préparation d''un poste : remplacement en une transaction.
create or replace function public.definir_preparations(p_poste_id uuid, p_etapes uuid[])
returns void
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.postes_travaux where id = p_poste_id;
  if v_org is null then raise exception ''Poste introuvable.'' using errcode = ''P0002''; end if;
  delete from public.postes_preparations where poste_id = p_poste_id;
  insert into public.postes_preparations (organisation_id, poste_id, etape_id)
  select v_org, p_poste_id, e from unnest(coalesce(p_etapes, ''{}'')) e;
end;
$$","revoke execute on function public.definir_preparations(uuid, uuid[]) from public, anon","grant execute on function public.definir_preparations(uuid, uuid[]) to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261010000300', 'calcul_corrections_audits', '{"-- =============================================================================
-- H''DECOR (Phase 2) : corrections demandées par l''audit métier peinture.
--   1. Référentiel : une ligne par type de produit (rendement vide = à
--      renseigner) ; séchage avant recouvrement par type.
--   2. Étapes de préparation : matière associée par TYPE de produit (calculée
--      même sans catalogue) et indication « consomme de la matière ».
--   3. Poste : intérieur / extérieur.
--   4. Paramètres : seuil d''alerte de hauteur ; formats de sacs (kg).
--   5. Élément « façade » (pan de mur compté en m²).
-- Toute valeur ajoutée est « À VÉRIFIER » ; aucun rendement ni temps inventé.
-- =============================================================================

-- 1. Référentiel -------------------------------------------------------------
alter table public.referentiel_calcul alter column rendement_min drop not null","alter table public.referentiel_calcul alter column rendement_max drop not null","alter table public.referentiel_calcul drop constraint referentiel_calcul_rendement_min_check","alter table public.referentiel_calcul drop constraint referentiel_calcul_check","alter table public.referentiel_calcul
  add constraint referentiel_rendements check (
    (rendement_min is null and rendement_max is null)
    or (rendement_min > 0 and rendement_max >= rendement_min)),
  -- Séchage avant recouvrement (heures), par type : vide = non pris en compte (signalé).
  add column sechage_recouvrable_h numeric(5, 1) check (sechage_recouvrable_h is null or sechage_recouvrable_h >= 0)","-- 2. Étapes de préparation ----------------------------------------------------
alter table public.etapes_preparation
  add column type_produit text check (type_produit is null or type_produit in (
    ''sous_couche'', ''impression'', ''acrylique'', ''glycero'', ''laque'', ''facade'', ''lasure'', ''vernis'', ''enduit'',
    ''anti_humidite'', ''anti_rouille'', ''sous_couche_bloquante'', ''autre'')),
  add column couches smallint not null default 1 check (couches between 1 and 5),
  -- L''étape consomme de la matière (enduit, impression, décapant…) : si rien ne permet
  -- de la chiffrer, le calcul le signale. Lessive et abrasif relèvent des consommables.
  add column avec_matiere boolean not null default false","-- 3. Poste ---------------------------------------------------------------------
alter table public.postes_travaux add column exterieur boolean not null default false","-- 4. Paramètres ----------------------------------------------------------------
alter table public.parametres_entreprise
  add column hauteur_alerte_mm integer not null default 3000 check (hauteur_alerte_mm between 2000 and 20000),
  -- Formats proposés pour les produits au kg (enduits) quand aucun produit n''est choisi (g).
  add column formats_sacs_g integer[] not null default array[5000, 15000, 25000]
    check (cardinality(formats_sacs_g) between 1 and 10 and 0 < all (formats_sacs_g) and 100000 >= all (formats_sacs_g))","-- 5. Élément façade -------------------------------------------------------------
alter table public.elements drop constraint elements_type_check","alter table public.elements add constraint elements_type_check check (type in (
  ''plinthe'', ''corniche'', ''porte'', ''fenetre'', ''radiateur'', ''volet'', ''escalier'', ''rambarde'', ''facade'', ''autre''))","-- Valeurs de départ (organisations existantes et nouvelles) ----------------------
create or replace function public.initialiser_calcul(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.referentiel_calcul (organisation_id, type_produit, rendement_min, rendement_max)
  values (p_organisation_id, ''sous_couche'', 8, 12), (p_organisation_id, ''impression'', 8, 12),
         (p_organisation_id, ''acrylique'', 10, 12), (p_organisation_id, ''glycero'', 12, 14),
         (p_organisation_id, ''laque'', 12, 14), (p_organisation_id, ''lasure'', 10, 14),
         (p_organisation_id, ''vernis'', 10, 14),
         (p_organisation_id, ''enduit'', 1, 1),
         -- Pas de fourchette dans le cahier des charges : à renseigner.
         (p_organisation_id, ''facade'', null, null), (p_organisation_id, ''anti_humidite'', null, null),
         (p_organisation_id, ''anti_rouille'', null, null), (p_organisation_id, ''sous_couche_bloquante'', null, null),
         (p_organisation_id, ''autre'', null, null)
  on conflict do nothing;
  insert into public.coefficients_support (organisation_id, support)
  select p_organisation_id, s from unnest(array[''platre_neuf'', ''ancienne_peinture'', ''beton'', ''enduit'', ''bois_brut'',
    ''bois_vernis'', ''metal'', ''papier_peint'', ''carrelage'', ''autre'']) s
  on conflict do nothing;
  insert into public.etapes_preparation (organisation_id, code, libelle, ordre, type_produit, couches, avec_matiere)
  values (p_organisation_id, ''protection'', ''Protection du chantier (bâches, adhésifs)'', 1, null, 1, false),
         (p_organisation_id, ''depose_papier_peint'', ''Dépose de papier peint'', 2, null, 1, false),
         (p_organisation_id, ''decapage'', ''Décapage'', 3, null, 1, true),
         (p_organisation_id, ''lessivage'', ''Lessivage'', 4, null, 1, false),
         (p_organisation_id, ''rebouchage'', ''Rebouchage'', 5, null, 1, true),
         (p_organisation_id, ''bande_joint'', ''Bande à joint'', 6, null, 1, true),
         (p_organisation_id, ''enduit_1_passe'', ''Enduit (une passe)'', 7, ''enduit'', 1, true),
         (p_organisation_id, ''enduit_2_passes'', ''Enduit (deux passes)'', 8, ''enduit'', 2, true),
         (p_organisation_id, ''poncage'', ''Ponçage'', 9, null, 1, false),
         (p_organisation_id, ''impression'', ''Impression ou sous-couche'', 10, ''impression'', 1, true),
         (p_organisation_id, ''sous_couche_bloquante'', ''Sous-couche bloquante (taches)'', 11, ''sous_couche_bloquante'', 1, true)
  on conflict do nothing;
$$","revoke execute on function public.initialiser_calcul(uuid) from public, anon, authenticated","-- Organisations existantes : lignes manquantes, puis matière des étapes livrées.
select public.initialiser_calcul(id) from public.organisations","update public.etapes_preparation e set type_produit = v.t, couches = v.c, avec_matiere = v.m
from (values (''decapage'', null, 1, true), (''lessivage'', null, 1, false), (''rebouchage'', null, 1, true),
             (''bande_joint'', null, 1, true), (''enduit_1_passe'', ''enduit'', 1, true), (''enduit_2_passes'', ''enduit'', 2, true),
             (''poncage'', null, 1, false), (''impression'', ''impression'', 1, true), (''sous_couche_bloquante'', ''sous_couche_bloquante'', 1, true))
  as v(code, t, c, m)
where e.code = v.code","-- -----------------------------------------------------------------------------
-- Corrections demandées par la relecture du code
-- -----------------------------------------------------------------------------
-- Durée d''une journée de travail (estimation en jours) : paramétrable.
alter table public.parametres_entreprise
  add column minutes_par_jour integer not null default 420 check (minutes_par_jour between 60 and 1440)","-- Pots sans prix : reste toléré en % du besoin (règle R3), paramétrable.
alter table public.parametres_entreprise
  add column tolerance_reste_bp integer not null default 1000 check (tolerance_reste_bp between 0 and 10000)","-- Version d''un poste (conflit avec un brouillon gardé sur le téléphone).
alter table public.postes_travaux add column updated_at timestamptz not null default now()","create trigger postes_travaux_updated_at before update on public.postes_travaux
  for each row execute function public.maj_updated_at()","-- Lectures par pièce.
create index if not exists ouvertures_piece_idx on public.ouvertures (organisation_id, piece_id)","create index if not exists elements_piece_idx on public.elements (organisation_id, piece_id)","-- Suppression d''un chantier : les dépenses rattachées l''empêchent aussi.
create or replace function public.supprimer_chantier(p_chantier_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_org uuid;
  n integer;
begin
  select organisation_id into v_org from public.chantiers where id = p_chantier_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception ''Chantier introuvable.'' using errcode = ''P0002'';
  end if;
  if exists (select 1 from public.devis where chantier_id = p_chantier_id)
     or exists (select 1 from public.factures where chantier_id = p_chantier_id)
     or exists (select 1 from public.pv_reception where chantier_id = p_chantier_id)
     or exists (select 1 from public.depenses where chantier_id = p_chantier_id) then
    raise exception ''Ce chantier a des devis, factures, dépenses ou un PV : il ne peut pas être supprimé.'' using errcode = ''P0001'';
  end if;
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, ''photos'', chemin from public.photos where chantier_id = p_chantier_id
  union all
  select v_org, espace, chemin from public.documents_chantier where chantier_id = p_chantier_id;
  get diagnostics n = row_count;
  delete from public.chantiers where id = p_chantier_id;
  return n;
end;
$$","revoke execute on function public.supprimer_chantier(uuid) from public, anon","grant execute on function public.supprimer_chantier(uuid) to authenticated","-- -----------------------------------------------------------------------------
-- Corrections demandées par le test terrain
-- -----------------------------------------------------------------------------
-- Teinte en texte libre (« blanc », « RAL 9010 ») tant que le catalogue des
-- teintes n''existe pas : sans elle, la liste d''achat est inutilisable chez le fournisseur.
alter table public.postes_travaux
  add column teinte_libre text check (teinte_libre is null or length(trim(teinte_libre)) between 1 and 80)","-- Duplication d''une pièce : recopie aussi « extérieur » et la teinte libre.
-- p_nouvelle : identifiant fixé par le formulaire ; un nouvel envoi (réponse
-- perdue) renvoie la copie déjà faite au lieu d''en créer une seconde.
drop function public.dupliquer_piece(uuid, text)","create function public.dupliquer_piece(p_piece_id uuid, p_nom text, p_nouvelle uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_nouvelle uuid := coalesce(p_nouvelle, gen_random_uuid());
  v_correspondance jsonb := ''{}'';
  v_element record;
  v_poste record;
  v_nouvel_element uuid;
  v_nouveau_poste uuid;
begin
  if p_nom is null or length(trim(p_nom)) not between 1 and 100 then
    raise exception ''Nom de pièce invalide.'' using errcode = ''P0001'';
  end if;
  if not exists (select 1 from public.pieces where id = p_piece_id) then
    raise exception ''Pièce introuvable.'' using errcode = ''P0002'';
  end if;
  -- Copie déjà faite par un premier envoi (même chantier) : rien à refaire.
  if exists (select 1 from public.pieces n join public.pieces o on o.chantier_id = n.chantier_id
             where n.id = v_nouvelle and o.id = p_piece_id) then
    return v_nouvelle;
  end if;
  insert into public.pieces (id, organisation_id, chantier_id, nom, etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre)
  select v_nouvelle, organisation_id, chantier_id, trim(p_nom), etage, mode_saisie, longueur_mm, largeur_mm, murs_mm,
    surface_sol_mm2, hauteur_mm, etat_support, multiplicateur, teinte_id, notes, ordre + 1
  from public.pieces where id = p_piece_id;

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
$$","revoke execute on function public.dupliquer_piece(uuid, text, uuid) from public, anon","grant execute on function public.dupliquer_piece(uuid, text, uuid) to authenticated","-- Même poste (murs ou plafond) sur d''autres pièces du chantier, en une fois.
-- Identifiant de chaque copie dérivé du poste et de la pièce : un nouvel envoi
-- (réseau coupé après l''enregistrement) ne crée pas de doublon.
create or replace function public.copier_poste(p_poste_id uuid, p_pieces uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_poste public.postes_travaux;
  v_chantier uuid;
  v_piece uuid;
  v_copie uuid;
  n integer := 0;
begin
  select * into v_poste from public.postes_travaux where id = p_poste_id;
  if not found then raise exception ''Poste introuvable.'' using errcode = ''P0002''; end if;
  if v_poste.cible = ''element'' then raise exception ''Un poste sur un élément ne se copie pas vers une autre pièce.'' using errcode = ''P0001''; end if;
  select chantier_id into v_chantier from public.pieces where id = v_poste.piece_id;
  if cardinality(coalesce(p_pieces, ''{}'')) > 100 then raise exception ''Trop de pièces.'' using errcode = ''P0001''; end if;
  foreach v_piece in array coalesce(p_pieces, ''{}'') loop
    if v_piece = v_poste.piece_id then continue; end if;
    if not exists (select 1 from public.pieces where id = v_piece and chantier_id = v_chantier) then
      raise exception ''Pièce introuvable dans ce chantier.'' using errcode = ''P0002'';
    end if;
    -- md5 mis en forme d''UUID valide (version 5, variante RFC 4122) : l''application
    -- refuse tout identifiant qui n''en est pas un (Modifier, Retirer).
    v_copie := overlay(overlay(md5(p_poste_id::text || '':'' || v_piece::text) placing ''5'' from 13 for 1) placing ''8'' from 17 for 1)::uuid;
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
$$","revoke execute on function public.copier_poste(uuid, uuid[]) from public, anon","grant execute on function public.copier_poste(uuid, uuid[]) to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261011000100', 'catalogue_phase3', '{"-- =============================================================================
-- H''DECOR (Phase 3) : catalogue.
--   1. Teintes archivables, produits retrouvables par marque + référence.
--   2. Formats par défaut par TYPE de produit (une laque ne se vend pas en 15 L).
--   3. Lignes d''exemple livrées, marquées « fictif » : aucune référence, aucun
--      prix, aucun rendement inventés.
--   4. Import CSV en une transaction (création ou mise à jour).
--   5. Alerte : prix d''achat changé pour un produit d''un devis en cours.
-- =============================================================================

-- 1. Teintes et produits ---------------------------------------------------------
alter table public.teintes
  add column actif boolean not null default true,
  add column updated_at timestamptz not null default now(),
  -- Un code de teinte est une référence : « vérifié » exige une date et une source, comme un produit.
  add column verifie_le date,
  add column source_verification text,
  add constraint teintes_nom check (length(trim(nom)) between 1 and 100),
  add constraint teintes_verification check (statut_verification <> ''verifie'' or (verifie_le is not null and source_verification is not null))","-- Un format de moins de 100 ml (ou 100 g) est une erreur de saisie (« 0,001 » au lieu de « 1 ») : 10 000 pots.
alter table public.conditionnements add constraint conditionnements_contenance_min check (contenance >= 100)","create trigger teintes_updated_at before update on public.teintes
  for each row execute function public.maj_updated_at()","-- Une référence fabricant n''existe qu''une fois par marque (clé de l''import).
create unique index produits_marque_reference_idx on public.produits
  (organisation_id, lower(trim(marque)), lower(trim(reference_fabricant))) where reference_fabricant is not null","alter table public.produits
  add constraint produits_textes check (
    length(trim(marque)) between 1 and 100 and length(trim(designation)) between 1 and 200
    and (fiche_technique_url is null or fiche_technique_url ~ ''^https?://''))","-- 2. Formats par type -----------------------------------------------------------
-- Vide : les formats généraux (paramètres) s''appliquent. Valeurs : ml ou g.
alter table public.referentiel_calcul
  add column formats_ml integer[] check (formats_ml is null or (
    cardinality(formats_ml) between 1 and 10 and 100 <= all (formats_ml) and 100000 >= all (formats_ml)))","-- 3. Exemples fictifs -------------------------------------------------------------
create or replace function public.initialiser_catalogue(p_organisation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_produit uuid;
begin
  -- Une seule fois : un catalogue déjà rempli n''est pas touché.
  if exists (select 1 from public.produits where organisation_id = p_organisation_id) then return; end if;
  insert into public.produits (organisation_id, marque, designation, type, usages, finition, statut_verification)
  values (p_organisation_id, ''Exemple fictif'', ''Acrylique mat murs et plafonds (exemple fictif, à remplacer)'', ''acrylique'',
          array[''mur'', ''plafond''], ''mat'', ''fictif'')
  returning id into v_produit;
  insert into public.conditionnements (organisation_id, produit_id, contenance)
  values (p_organisation_id, v_produit, 2500), (p_organisation_id, v_produit, 10000);
  insert into public.produits (organisation_id, marque, designation, type, usages, finition, statut_verification)
  values (p_organisation_id, ''Exemple fictif'', ''Laque satinée boiseries (exemple fictif, à remplacer)'', ''laque'',
          array[''boiserie''], ''satin'', ''fictif'')
  returning id into v_produit;
  insert into public.conditionnements (organisation_id, produit_id, contenance)
  values (p_organisation_id, v_produit, 500), (p_organisation_id, v_produit, 2500);
  insert into public.teintes (organisation_id, nom, apercu_hex, statut_verification)
  values (p_organisation_id, ''Blanc (exemple fictif)'', ''#FFFFFF'', ''fictif'');
end;
$$","revoke execute on function public.initialiser_catalogue(uuid) from public, anon, authenticated","create or replace function public.organisation_initialiser_catalogue()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform public.initialiser_catalogue(new.id);
  return null;
end;
$$","revoke execute on function public.organisation_initialiser_catalogue() from public, anon, authenticated","create trigger organisations_initialiser_catalogue after insert on public.organisations
  for each row execute function public.organisation_initialiser_catalogue()","select public.initialiser_catalogue(id) from public.organisations","-- 4. Import CSV -------------------------------------------------------------------
-- p_lignes : tableau JSON déjà validé par le serveur (zod) ; les contraintes de
-- la base revalident les bornes. Clé : marque + référence fabricant, sinon
-- marque + désignation. Une clé (colonne) ABSENTE de la ligne = valeur
-- conservée : un fichier « marque, référence, prix » ne vide pas le reste de
-- la fiche ; de même un prix vide garde le prix actuel. Le statut « vérifié »
-- n''est retiré que si une valeur technique change réellement ; un produit
-- créé par import est « À VÉRIFIER ». Un produit archivé réimporté revient au
-- catalogue. SECURITY INVOKER : la RLS de la session s''applique.
create or replace function public.importer_produits(p_organisation_id uuid, p_lignes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''''
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
    raise exception ''Organisation introuvable.'' using errcode = ''P0002'';
  end if;
  if jsonb_typeof(p_lignes) <> ''array'' or jsonb_array_length(p_lignes) not between 1 and 2000 then
    raise exception ''Import : de 1 à 2 000 lignes.'' using errcode = ''P0001'';
  end if;
  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    v_marque := trim(v_ligne ->> ''marque'');
    v_ref := nullif(trim(coalesce(v_ligne ->> ''reference_fabricant'', '''')), '''');
    v_designation := trim(v_ligne ->> ''designation'');
    -- Décimaux exacts : aucun arrondi silencieux par la colonne numeric.
    if (v_ligne ? ''rendement'' and (v_ligne ->> ''rendement'')::numeric <> round((v_ligne ->> ''rendement'')::numeric, 2))
       or (v_ligne ? ''sechage_h'' and (v_ligne ->> ''sechage_h'')::numeric <> round((v_ligne ->> ''sechage_h'')::numeric, 1)) then
      raise exception ''Import : « % » : décimales en trop.'', v_designation using errcode = ''P0001'';
    end if;
    v_usages := case when v_ligne ? ''usages'' then
      array(select distinct u from jsonb_array_elements_text(v_ligne -> ''usages'') u order by u) end;

    select count(*), min(id::text)::uuid into v_nb, v_id from public.produits
    where organisation_id = p_organisation_id and lower(trim(marque)) = lower(v_marque)
      and case when v_ref is not null then lower(trim(reference_fabricant)) = lower(v_ref)
               else reference_fabricant is null and lower(trim(designation)) = lower(v_designation) end;
    if v_nb > 1 then
      raise exception ''Import : plusieurs produits « % % » sans référence : ajoutez la référence fabricant.'', v_marque, v_designation using errcode = ''P0001'';
    end if;

    if v_id is null then
      insert into public.produits (organisation_id, marque, gamme, reference_fabricant, designation, type, usages, finition,
        unite_mesure, rendement_m2_par_unite, couches_recommandees, sechage_recouvrable_h, fournisseur, fiche_technique_url, statut_verification)
      values (p_organisation_id, v_marque, nullif(trim(v_ligne ->> ''gamme''), ''''), v_ref, v_designation, v_ligne ->> ''type'',
        coalesce(v_usages, ''{}''), v_ligne ->> ''finition'',
        coalesce(v_ligne ->> ''unite_mesure'', case when v_ligne ->> ''type'' = ''enduit'' then ''kg'' else ''L'' end),
        (v_ligne ->> ''rendement'')::numeric, (v_ligne ->> ''couches'')::smallint, (v_ligne ->> ''sechage_h'')::numeric,
        nullif(trim(v_ligne ->> ''fournisseur''), ''''), nullif(trim(v_ligne ->> ''fiche_technique_url''), ''''), ''a_verifier'')
      returning id into v_id;
      v_crees := v_crees + 1;
    else
      select * into v_avant from public.produits where id = v_id;
      if v_ligne ? ''unite_mesure'' and v_ligne ->> ''unite_mesure'' <> v_avant.unite_mesure
         and exists (select 1 from public.conditionnements where produit_id = v_id) then
        raise exception ''Import : « % » : changement d''''unité refusé (ses formats sont en %).'', v_designation, v_avant.unite_mesure using errcode = ''P0001'';
      end if;
      update public.produits set
        designation = v_designation,
        type = v_ligne ->> ''type'',
        gamme = case when v_ligne ? ''gamme'' then nullif(trim(v_ligne ->> ''gamme''), '''') else gamme end,
        usages = coalesce(v_usages, usages),
        finition = case when v_ligne ? ''finition'' then v_ligne ->> ''finition'' else finition end,
        unite_mesure = coalesce(v_ligne ->> ''unite_mesure'', unite_mesure),
        rendement_m2_par_unite = case when v_ligne ? ''rendement'' then (v_ligne ->> ''rendement'')::numeric else rendement_m2_par_unite end,
        couches_recommandees = case when v_ligne ? ''couches'' then (v_ligne ->> ''couches'')::smallint else couches_recommandees end,
        sechage_recouvrable_h = case when v_ligne ? ''sechage_h'' then (v_ligne ->> ''sechage_h'')::numeric else sechage_recouvrable_h end,
        fournisseur = case when v_ligne ? ''fournisseur'' then nullif(trim(v_ligne ->> ''fournisseur''), '''') else fournisseur end,
        fiche_technique_url = case when v_ligne ? ''fiche_technique_url'' then nullif(trim(v_ligne ->> ''fiche_technique_url''), '''') else fiche_technique_url end,
        actif = true
      where id = v_id
      returning * into v_apres;
      -- Valeur technique (ou lien de la fiche, souvent la source de la vérification) changée : la vérification ne vaut plus.
      if (v_apres.designation, v_apres.type, (select array_agg(u order by u) from unnest(v_apres.usages) u), v_apres.finition,
          v_apres.unite_mesure, v_apres.rendement_m2_par_unite, v_apres.couches_recommandees, v_apres.sechage_recouvrable_h, v_apres.gamme,
          v_apres.fiche_technique_url)
         is distinct from
         (v_avant.designation, v_avant.type, (select array_agg(u order by u) from unnest(v_avant.usages) u), v_avant.finition,
          v_avant.unite_mesure, v_avant.rendement_m2_par_unite, v_avant.couches_recommandees, v_avant.sechage_recouvrable_h, v_avant.gamme,
          v_avant.fiche_technique_url) then
        update public.produits set statut_verification = ''a_verifier'', verifie_le = null, source_verification = null where id = v_id;
      end if;
      v_maj := v_maj + 1;
    end if;
    for v_format in select * from jsonb_array_elements(coalesce(v_ligne -> ''formats'', ''[]'')) loop
      insert into public.conditionnements (organisation_id, produit_id, contenance, prix_achat_ht_cents)
      values (p_organisation_id, v_id, (v_format ->> ''contenance'')::integer, (v_format ->> ''prix_cents'')::bigint)
      on conflict (produit_id, contenance) do update
        set prix_achat_ht_cents = coalesce(excluded.prix_achat_ht_cents, public.conditionnements.prix_achat_ht_cents), actif = true;
    end loop;
  end loop;
  return jsonb_build_object(''crees'', v_crees, ''mis_a_jour'', v_maj);
end;
$$","revoke execute on function public.importer_produits(uuid, jsonb) from public, anon","grant execute on function public.importer_produits(uuid, jsonb) to authenticated","-- 5. Alerte de prix ---------------------------------------------------------------
-- Devis en cours (brouillon ou envoyé) dont un achat a été chiffré à un prix
-- différent du prix d''achat actuel du format. Vue en security_invoker : la RLS
-- des tables lues s''applique.
create view public.v_alertes_prix with (security_invoker = true) as
select d.organisation_id, d.id as devis_id, d.numero, d.statut, d.objet,
       p.id as produit_id, p.marque, p.designation, c.id as conditionnement_id, c.contenance, p.unite_mesure,
       a.prix_achat_retenu_cents, c.prix_achat_ht_cents as prix_actuel_cents
from public.devis_achats a
join public.devis d on d.id = a.devis_id and d.organisation_id = a.organisation_id
join public.conditionnements c on c.id = a.conditionnement_id and c.organisation_id = a.organisation_id
join public.produits p on p.id = c.produit_id and p.organisation_id = c.organisation_id
where d.statut in (''brouillon'', ''envoye'')
  and a.prix_achat_retenu_cents is distinct from c.prix_achat_ht_cents","revoke all on public.v_alertes_prix from public, anon","grant select on public.v_alertes_prix to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261012000100', 'devis_phase4', E'{"-- =============================================================================
-- H''DECOR (Phase 4) : devis.
--   1. Numéro prévisionnel : le PDF porte son numéro AVANT l''émission ;
--      emettre_devis vérifie que le numéro et la date attribués sont bien
--      ceux du PDF (sinon tout est annulé : aucun trou dans la numérotation).
--   2. Duplication d''un devis en nouveau brouillon.
--   3. Modèles de messages par défaut (envoi, relance), modifiables.
--   4. Devis à relancer (tâche planifiée, rôle service).
-- =============================================================================

-- 1. Numéro prévisionnel ---------------------------------------------------------
-- SECURITY INVOKER : la session lit son devis et son compteur (RLS).
create or replace function public.numero_devis_previsionnel(p_devis_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''''
as $$
declare
  v_devis public.devis%rowtype;
  v_date  date := public.aujourd_hui_paris();
  v_annee integer := extract(year from v_date)::integer;
  v_n     integer;
begin
  select * into v_devis from public.devis where id = p_devis_id;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  if v_devis.devis_precedent_id is not null then
    return jsonb_build_object(''numero'', (select numero from public.devis where id = v_devis.devis_precedent_id),
                              ''date_emission'', v_date);
  end if;
  select dernier + 1 into v_n from public.sequences_documents
  where organisation_id = v_devis.organisation_id and type = ''DEV'' and annee = v_annee;
  return jsonb_build_object(''numero'', ''DEV-'' || v_annee || ''-'' || lpad(coalesce(v_n, 1)::text, 4, ''0''),
                            ''date_emission'', v_date);
end;
$$","revoke execute on function public.numero_devis_previsionnel(uuid) from public, anon","grant execute on function public.numero_devis_previsionnel(uuid) to authenticated","-- 2. Émission : numéro et date attendus ------------------------------------------
drop function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text)","create function public.emettre_devis(
  p_devis_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text,
  p_numero_attendu text default null,
  p_date_attendue date default null)
returns text
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_devis   public.devis%rowtype;
  v_numero  text;
  v_somme_lignes bigint;
  v_date    date := public.aujourd_hui_paris();
begin
  select * into v_devis from public.devis where id = p_devis_id for update;
  if not found or not public.est_membre(v_devis.organisation_id) then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  if v_devis.statut <> ''brouillon'' then
    raise exception ''Ce devis a déjà été émis.'' using errcode = ''P0001'';
  end if;

  select coalesce(sum(total_ht_cents), 0) into v_somme_lignes
  from public.devis_lignes
  where devis_id = p_devis_id and type = ''ligne'' and not optionnelle;
  if v_somme_lignes = 0 then
    raise exception ''Un devis sans ligne chiffrée ne peut pas être émis.'' using errcode = ''P0001'';
  end if;
  perform 1 from public.chantiers where id = v_devis.chantier_id for share;
  if v_devis.chantier_id is not null and exists (
       select 1 from public.chantiers c where c.id = v_devis.chantier_id and c.client_id <> v_devis.client_id) then
    raise exception ''Le chantier du devis appartient à un autre client.'' using errcode = ''P0001'';
  end if;
  perform public.controler_totaux_lignes(public.lignes_devis_par_taux(p_devis_id, ''{}''),
    v_devis.remise_globale_bp, v_devis.regime_tva, v_devis.ventilation_tva,
    v_devis.total_ht_cents, v_devis.total_tva_cents);
  perform public.controler_ventilation(v_devis.ventilation_tva, v_devis.total_ht_cents,
                                        v_devis.total_tva_cents, v_devis.regime_tva);
  if (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances where devis_id = p_devis_id) > 10000 then
    raise exception ''L''''échéancier dépasse 100 %% du devis.'' using errcode = ''P0001'';
  end if;
  if exists (select 1 from public.devis_echeances where devis_id = p_devis_id)
     and v_devis.acompte_pct_bp <> (select coalesce(sum(pourcentage_bp), 0) from public.devis_echeances
                                    where devis_id = p_devis_id and declencheur = ''signature'') then
    raise exception ''L''''acompte du devis ne correspond pas à l''''échéancier.'' using errcode = ''P0001'';
  end if;

  if v_devis.devis_precedent_id is null then
    v_numero := public.prochain_numero(v_devis.organisation_id, ''DEV'', extract(year from v_date)::integer);
  else
    select numero into v_numero from public.devis where id = v_devis.devis_precedent_id;
  end if;

  -- Le PDF porte un numéro et une date : s''ils ne sont plus ceux attribués
  -- (autre émission entre-temps, passage de minuit), tout est annulé — le
  -- compteur aussi — et le serveur régénère le PDF.
  if p_numero_attendu is not null and (v_numero <> p_numero_attendu or v_date <> p_date_attendue) then
    raise exception ''Numéro ou date changés pendant l''''émission : %, %.'', v_numero, v_date using errcode = ''HD001'';
  end if;

  update public.devis set
    numero = v_numero,
    statut = ''envoye'',
    date_emission = v_date,
    envoye_le = now(),
    copie_emetteur = p_copie_emetteur,
    copie_client = p_copie_client,
    copie_chantier = p_copie_chantier,
    pdf_chemin = p_pdf_chemin,
    pdf_sha256 = p_pdf_sha256
  where id = p_devis_id;

  return v_numero;
end;
$$","revoke execute on function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text, text, date) from public, anon","grant execute on function public.emettre_devis(uuid, jsonb, jsonb, jsonb, text, text, text, date) to authenticated","-- 3. Duplication -------------------------------------------------------------------
-- Nouveau BROUILLON indépendant (version 1, nouveau numéro à l''émission), avec
-- lignes, échéancier et achats retenus. SECURITY INVOKER : la RLS s''applique.
create or replace function public.dupliquer_devis(p_devis_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_ancien  public.devis%rowtype;
  v_nouveau uuid := gen_random_uuid();
begin
  select * into v_ancien from public.devis where id = p_devis_id;
  if not found then raise exception ''Devis introuvable.'' using errcode = ''P0002''; end if;
  insert into public.devis (id, organisation_id, client_id, chantier_id,
    objet, validite_jours, date_debut_travaux, delai_debut_texte, duree_estimee_jours, acompte_pct_bp,
    conditions_paiement, hors_etablissement, regime_tva, remise_globale_bp, notes_client,
    total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  values (v_nouveau, v_ancien.organisation_id, v_ancien.client_id, v_ancien.chantier_id,
    v_ancien.objet, v_ancien.validite_jours, null, v_ancien.delai_debut_texte, v_ancien.duree_estimee_jours,
    v_ancien.acompte_pct_bp, v_ancien.conditions_paiement, v_ancien.hors_etablissement,
    -- Le régime de TVA est celui d''AUJOURD''HUI (paramètres), pas celui du devis copié.
    (select regime_tva from public.parametres_entreprise where organisation_id = v_ancien.organisation_id),
    v_ancien.remise_globale_bp, v_ancien.notes_client, 0, 0, 0, ''[]'');
  insert into public.devis_lignes (organisation_id, devis_id, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues)
  select organisation_id, v_nouveau, ordre, type, designation, description,
    quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle, origine,
    cout_matiere_prevu_cents, minutes_prevues
  from public.devis_lignes where devis_id = p_devis_id;
  insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur, date_prevue)
  select organisation_id, v_nouveau, ordre, libelle, pourcentage_bp, declencheur,
    case when declencheur = ''date'' then date_prevue end
  from public.devis_echeances where devis_id = p_devis_id;
  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents)
  select organisation_id, v_nouveau, conditionnement_id, teinte_id, nombre, prix_achat_retenu_cents
  from public.devis_achats where devis_id = p_devis_id;
  return v_nouveau;
end;
$$","revoke execute on function public.dupliquer_devis(uuid) from public, anon","grant execute on function public.dupliquer_devis(uuid) to authenticated","-- 4. Modèles de messages par défaut -------------------------------------------------
-- Textes courants modifiables (Paramètres). Champs remplacés à l''envoi :
-- {client}, {entreprise}, {numero}, {lien}, {valide_jusqu_au}.
create or replace function public.initialiser_messages(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values
    (p_organisation_id, ''envoi_devis'', ''Votre devis {numero}'',
     E''Bonjour {client},\\\\n\\\\nVous trouverez votre devis {numero} en suivant ce lien : {lien}\\\\nVous pouvez le consulter, le télécharger et le signer en ligne. Il est valable jusqu''''au {valide_jusqu_au}.\\\\n\\\\nCordialement,\\\\n{entreprise}'', null),
    (p_organisation_id, ''relance_devis'', ''Votre devis {numero}'',
     E''Bonjour {client},\\\\n\\\\nJe me permets de revenir vers vous au sujet du devis {numero}, valable jusqu''''au {valide_jusqu_au}. Vous pouvez le consulter et le signer ici : {lien}\\\\nJe reste à votre disposition pour toute question.\\\\n\\\\nCordialement,\\\\n{entreprise}'', 7)
  on conflict (organisation_id, code) do nothing;
$$","revoke execute on function public.initialiser_messages(uuid) from public, anon, authenticated","create or replace function public.organisation_initialiser_messages()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform public.initialiser_messages(new.id);
  return null;
end;
$$","revoke execute on function public.organisation_initialiser_messages() from public, anon, authenticated","create trigger organisations_initialiser_messages after insert on public.organisations
  for each row execute function public.organisation_initialiser_messages()","select public.initialiser_messages(id) from public.organisations","-- 5. Devis à relancer (tâche planifiée) ---------------------------------------------
-- Devis envoyés, ni signés ni refusés, encore valables, envoyés depuis au moins
-- « relance_devis_jours » (paramètres), relance activée, jamais relancés, avec
-- l''email du client. Une seule relance automatique par devis.
create or replace function public.devis_a_relancer()
returns table (organisation_id uuid, devis_id uuid, numero text, version smallint, email text,
               client text, entreprise text, valide_jusqu_au date)
language sql
stable
security definer
set search_path = ''''
as $$
  select d.organisation_id, d.id, d.numero, d.version, c.email,
         coalesce(d.copie_client ->> ''nom_affiche'', c.nom), coalesce(p.raison_sociale, ''''),
         d.date_emission + d.validite_jours
  from public.devis d
  join public.parametres_entreprise p on p.organisation_id = d.organisation_id
  join public.clients c on c.id = d.client_id and c.organisation_id = d.organisation_id
  where d.statut = ''envoye''
    and p.relance_devis_active
    and d.envoye_le <= now() - make_interval(days => p.relance_devis_jours)
    and d.date_emission + d.validite_jours >= public.aujourd_hui_paris()
    and c.email is not null and c.anonymise_le is null
    and not exists (select 1 from public.envois e
                    where e.document_type = ''devis'' and e.document_id = d.id and e.nature = ''relance_devis'' and e.statut = ''envoye'');
$$","revoke execute on function public.devis_a_relancer() from public, anon, authenticated","grant execute on function public.devis_a_relancer() to service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261013000100', 'devis_ecrans', '{"-- =============================================================================
-- H''DECOR, phase 4 : écrans des devis.
-- Déplacement d''une ligne (échange d''ordre avec sa voisine) en une seule
-- transaction : la contrainte unique (devis_id, ordre) n''est pas différable.
-- SECURITY INVOKER : RLS et gel des devis émis (trigger) s''appliquent.
-- =============================================================================

create or replace function public.deplacer_ligne_devis(p_ligne_id uuid, p_sens integer)
returns void
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_ligne  public.devis_lignes%rowtype;
  v_voisin public.devis_lignes%rowtype;
begin
  if p_sens not in (-1, 1) then
    raise exception ''Sens invalide.'' using errcode = ''P0001'';
  end if;
  select * into v_ligne from public.devis_lignes where id = p_ligne_id for update;
  if not found then
    raise exception ''Ligne introuvable.'' using errcode = ''P0002'';
  end if;
  if exists (select 1 from public.devis where id = v_ligne.devis_id and statut <> ''brouillon'') then
    raise exception ''Les lignes d''''un devis envoyé sont figées.'' using errcode = ''P0001'';
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
$$","revoke execute on function public.deplacer_ligne_devis(uuid, integer) from public, anon","grant execute on function public.deplacer_ligne_devis(uuid, integer) to authenticated"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261014000100', 'devis_corrections', '{"-- =============================================================================
-- H''DECOR, phase 4 : corrections après la première boucle de contrôle.
-- =============================================================================

-- 1. Garde-fou d''émission en base (indépendant de l''interface) : taux de TVA
--    des lignes cohérents avec le régime et les Paramètres, total HT > 0.
create or replace function public.controler_emission_devis()
returns trigger
language plpgsql
set search_path = ''''
as $$
begin
  if old.statut = ''brouillon'' and new.statut = ''envoye'' then
    if coalesce(new.total_ht_cents, 0) <= 0 then
      raise exception ''Un devis à 0 € HT ne peut pas être émis.'' using errcode = ''P0001'';
    end if;
    -- Échéancier : les échéances « à la signature » en tête (montants calculés en cumulé, acompte exact).
    if exists (
         select 1 from public.devis_echeances s
         where s.devis_id = new.id and s.declencheur = ''signature''
           and exists (select 1 from public.devis_echeances a
                       where a.devis_id = new.id and a.declencheur <> ''signature'' and a.ordre < s.ordre)) then
      raise exception ''Échéancier : les échéances à la signature doivent venir en premier.'' using errcode = ''P0001'';
    end if;
    if new.regime_tva = ''franchise'' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = ''ligne'' and l.taux_tva_bp <> 0) then
      raise exception ''Franchise en base de TVA : toutes les lignes doivent être à 0 %%.'' using errcode = ''P0001'';
    end if;
    if new.regime_tva = ''assujetti'' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = ''ligne''
           and (l.taux_tva_bp = 0 or not exists (
                  select 1 from public.taux_tva t
                  where t.organisation_id = new.organisation_id and t.taux_bp = l.taux_tva_bp and t.actif))) then
      raise exception ''Taux de TVA d''''une ligne absent des Paramètres ou à 0 %% sans justification.'' using errcode = ''P0001'';
    end if;
  end if;
  return new;
end;
$$","revoke execute on function public.controler_emission_devis() from public, anon, authenticated","create trigger devis_controle_emission before update on public.devis
  for each row execute function public.controler_emission_devis()","-- 2. Version remplacée : ses liens publics sont désactivés dans la même
--    transaction (plus d''appel séparé qui pourrait échouer).
create or replace function public.revoquer_liens_devis_remplace()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if new.statut = ''remplace'' and old.statut is distinct from ''remplace'' then
    update public.liens_publics set revoque_le = now()
    where devis_id = new.id and organisation_id = new.organisation_id and revoque_le is null;
  end if;
  return null;
end;
$$","revoke execute on function public.revoquer_liens_devis_remplace() from public, anon, authenticated","create trigger devis_remplace_revoque_liens after update on public.devis
  for each row execute function public.revoquer_liens_devis_remplace()","-- 3. Relances : seulement après un ENVOI réel (email ou lien partagé), le délai
--    courant depuis le dernier envoi (et non depuis l''émission).
create or replace function public.devis_a_relancer()
returns table (organisation_id uuid, devis_id uuid, numero text, version smallint, email text,
               client text, entreprise text, valide_jusqu_au date)
language sql
stable
security definer
set search_path = ''''
as $$
  select d.organisation_id, d.id, d.numero, d.version, c.email,
         coalesce(d.copie_client ->> ''nom_affiche'', c.nom), coalesce(p.raison_sociale, ''''),
         d.date_emission + d.validite_jours
  from public.devis d
  join public.parametres_entreprise p on p.organisation_id = d.organisation_id
  join public.clients c on c.id = d.client_id and c.organisation_id = d.organisation_id
  join lateral (
    select max(e.envoye_le) as dernier from public.envois e
    where e.document_type = ''devis'' and e.document_id = d.id and e.organisation_id = d.organisation_id
      and e.nature = ''envoi'' and e.statut = ''envoye''
  ) envoi on envoi.dernier is not null
  where d.statut = ''envoye''
    and p.relance_devis_active
    and envoi.dernier <= now() - make_interval(days => p.relance_devis_jours)
    and d.date_emission + d.validite_jours >= public.aujourd_hui_paris()
    and c.email is not null and c.anonymise_le is null
    and not exists (select 1 from public.envois e
                    where e.document_type = ''devis'' and e.document_id = d.id and e.nature = ''relance_devis'' and e.statut = ''envoye'');
$$","revoke execute on function public.devis_a_relancer() from public, anon, authenticated","grant execute on function public.devis_a_relancer() to service_role","-- 4. Achats retenus d''un brouillon remplacés en une seule transaction.
create or replace function public.remplacer_achats_devis(p_devis_id uuid, p_achats jsonb)
returns void
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id;
  if v_org is null then
    raise exception ''Devis introuvable.'' using errcode = ''P0002'';
  end if;
  delete from public.devis_achats where devis_id = p_devis_id;
  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, nombre, prix_achat_retenu_cents)
  select v_org, p_devis_id, a.conditionnement_id, a.nombre, a.prix_achat_retenu_cents
  from jsonb_to_recordset(p_achats) as a(conditionnement_id uuid, nombre integer, prix_achat_retenu_cents bigint);
end;
$$","revoke execute on function public.remplacer_achats_devis(uuid, jsonb) from public, anon","grant execute on function public.remplacer_achats_devis(uuid, jsonb) to authenticated","-- 5. Les PDF émis et les tracés de signature sont déposés par le SERVEUR
--    (clé service) : l''API n''y dépose plus rien directement.
drop policy hdecor_ajout on storage.objects","create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in (''photos'', ''justificatifs'', ''marque'')
              and public.est_membre(public.organisation_du_chemin(name)))"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261015000100', 'factures_phase5', E'{"-- =============================================================================
-- H''DECOR (Phase 5) : factures.
--   1. Numéro prévisionnel d''une facture ou d''un avoir (porté par le PDF).
--   2. Émission avec numéro et date attendus : enveloppe d''emettre_facture
--      (SECURITY INVOKER) ; tout écart annule la transaction, compteur compris
--      (aucun trou), et le serveur régénère le PDF.
--   3. Modèles de messages : envoi de facture et relances d''impayés (3 niveaux,
--      délais après l''échéance modifiables dans les Paramètres).
--   4. Factures à relancer (tâche planifiée, rôle service).
--   5. Déplacement d''une ligne de facture brouillon (atomique).
-- =============================================================================

-- 1. Numéro prévisionnel ---------------------------------------------------------
create or replace function public.numero_facture_previsionnel(p_facture_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''''
as $$
declare
  v_f     public.factures%rowtype;
  v_date  date := public.aujourd_hui_paris();
  v_annee integer := extract(year from v_date)::integer;
  v_type  text;
  v_n     integer;
begin
  select * into v_f from public.factures where id = p_facture_id;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception ''Facture introuvable.'' using errcode = ''P0002'';
  end if;
  v_type := case when v_f.type = ''avoir'' then ''AVO'' else ''FAC'' end;
  select dernier + 1 into v_n from public.sequences_documents
  where organisation_id = v_f.organisation_id and type = v_type and annee = v_annee;
  return jsonb_build_object(''numero'', v_type || ''-'' || v_annee || ''-'' || lpad(coalesce(v_n, 1)::text, 4, ''0''),
                            ''date_emission'', v_date,
                            ''date_echeance'', v_date + v_f.delai_paiement_jours);
end;
$$","revoke execute on function public.numero_facture_previsionnel(uuid) from public, anon","grant execute on function public.numero_facture_previsionnel(uuid) to authenticated","-- 2. Émission avec numéro et date attendus -------------------------------------------
-- emettre_facture (SECURITY DEFINER) garde tous ses contrôles ; cette enveloppe
-- vérifie ensuite que le numéro et la date attribués sont ceux du PDF.
create or replace function public.emettre_facture_attendue(
  p_facture_id uuid,
  p_copie_emetteur jsonb,
  p_copie_client jsonb,
  p_copie_chantier jsonb,
  p_pdf_chemin text,
  p_pdf_sha256 text,
  p_numero_attendu text,
  p_date_attendue date)
returns text
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_numero text;
  v_date   date;
begin
  v_numero := public.emettre_facture(p_facture_id, p_copie_emetteur, p_copie_client, p_copie_chantier,
                                     p_pdf_chemin, p_pdf_sha256);
  select date_emission into v_date from public.factures where id = p_facture_id;
  if v_numero is distinct from p_numero_attendu or v_date is distinct from p_date_attendue then
    raise exception ''Numéro ou date changés pendant l''''émission : %, %.'', v_numero, v_date using errcode = ''HD001'';
  end if;
  return v_numero;
end;
$$","revoke execute on function public.emettre_facture_attendue(uuid, jsonb, jsonb, jsonb, text, text, text, date) from public, anon","grant execute on function public.emettre_facture_attendue(uuid, jsonb, jsonb, jsonb, text, text, text, date) to authenticated","-- 3. Modèles de messages -------------------------------------------------------------
-- Champs remplacés à l''envoi : {client}, {entreprise}, {numero}, {lien},
-- {montant}, {echeance}. Délais des relances : jours APRÈS l''échéance
-- (valeurs de départ, modifiables). Textes neutres et modifiables.
create or replace function public.initialiser_messages(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values
    (p_organisation_id, ''envoi_devis'', ''Votre devis {numero}'',
     E''Bonjour {client},\\\\n\\\\nVous trouverez votre devis {numero} en suivant ce lien : {lien}\\\\nVous pouvez le consulter, le télécharger et le signer en ligne. Il est valable jusqu''''au {valide_jusqu_au}.\\\\n\\\\nCordialement,\\\\n{entreprise}'', null),
    (p_organisation_id, ''relance_devis'', ''Votre devis {numero}'',
     E''Bonjour {client},\\\\n\\\\nJe me permets de revenir vers vous au sujet du devis {numero}, valable jusqu''''au {valide_jusqu_au}. Vous pouvez le consulter et le signer ici : {lien}\\\\nJe reste à votre disposition pour toute question.\\\\n\\\\nCordialement,\\\\n{entreprise}'', 7),
    (p_organisation_id, ''envoi_facture'', ''Votre facture {numero}'',
     E''Bonjour {client},\\\\n\\\\nVous trouverez votre facture {numero} d''''un montant de {montant}, à régler au plus tard le {echeance}, en suivant ce lien : {lien}\\\\nLes coordonnées bancaires figurent sur la facture.\\\\n\\\\nCordialement,\\\\n{entreprise}'', null),
    (p_organisation_id, ''impaye_1'', ''Rappel : facture {numero}'',
     E''Bonjour {client},\\\\n\\\\nSauf erreur de notre part, la facture {numero} arrivée à échéance le {echeance} reste à régler : {montant}. Vous pouvez la consulter ici : {lien}\\\\nSi le paiement est en cours, merci de ne pas tenir compte de ce message.\\\\n\\\\nCordialement,\\\\n{entreprise}'', 7),
    (p_organisation_id, ''impaye_2'', ''Deuxième rappel : facture {numero}'',
     E''Bonjour {client},\\\\n\\\\nMalgré notre précédent rappel, la facture {numero} (échéance du {echeance}) reste impayée : {montant}. Merci de procéder au règlement dès réception de ce message. La facture : {lien}\\\\nLes conditions de retard indiquées sur la facture s''''appliquent.\\\\n\\\\nCordialement,\\\\n{entreprise}'', 15),
    (p_organisation_id, ''impaye_3'', ''Dernier rappel avant recouvrement : facture {numero}'',
     E''Bonjour {client},\\\\n\\\\nLa facture {numero} (échéance du {echeance}) reste impayée malgré nos rappels : {montant}. Sans règlement de votre part sous huit jours, nous serons contraints d''''engager une procédure de recouvrement. La facture : {lien}\\\\n\\\\nCordialement,\\\\n{entreprise}'', 30)
  on conflict (organisation_id, code) do nothing;
$$","revoke execute on function public.initialiser_messages(uuid) from public, anon, authenticated","select public.initialiser_messages(id) from public.organisations","-- 4. Factures à relancer -----------------------------------------------------------
-- Facture émise (pas un avoir), ENVOYÉE (relance seulement après un envoi
-- réel), échue, avec un reste à payer, client avec email et non anonymisé.
-- Niveau proposé : le premier niveau actif non encore envoyé, dont le délai
-- après l''échéance est atteint et dont chaque niveau précédent actif a été
-- ENVOYÉ (statut envoyé, pas seulement réservé) depuis au moins l''écart entre
-- leurs délais (1 jour au moins) : une facture découverte très en retard ne
-- reçoit pas les trois rappels en trois jours. Un seul niveau par passage.
create or replace function public.factures_a_relancer()
returns table (organisation_id uuid, facture_id uuid, numero text, email text, client text, entreprise text,
               reste_cents bigint, date_echeance date, niveau integer, code text)
language sql
stable
security definer
set search_path = ''''
as $$
  select f.organisation_id, f.id, f.numero, c.email,
         coalesce(f.copie_client ->> ''nom_affiche'', c.nom), coalesce(p.raison_sociale, ''''),
         s.reste_a_payer_cents, f.date_echeance, n.niveau, n.code
  from public.factures f
  join public.parametres_entreprise p on p.organisation_id = f.organisation_id
  join public.clients c on c.id = f.client_id and c.organisation_id = f.organisation_id
  cross join lateral public.solde_facture(f.id) s
  cross join lateral (
    select m.niveau, m.code from (
      select mm.code, substring(mm.code from 8)::integer as niveau, mm.delai_jours, mm.actif
      from public.modeles_messages mm
      where mm.organisation_id = f.organisation_id and mm.code in (''impaye_1'', ''impaye_2'', ''impaye_3'')
    ) m
    where m.actif and m.delai_jours is not null
      and f.date_echeance + m.delai_jours <= public.aujourd_hui_paris()
      and not exists (select 1 from public.envois e
                      where e.document_type = ''facture'' and e.document_id = f.id and e.nature = m.code and e.statut <> ''echec'')
      and not exists (select 1 from public.modeles_messages prec
                      where prec.organisation_id = f.organisation_id and prec.actif
                        and prec.code in (''impaye_1'', ''impaye_2'', ''impaye_3'')
                        and substring(prec.code from 8)::integer < m.niveau
                        and not exists (select 1 from public.envois e2
                                        where e2.document_type = ''facture'' and e2.document_id = f.id
                                          and e2.nature = prec.code and e2.statut = ''envoye''
                                          and (e2.envoye_le at time zone ''Europe/Paris'')::date
                                              <= public.aujourd_hui_paris() - greatest(m.delai_jours - coalesce(prec.delai_jours, 0), 1)))
    order by m.niveau
    limit 1
  ) n
  where f.statut = ''emise'' and f.type <> ''avoir''
    and f.envoyee_le is not null
    and s.reste_a_payer_cents > 0
    and c.email is not null and c.anonymise_le is null;
$$","revoke execute on function public.factures_a_relancer() from public, anon, authenticated","grant execute on function public.factures_a_relancer() to service_role","-- 5. Déplacement d''une ligne de facture brouillon --------------------------------------
create or replace function public.deplacer_ligne_facture(p_ligne_id uuid, p_sens integer)
returns void
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_ligne  public.facture_lignes%rowtype;
  v_voisin public.facture_lignes%rowtype;
begin
  if p_sens not in (-1, 1) then
    raise exception ''Sens invalide.'' using errcode = ''P0001'';
  end if;
  select * into v_ligne from public.facture_lignes where id = p_ligne_id for update;
  if not found then
    raise exception ''Ligne introuvable.'' using errcode = ''P0002'';
  end if;
  if exists (select 1 from public.factures where id = v_ligne.facture_id and statut <> ''brouillon'') then
    raise exception ''Les lignes d''''une facture émise sont figées.'' using errcode = ''P0001'';
  end if;
  select * into v_voisin from public.facture_lignes
  where facture_id = v_ligne.facture_id
    and case when p_sens < 0 then ordre < v_ligne.ordre else ordre > v_ligne.ordre end
  order by case when p_sens < 0 then -ordre else ordre end
  limit 1
  for update;
  if not found then
    return;
  end if;
  update public.facture_lignes set ordre = -1 - v_ligne.ordre where id = v_ligne.id;
  update public.facture_lignes set ordre = v_ligne.ordre where id = v_voisin.id;
  update public.facture_lignes set ordre = v_voisin.ordre where id = v_ligne.id;
end;
$$","revoke execute on function public.deplacer_ligne_facture(uuid, integer) from public, anon","grant execute on function public.deplacer_ligne_facture(uuid, integer) to authenticated","-- 6. Données Factur-X : chemin du XML fixé UNE fois après l''émission (le trigger
--    de protection refuse tout changement ultérieur). Fichier de l''organisation.
create or replace function public.enregistrer_facturx(p_facture_id uuid, p_chemin text)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_f public.factures%rowtype;
begin
  select * into v_f from public.factures where id = p_facture_id for update;
  if not found or not public.est_membre(v_f.organisation_id) then
    raise exception ''Facture introuvable.'' using errcode = ''P0002'';
  end if;
  if v_f.statut = ''brouillon'' then
    raise exception ''Facture non émise.'' using errcode = ''P0001'';
  end if;
  -- Chemin imposé : dossier de CETTE facture, empreinte SHA-256 du XML dans le nom (vérifiée à la lecture).
  if p_chemin is null or p_chemin !~ (''^'' || v_f.organisation_id::text || ''/factures/'' || v_f.id::text || ''/facturx-[0-9a-f]{64}\\\\.xml$'') then
    raise exception ''Chemin de fichier invalide.'' using errcode = ''P0001'';
  end if;
  if v_f.facturx_chemin is not null then
    return;   -- déjà fixé : rien à faire (idempotent)
  end if;
  update public.factures set facturx_chemin = p_chemin where id = p_facture_id;
end;
$$","revoke execute on function public.enregistrer_facturx(uuid, text) from public, anon","grant execute on function public.enregistrer_facturx(uuid, text) to authenticated","-- 7. Paiements : identifiant fixé par le formulaire (un nouvel essai après une
--    réponse perdue ne crée pas un second paiement).
grant insert (id) on public.paiements to authenticated","-- 8. Envois RÉSERVÉS avant l''email (statut « en_cours ») : deux requêtes
--    simultanées (rejeu réseau, double passage de la tâche planifiée)
--    n''envoient jamais deux fois le même email.
--    * envoi manuel : identifiant fixé par le formulaire (clé primaire) ;
--    * relances : au plus une relance non échouée par document et par niveau.
--    Seule la conclusion d''un envoi en cours est modifiable (statut, identifiant
--    du prestataire, erreur) ; l''historique reste en ajout seul.
alter table public.envois drop constraint envois_statut_check","alter table public.envois add constraint envois_statut_check check (statut in (''en_cours'', ''envoye'', ''echec''))","create unique index envois_relance_unique on public.envois (document_type, document_id, nature)
  where nature in (''relance_devis'', ''impaye_1'', ''impaye_2'', ''impaye_3'') and statut <> ''echec''","grant update (statut, fournisseur_id, erreur) on public.envois to authenticated","create policy envois_conclusion on public.envois
  for update to authenticated
  using (public.est_membre(organisation_id) and statut = ''en_cours'')
  with check (public.est_membre(organisation_id) and statut in (''envoye'', ''echec''))","-- 9. Paiements par carte (Stripe, facultatif) : un même paiement (payment_intent)
--    n''est enregistré qu''une fois ; un paiement ENCAISSÉ par Stripe mais refusé
--    par la base (facture soldée, annulée…) est consigné pour être vu et
--    remboursé, jamais seulement journalisé.
create unique index paiements_stripe_reference_unique on public.paiements (organisation_id, reference)
  where mode = ''stripe''","create table public.incidents_paiement (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  facture_id          uuid not null,
  stripe_evenement_id text not null unique,
  reference           text,
  montant_cents       bigint not null check (montant_cents > 0),
  motif               text not null,
  traite_le           timestamptz,
  created_at          timestamptz not null default now(),
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict
)","create index incidents_paiement_facture_idx on public.incidents_paiement (organisation_id, facture_id)","alter table public.incidents_paiement enable row level security","create policy incidents_paiement_lecture on public.incidents_paiement
  for select to authenticated using (public.est_membre(organisation_id))","-- Seul le traitement se marque (remboursé dans Stripe) ; l''écriture vient du webhook (rôle service).
create policy incidents_paiement_traitement on public.incidents_paiement
  for update to authenticated using (public.est_membre(organisation_id) and traite_le is null)
  with check (public.est_membre(organisation_id))","revoke all on public.incidents_paiement from anon, authenticated","grant select on public.incidents_paiement to authenticated","grant update (traite_le) on public.incidents_paiement to authenticated","grant select, insert on public.incidents_paiement to service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261016000100', 'pilotage_phase6', E'{"-- =============================================================================
-- H''DECOR, Phase 6 : pilotage (tableau de bord, planning, comptabilité simplifiée).
--   1. Justificatifs comptables : déposés par le SERVEUR seulement (type
--      vérifié sur le contenu), jamais remplacés ni supprimés depuis le navigateur.
--   2. Registre des achats : date de création, catégories par défaut.
--   3. Matériel : date de création, rattachement contrôlé.
--   4. Planning : un événement « chantier » porte son chantier.
--   5. Livre des recettes : net HT / TTC de la facture (part HT d''un
--      encaissement pour une entreprise soumise à la TVA).
-- =============================================================================

-- 1. Justificatifs -----------------------------------------------------------------
drop policy hdecor_ajout on storage.objects","create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in (''photos'', ''marque'')
              and public.est_membre(public.organisation_du_chemin(name)))","drop policy hdecor_maj on storage.objects","create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id in (''photos'', ''marque'') and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id in (''photos'', ''marque'') and public.est_membre(public.organisation_du_chemin(name)))","drop policy hdecor_suppr on storage.objects","create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id in (''photos'', ''marque'') and public.est_membre(public.organisation_du_chemin(name)))","-- Chemin d''un justificatif : dossier de SA dépense.
alter table public.depenses add constraint justificatif_chemin_depense check (
  justificatif_chemin is null
  or justificatif_chemin ~ (''^'' || organisation_id::text || ''/depenses/'' || id::text || ''/[0-9a-f-]{36}\\\\.(jpg|png|webp|pdf)$''))","-- 2. Registre des achats -----------------------------------------------------------
alter table public.depenses add column updated_at timestamptz not null default now()","create trigger depenses_updated_at before update on public.depenses
  for each row execute function public.maj_updated_at()","-- Rentabilité par chantier (achats du chantier) et clé étrangère vers chantiers.
create index depenses_chantier_idx on public.depenses (organisation_id, chantier_id) where chantier_id is not null","-- Catégories par défaut (modifiables), créées une fois pour l''organisation de la session.
create or replace function public.initialiser_categories_depenses()
returns void
language plpgsql
security invoker
set search_path = ''''
as $$
declare
  v_org uuid := (select organisation_id from public.membres where user_id = auth.uid() limit 1);
begin
  if v_org is null then
    raise exception ''Organisation introuvable.'' using errcode = ''P0002'';
  end if;
  insert into public.categories_depenses (organisation_id, libelle)
  select v_org, l from unnest(array[''Peintures et enduits'', ''Petit matériel et consommables'', ''Outillage'',
                                    ''Carburant et déplacements'', ''Assurances'', ''Téléphone et internet'', ''Autres'']) l
  where not exists (select 1 from public.categories_depenses c where c.organisation_id = v_org)
  on conflict (organisation_id, libelle) do nothing;
end;
$$","revoke execute on function public.initialiser_categories_depenses() from public, anon","grant execute on function public.initialiser_categories_depenses() to authenticated","-- 3. Matériel ----------------------------------------------------------------------
alter table public.materiel add column created_at timestamptz not null default now()","alter table public.materiel add constraint materiel_libelle_non_vide check (btrim(libelle) <> '''')","-- 4. Planning ----------------------------------------------------------------------
alter table public.evenements add constraint evenement_chantier_porte_son_chantier
  check (type <> ''chantier'' or chantier_id is not null)","alter table public.evenements add constraint evenement_titre_non_vide check (btrim(titre) <> '''')","-- Un événement ne s''étend pas sur plus d''un an (saisie erronée).
alter table public.evenements add constraint evenement_duree_raisonnable check (fin <= debut + interval ''366 days'')","create index rappels_org_echeance_idx on public.rappels (organisation_id, statut, echeance)","-- 5. Livre des recettes ------------------------------------------------------------
-- Colonnes ajoutées en fin de vue : net de la facture (TTC et HT, acomptes
-- déduits), régime, et part HT de l''encaissement (assujetti ; À VÉRIFIER avec le comptable).
create or replace view public.v_livre_recettes with (security_invoker = true) as
select p.organisation_id, p.date_paiement,
       case when f.type = ''avoir'' then -p.montant_cents else p.montant_cents end as montant_cents,
       case when f.type = ''avoir'' then ''remboursement'' else ''encaissement'' end as nature,
       p.mode, p.reference,
       f.numero as facture_numero, f.id as facture_id,
       coalesce(f.copie_client ->> ''nom_affiche'', '''') as client,
       p.id as paiement_id,
       f.net_a_payer_cents as facture_net_ttc_cents,
       f.total_ht_cents - coalesce((select sum((d ->> ''ht'')::bigint) from jsonb_array_elements(f.deductions) d), 0)::bigint
         as facture_net_ht_cents,
       f.regime_tva,
       f.chantier_id,
       e.part_ht_cents
from public.paiements p
join public.factures f on f.id = p.facture_id
cross join lateral (
  select case when f.type = ''avoir'' then -p.montant_cents else p.montant_cents end as m,
         f.total_ht_cents - coalesce((select sum((d ->> ''ht'')::bigint) from jsonb_array_elements(f.deductions) d), 0) as ht,
         f.net_a_payer_cents as ttc
) n
cross join lateral (
  -- Part HT en CUMULÉ (assujetti) : arrondi(cumul × HT/TTC) − arrondi(cumul précédent × HT/TTC).
  -- Les parts d''une facture totalisent exactement son HT net, quel que soit le nombre de paiements.
  select case when f.regime_tva = ''franchise'' or n.ttc <= 0 then n.m
         else (round(c.cumul::numeric * n.ht / n.ttc) - round((c.cumul - n.m)::numeric * n.ht / n.ttc))::bigint end as part_ht_cents
  from (select sum(case when f2.type = ''avoir'' then -p2.montant_cents else p2.montant_cents end) as cumul
        from public.paiements p2 join public.factures f2 on f2.id = p2.facture_id
        where p2.facture_id = p.facture_id
          and (p2.date_paiement, p2.created_at, p2.id) <= (p.date_paiement, p.created_at, p.id)) c
) e"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261017000100', 'documents_phase7', E'{"-- =============================================================================
-- H''DECOR, Phase 7 : documents et finitions.
--   1. Photos et documents de chantier : déposés par le SERVEUR seulement
--      (contenu vérifié), chemin rangé dans le dossier du chantier ;
--      galerie avant / après ; accord du client pour la diffusion.
--   2. Liste de fin de chantier : modèle paramétrable, cases datées.
--   3. PV de réception : brouillon modifiable, PDF présenté puis signé sur
--      place (client) avec empreinte ; figé une fois signé, seule la levée
--      des réserves (datée) reste possible.
--   4. Demande d''avis : une par facture, opposition du client respectée.
--   5. Notifications : centre de notifications (événements à distance,
--      rappels échus), envoi par email à Yorick s''il l''a choisi.
-- =============================================================================

-- 1. Photos et documents ------------------------------------------------------------
-- Dépôt par le serveur uniquement (comme les justificatifs) : plus d''écriture
-- directe dans l''espace « photos » depuis le navigateur.
drop policy hdecor_ajout on storage.objects","create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id = ''marque'' and public.est_membre(public.organisation_du_chemin(name)))","drop policy hdecor_maj on storage.objects","create policy hdecor_maj on storage.objects for update to authenticated
  using (bucket_id = ''marque'' and public.est_membre(public.organisation_du_chemin(name)))
  with check (bucket_id = ''marque'' and public.est_membre(public.organisation_du_chemin(name)))","drop policy hdecor_suppr on storage.objects","create policy hdecor_suppr on storage.objects for delete to authenticated
  using (bucket_id = ''marque'' and public.est_membre(public.organisation_du_chemin(name)))","alter table public.photos add column en_galerie boolean not null default false","alter table public.photos add column largeur integer check (largeur is null or largeur between 1 and 20000)","alter table public.photos add column hauteur integer check (hauteur is null or hauteur between 1 and 20000)","alter table public.photos add constraint photo_chemin_rangee check (
  chemin ~ (''^'' || organisation_id::text || ''/chantiers/'' || chantier_id::text || ''/photos/[0-9a-f-]{36}\\\\.(jpg|png|webp)$''))","alter table public.photos add constraint photo_legende_courte check (legende is null or length(legende) <= 300)","create index photos_chantier_idx on public.photos (organisation_id, chantier_id, moment)","grant update (en_galerie) on public.photos to authenticated","alter table public.documents_chantier add constraint document_chemin_range check (
  chemin ~ (''^'' || organisation_id::text || ''/chantiers/'' || chantier_id::text || ''/documents/[0-9a-f-]{36}\\\\.(pdf|jpg|png|webp)$''))","alter table public.documents_chantier add constraint document_nom_valide check (btrim(nom) <> '''' and length(nom) <= 200)","create index documents_chantier_idx on public.documents_chantier (organisation_id, chantier_id)","-- Accord du client pour diffuser les photos (portfolio, réseaux sociaux), daté.
alter table public.chantiers add column accord_diffusion_photos_le timestamptz","-- 2. Liste de fin de chantier -------------------------------------------------------
alter table public.parametres_entreprise add column liste_fin_chantier text[] not null default array[
  ''Nettoyage du chantier'', ''Retouches faites'', ''Protections retirées'', ''Déchets évacués'', ''Photos après travaux'', ''Clés rendues'']","alter table public.parametres_entreprise add constraint liste_fin_chantier_taille
  check (cardinality(liste_fin_chantier) <= 30)","-- items : [{ \\"libelle\\": texte, \\"fait_le\\": date ou null }]
alter table public.checklists_fin_chantier add constraint items_forme check (
  jsonb_typeof(items) = ''array'' and jsonb_array_length(items) <= 50)","alter table public.checklists_fin_chantier add column updated_at timestamptz not null default now()","create trigger checklists_fin_chantier_updated_at before update on public.checklists_fin_chantier
  for each row execute function public.maj_updated_at()","-- 3. PV de réception ----------------------------------------------------------------
alter table public.pv_reception add column statut text not null default ''brouillon'' check (statut in (''brouillon'', ''signe''))","alter table public.pv_reception add column travaux text check (travaux is null or length(travaux) <= 2000)","alter table public.pv_reception add column observations text check (observations is null or length(observations) <= 4000)","alter table public.pv_reception add column delai_levee_jours integer check (delai_levee_jours is null or delai_levee_jours between 1 and 365)","alter table public.pv_reception add column devis_id uuid","alter table public.pv_reception add constraint pv_devis_fk
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict","-- Tracé de l''entreprise (Yorick) : déposé avec celui du client, dans l''espace « signatures ».
alter table public.pv_reception add column signature_entreprise_chemin text","alter table public.pv_reception add constraint signature_entreprise_chemin_org
  check (public.chemin_de_l_organisation(signature_entreprise_chemin, organisation_id))","alter table public.pv_reception add column updated_at timestamptz not null default now()","create trigger pv_reception_updated_at before update on public.pv_reception
  for each row execute function public.maj_updated_at()","-- reserves : [{ \\"description\\": texte, \\"levee_le\\": date ou null, \\"levee_note\\": texte ou null }]
alter table public.pv_reception add constraint reserves_forme check (
  jsonb_typeof(reserves) = ''array'' and jsonb_array_length(reserves) <= 50)","alter table public.pv_reception add constraint reserves_coherentes check (avec_reserves = (jsonb_array_length(reserves) > 0))","alter table public.pv_reception add constraint pv_signe_complet check (
  statut = ''brouillon'' or (signature_id is not null and pdf_sha256 is not null and signature_entreprise_chemin is not null))","create index pv_reception_chantier_idx on public.pv_reception (organisation_id, chantier_id)","/** Date AAAA-MM-JJ réelle (le 31/02 est refusé). */
create or replace function public.date_iso_valide(p text)
returns boolean
language plpgsql
immutable
set search_path = ''''
as $$
begin
  return p ~ ''^\\\\d{4}-\\\\d{2}-\\\\d{2}$'' and to_char(p::date, ''YYYY-MM-DD'') = p;
exception when others then
  return false;
end;
$$","revoke execute on function public.date_iso_valide(text) from public, anon","grant execute on function public.date_iso_valide(text) to authenticated, service_role","/**
 * Forme d''une réserve : description obligatoire (1 à 500 caractères), levée
 * datée facultative. Aucune autre clé (rien d''arbitraire figé dans un PV).
 */
create or replace function public.reserves_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select coalesce(bool_and(
    jsonb_typeof(r) = ''object''
    and (r - array[''description'', ''levee_le'', ''levee_note'']) = ''{}''::jsonb
    and jsonb_typeof(r -> ''description'') = ''string''
    and length(btrim(r ->> ''description'')) between 1 and 500
    and (r -> ''levee_le'' is null or jsonb_typeof(r -> ''levee_le'') = ''null''
         or (jsonb_typeof(r -> ''levee_le'') = ''string'' and public.date_iso_valide(r ->> ''levee_le'')))
    and (r -> ''levee_note'' is null or jsonb_typeof(r -> ''levee_note'') = ''null''
         or (jsonb_typeof(r -> ''levee_note'') = ''string'' and length(r ->> ''levee_note'') <= 500))
  ), true)
  from jsonb_array_elements(case when jsonb_typeof(p) = ''array'' then p else ''[]''::jsonb end) r;
$$","-- Fonction pure appelée par une contrainte CHECK : évaluée avec les droits de la session qui écrit.
revoke execute on function public.reserves_valides(jsonb) from public, anon","grant execute on function public.reserves_valides(jsonb) to authenticated, service_role","alter table public.pv_reception add constraint reserves_valides check (public.reserves_valides(reserves))","/**
 * Un PV signé est définitif. Seule la levée des réserves (date, note) peut
 * encore être renseignée, par lever_reserve. Le contenu d''un brouillon qui
 * change invalide le PDF présenté (il faut le représenter avant de signer).
 */
/** File de suppression d''un fichier devenu inutile (appelée par les déclencheurs ; jamais par une session). */
create or replace function public.mettre_en_file(p_org uuid, p_espace text, p_chemin text)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin) values (p_org, p_espace, p_chemin);
$$","revoke execute on function public.mettre_en_file(uuid, text, text) from public, anon, authenticated","create or replace function public.proteger_pv()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_contenu text[] := array[''date_reception'', ''avec_reserves'', ''reserves'', ''travaux'', ''observations'', ''delai_levee_jours'', ''devis_id'', ''chantier_id''];
begin
  if tg_op = ''DELETE'' then
    if old.statut = ''signe'' or old.signature_id is not null then
      raise exception ''Un PV signé ne peut pas être supprimé.'' using errcode = ''P0001'';
    end if;
    -- PDF présenté d''un brouillon supprimé (nom et adresse du client) : mis en file de suppression.
    if old.pdf_chemin is not null then perform public.mettre_en_file(old.organisation_id, ''documents'', old.pdf_chemin); end if;
    return old;
  end if;
  -- La signature rattachée est celle de CE PV (même hors API).
  if new.signature_id is not null and (tg_op = ''INSERT'' or new.signature_id is distinct from old.signature_id) and not exists (
       select 1 from public.signatures s
       where s.id = new.signature_id and s.organisation_id = new.organisation_id
         and s.document_type = ''pv_reception'' and s.document_id = new.id) then
    raise exception ''Cette signature ne correspond pas à ce document.'' using errcode = ''P0001'';
  end if;
  -- Devis rattaché : un devis ACCEPTÉ de ce chantier (jamais un brouillon qui bloquerait l''effacement du client).
  if new.devis_id is not null and (tg_op = ''INSERT'' or new.devis_id is distinct from old.devis_id) and not exists (
       select 1 from public.devis d where d.id = new.devis_id and d.chantier_id = new.chantier_id and d.statut = ''accepte'') then
    raise exception ''Le devis rattaché doit être un devis signé de ce chantier.'' using errcode = ''P0001'';
  end if;
  -- Avant signature, aucune levée : une réserve ne se lève qu''après la réception, par lever_reserve.
  if (tg_op = ''INSERT'' or not (old.statut = ''signe'' or old.signature_id is not null))
     and exists (select 1 from jsonb_array_elements(new.reserves) r
                 where r ->> ''levee_le'' is not null or r ->> ''levee_note'' is not null) then
    raise exception ''Une réserve ne peut être levée qu''''après la signature du PV.'' using errcode = ''P0001'';
  end if;
  if tg_op = ''INSERT'' then
    if new.statut <> ''brouillon'' or new.signature_id is not null then
      raise exception ''Un PV se crée en brouillon.'' using errcode = ''P0001'';
    end if;
    return new;
  end if;
  if old.statut = ''signe'' or old.signature_id is not null then
    -- PV signé : seule lever_reserve (qui pose le verrou de transaction « hdecor.levee ») peut écrire une levée.
    if (to_jsonb(new) - array[''reserves'', ''updated_at'']) is distinct from (to_jsonb(old) - array[''reserves'', ''updated_at''])
       or (new.reserves is distinct from old.reserves and coalesce(current_setting(''hdecor.levee'', true), '''') <> ''on'')
       or jsonb_array_length(new.reserves) <> jsonb_array_length(old.reserves)
       or exists (select 1 from jsonb_array_elements(new.reserves) with ordinality n(r, i)
                  join jsonb_array_elements(old.reserves) with ordinality o(r, i) using (i)
                  where n.r ->> ''description'' is distinct from o.r ->> ''description''
                     or (o.r ->> ''levee_le'') is not null and n.r is distinct from o.r) then
      raise exception ''Ce PV est signé : seule la levée d''''une réserve peut encore être notée.'' using errcode = ''P0001'';
    end if;
    -- Levée nouvelle : datée, entre la réception et aujourd''hui (contrôle refait ici, quel que soit le chemin d''écriture).
    if exists (select 1 from jsonb_array_elements(new.reserves) with ordinality n(r, i)
               join jsonb_array_elements(old.reserves) with ordinality o(r, i) using (i)
               where n.r is distinct from o.r
                 and case when coalesce(public.date_iso_valide(n.r ->> ''levee_le''), false)
                          then (n.r ->> ''levee_le'')::date not between new.date_reception and public.aujourd_hui_paris()
                          else true end) then
      raise exception ''Date de levée invalide : entre la réception et aujourd''''hui.'' using errcode = ''P0001'';
    end if;
    return new;
  end if;
  -- Brouillon : un changement de contenu efface le PDF présenté (fichier mis en file de suppression).
  if new.statut = ''brouillon'' and (select bool_or((to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)) from unnest(v_contenu) c)
     and new.pdf_sha256 is not distinct from old.pdf_sha256 then
    if old.pdf_chemin is not null then perform public.mettre_en_file(old.organisation_id, ''documents'', old.pdf_chemin); end if;
    new.pdf_chemin := null;
    new.pdf_sha256 := null;
  end if;
  return new;
end;
$$","-- Remplace la protection générique de la Phase 1 (qui interdisait aussi la levée des réserves).
drop trigger pv_reception_signe on public.pv_reception","create trigger pv_reception_protection before insert or update or delete on public.pv_reception
  for each row execute function public.proteger_pv()","-- Le statut, la signature et le PDF ne s''écrivent que par les fonctions ci-dessous.
revoke update on public.pv_reception from authenticated","grant update (date_reception, avec_reserves, reserves, travaux, observations, delai_levee_jours, devis_id) on public.pv_reception to authenticated","revoke insert on public.pv_reception from authenticated","grant insert (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves, travaux, observations, delai_levee_jours, devis_id)
  on public.pv_reception to authenticated","/** PDF du brouillon présenté au client (déposé par le serveur) : chemin et empreinte. */
create or replace function public.presenter_pv(p_pv_id uuid, p_pdf_chemin text, p_pdf_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception ''PV introuvable.'' using errcode = ''P0002'';
  end if;
  if v_pv.statut <> ''brouillon'' then
    raise exception ''Ce PV est déjà signé.'' using errcode = ''P0001'';
  end if;
  if p_pdf_chemin !~ (''^'' || v_pv.organisation_id::text || ''/pv/'' || v_pv.id::text || ''/[0-9a-f-]{36}\\\\.pdf$'') then
    raise exception ''Chemin du PDF invalide.'' using errcode = ''P0001'';
  end if;
  update public.pv_reception set pdf_chemin = p_pdf_chemin, pdf_sha256 = p_pdf_sha256 where id = p_pv_id;
end;
$$","revoke execute on function public.presenter_pv(uuid, text, text) from public, anon","grant execute on function public.presenter_pv(uuid, text, text) to authenticated","/**
 * Signature sur place : le client signe le PDF présenté (même empreinte :
 * rien n''a changé depuis), l''entreprise aussi (tracé). Le PV devient définitif.
 */
create or replace function public.signer_pv_sur_place(
  p_pv_id uuid, p_nom text, p_mention text, p_image_chemin text, p_image_entreprise_chemin text,
  p_document_sha256 text, p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_pv  public.pv_reception%rowtype;
  v_sig uuid;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception ''PV introuvable.'' using errcode = ''P0002'';
  end if;
  if v_pv.statut <> ''brouillon'' then
    raise exception ''Ce PV est déjà signé.'' using errcode = ''P0001'';
  end if;
  if v_pv.date_reception > public.aujourd_hui_paris() then
    raise exception ''La date de réception est future : la réception se prononce le jour même ou après coup.'' using errcode = ''P0001'';
  end if;
  if v_pv.pdf_sha256 is null or v_pv.pdf_sha256 <> p_document_sha256 then
    raise exception ''Le PV a changé depuis sa présentation : présentez-le à nouveau avant de signer.'' using errcode = ''P0001'';
  end if;
  if p_image_chemin !~ (''^'' || v_pv.organisation_id::text || ''/pv/'' || v_pv.id::text || ''/[0-9a-f-]{36}\\\\.png$'')
     or p_image_entreprise_chemin !~ (''^'' || v_pv.organisation_id::text || ''/pv/'' || v_pv.id::text || ''/[0-9a-f-]{36}\\\\.png$'')
     or p_image_chemin = p_image_entreprise_chemin then
    raise exception ''Tracés de signature invalides.'' using errcode = ''P0001'';
  end if;
  insert into public.signatures (organisation_id, document_type, document_id, methode, signataire_nom,
    mention, image_chemin, document_sha256, ip, user_agent)
  values (v_pv.organisation_id, ''pv_reception'', p_pv_id, ''sur_place'', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_ip, p_user_agent)
  returning id into v_sig;
  update public.pv_reception set statut = ''signe'', signature_id = v_sig, signature_entreprise_chemin = p_image_entreprise_chemin
  where id = p_pv_id;
  return v_sig;
end;
$$","revoke execute on function public.signer_pv_sur_place(uuid, text, text, text, text, text, inet, text) from public, anon","grant execute on function public.signer_pv_sur_place(uuid, text, text, text, text, text, inet, text) to authenticated","/** Levée d''une réserve d''un PV signé (rang à partir de 0) : date et note, une seule fois. */
create or replace function public.lever_reserve(p_pv_id uuid, p_rang integer, p_date date, p_note text)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id for update;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception ''PV introuvable.'' using errcode = ''P0002'';
  end if;
  if v_pv.statut <> ''signe'' then
    raise exception ''Les réserves se lèvent sur un PV signé.'' using errcode = ''P0001'';
  end if;
  if p_rang < 0 or p_rang >= jsonb_array_length(v_pv.reserves) then
    raise exception ''Réserve introuvable.'' using errcode = ''P0002'';
  end if;
  if (v_pv.reserves -> p_rang ->> ''levee_le'') is not null then
    raise exception ''Cette réserve est déjà levée.'' using errcode = ''P0001'';
  end if;
  if p_date < v_pv.date_reception or p_date > public.aujourd_hui_paris() then
    raise exception ''Date de levée : entre la réception et aujourd''''hui.'' using errcode = ''P0001'';
  end if;
  perform set_config(''hdecor.levee'', ''on'', true);
  update public.pv_reception
  set reserves = jsonb_set(reserves, array[p_rang::text],
        (reserves -> p_rang) || jsonb_build_object(''levee_le'', p_date, ''levee_note'', nullif(btrim(coalesce(p_note, '''')), '''')))
  where id = p_pv_id;
  perform set_config(''hdecor.levee'', ''off'', true);
end;
$$","revoke execute on function public.lever_reserve(uuid, integer, date, text) from public, anon","grant execute on function public.lever_reserve(uuid, integer, date, text) to authenticated","-- PDF d''un PV signé : protégé de la file de suppression (comme les documents émis).
create or replace function public.fichier_protege(p_chemin text)
returns boolean
language sql
stable
security definer
set search_path = ''''
as $$
  select exists (select 1 from public.factures f where p_chemin in (f.pdf_chemin, f.facturx_chemin))
      or exists (select 1 from public.devis d where d.pdf_chemin = p_chemin and d.statut = ''accepte'')
      or exists (select 1 from public.signatures s where p_chemin in (s.image_chemin, s.pdf_signe_chemin))
      or exists (select 1 from public.pv_reception p where (p.statut = ''signe'' or p.signature_id is not null)
                 and p_chemin in (p.pdf_chemin, p.signature_entreprise_chemin))
      or exists (select 1 from public.attestations_tva a where a.pdf_chemin = p_chemin and a.signature_id is not null);
$$","-- 4. Demande d''avis -------------------------------------------------------------------
-- Opposition du client aux sollicitations (demande d''avis), datée.
alter table public.clients add column refus_sollicitations_le timestamptz","-- Une seule demande d''avis par facture (hors échec d''envoi).
create unique index envois_demande_avis_unique on public.envois (document_id)
  where nature = ''demande_avis'' and statut <> ''echec''","-- Lien de la page d''avis : une adresse https.
alter table public.parametres_entreprise add constraint avis_google_url_https
  check (avis_google_url is null or avis_google_url ~ ''^https://[^\\\\s]+$'')","-- 5. Notifications --------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  type              text not null check (type in (''devis_consulte'', ''devis_signe'', ''paiement_en_ligne'', ''rappel'')),
  titre             text not null check (length(titre) between 1 and 300),
  lien              text not null check (lien ~ ''^/[a-z0-9/_-]*$''),
  cle               text not null,                     -- dédoublonnage (un événement, une notification)
  cree_le           timestamptz not null default now(),
  lu_le             timestamptz,
  emailee_le        timestamptz,
  unique (organisation_id, cle)
)","create index notifications_org_idx on public.notifications (organisation_id, cree_le desc)","create index notifications_a_emailer_idx on public.notifications (emailee_le) where emailee_le is null","alter table public.notifications enable row level security","create policy membre_lecture on public.notifications for select to authenticated using (public.est_membre(organisation_id))","create policy membre_maj on public.notifications for update to authenticated
  using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id))","revoke all on public.notifications from anon, authenticated","grant select on public.notifications to authenticated","grant update (lu_le) on public.notifications to authenticated","alter table public.parametres_entreprise add column notifier_par_email boolean not null default false","-- Rappel échu déjà signalé (notification créée) : jamais deux fois.
alter table public.rappels add column notifie_le timestamptz","create or replace function public.notifier(p_org uuid, p_type text, p_titre text, p_lien text, p_cle text)
returns void
language sql
security definer
set search_path = ''''
as $$
  -- Titre sur une ligne : aucun caractère de contrôle (pas de fausse ligne dans l''email récapitulatif).
  insert into public.notifications (organisation_id, type, titre, lien, cle)
  values (p_org, p_type, left(regexp_replace(p_titre, ''[[:cntrl:]]+'', '' '', ''g''), 300), p_lien, p_cle)
  on conflict (organisation_id, cle) do nothing;
$$","revoke execute on function public.notifier(uuid, text, text, text, text) from public, anon, authenticated","-- Devis signé PAR LIEN (à distance) ; sur place, Yorick est présent.
create or replace function public.notifier_signature()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_numero text;
begin
  if new.document_type = ''devis'' and new.methode = ''lien'' then
    select numero into v_numero from public.devis where id = new.document_id;
    perform public.notifier(new.organisation_id, ''devis_signe'',
      format(''Devis %s signé à distance'', coalesce(v_numero, '''')),
      ''/devis/'' || new.document_id, ''signature:'' || new.id);
  end if;
  return new;
end;
$$","create trigger signatures_notification after insert on public.signatures
  for each row execute function public.notifier_signature()","-- Premier ouverture du devis par le client.
create or replace function public.notifier_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if old.consulte_le is null and new.consulte_le is not null then
    perform public.notifier(new.organisation_id, ''devis_consulte'',
      format(''Devis %s ouvert par le client'', coalesce(new.numero, '''')), ''/devis/'' || new.id, ''consultation:'' || new.id);
  end if;
  return new;
end;
$$","create trigger devis_notification_consultation after update of consulte_le on public.devis
  for each row execute function public.notifier_consultation()","-- Paiement en ligne (Stripe) enregistré.
create or replace function public.notifier_paiement()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_numero text;
begin
  if new.stripe_evenement_id is not null and new.montant_cents > 0 then
    select numero into v_numero from public.factures where id = new.facture_id;
    perform public.notifier(new.organisation_id, ''paiement_en_ligne'',
      format(''Paiement en ligne reçu : %s € sur la facture %s'',
        -- Format français : espace fine insécable entre les milliers, virgule décimale.
        regexp_replace((new.montant_cents / 100)::text, ''(\\\\d)(?=(\\\\d{3})+$)'', E''\\\\\\\\1\\\\u202F'', ''g'')
          || '','' || lpad((new.montant_cents % 100)::text, 2, ''0''), coalesce(v_numero, '''')),
      ''/factures/'' || new.facture_id, ''paiement:'' || new.id);
  end if;
  return new;
end;
$$","create trigger paiements_notification after insert on public.paiements
  for each row execute function public.notifier_paiement()","/**
 * Rappels échus : une notification chacun (tâche planifiée, clé de service).
 * Renvoie le nombre de rappels signalés.
 */
create or replace function public.notifier_rappels_echus()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_n integer;
begin
  with echus as (
    update public.rappels set notifie_le = now()
    where statut = ''a_envoyer'' and notifie_le is null and echeance <= now()
    returning id, organisation_id, titre, chantier_id
  )
  insert into public.notifications (organisation_id, type, titre, lien, cle)
  select organisation_id, ''rappel'', left(regexp_replace(''Rappel : '' || titre, ''[[:cntrl:]]+'', '' '', ''g''), 300),
         case when chantier_id is null then ''/planning'' else ''/chantiers/'' || chantier_id end, ''rappel:'' || id
  from echus
  on conflict (organisation_id, cle) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$","revoke execute on function public.notifier_rappels_echus() from public, anon, authenticated","grant execute on function public.notifier_rappels_echus() to service_role","/**
 * Archive du PV signé (PDF portant les deux signatures) : une seule fois, pour
 * un PV signé de l''organisation, dans le dossier du PV.
 */
create or replace function public.archiver_pv_signe(p_pv_id uuid, p_chemin text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_pv public.pv_reception%rowtype;
begin
  select * into v_pv from public.pv_reception where id = p_pv_id;
  if v_pv.id is null or not public.est_membre(v_pv.organisation_id) then
    raise exception ''PV introuvable.'' using errcode = ''P0002'';
  end if;
  if v_pv.statut <> ''signe'' then
    raise exception ''Ce PV n''''est pas signé.'' using errcode = ''P0001'';
  end if;
  if p_chemin !~ (''^'' || v_pv.organisation_id::text || ''/pv/'' || v_pv.id::text || ''/[0-9a-f-]{36}\\\\.pdf$'') or p_sha256 !~ ''^[0-9a-f]{64}$'' then
    raise exception ''Archive invalide.'' using errcode = ''P0001'';
  end if;
  update public.signatures set pdf_signe_chemin = p_chemin, pdf_signe_sha256 = p_sha256
  where id = v_pv.signature_id and pdf_signe_sha256 is null;
  if not found then
    raise exception ''PV signé déjà archivé.'' using errcode = ''P0001'';
  end if;
end;
$$","revoke execute on function public.archiver_pv_signe(uuid, text, text) from public, anon","grant execute on function public.archiver_pv_signe(uuid, text, text) to authenticated","-- Modèle « demande d''avis » (modifiable dans Réglages > Messages), créé pour
-- chaque organisation. Message NEUTRE : tous les clients sont invités de la
-- même façon, sans condition de satisfaction (pas de tri des avis). Le client
-- peut s''opposer à ces messages (refus noté).
create or replace function public.initialiser_message_avis(p_organisation_id uuid)
returns void
language sql
security definer
set search_path = ''''
as $$
  insert into public.modeles_messages (organisation_id, code, sujet, corps, delai_jours)
  values (p_organisation_id, ''demande_avis'', ''Votre avis sur nos travaux'',
    E''Bonjour {client},\\\\n\\\\nMerci de nous avoir confié vos travaux. Votre avis, quel qu''''il soit, nous intéresse et aide d''''autres clients à choisir : {lien}\\\\n\\\\nVous ne souhaitez plus recevoir ce type de message ? Dites-le-nous simplement en réponse.\\\\n\\\\nCordialement,\\\\n{entreprise}'', null)
  on conflict (organisation_id, code) do nothing;
$$","revoke execute on function public.initialiser_message_avis(uuid) from public, anon, authenticated","create or replace function public.organisation_initialiser_message_avis()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  perform public.initialiser_message_avis(new.id);
  return new;
end;
$$","revoke execute on function public.organisation_initialiser_message_avis() from public, anon, authenticated","create trigger organisations_initialiser_message_avis after insert on public.organisations
  for each row execute function public.organisation_initialiser_message_avis()","select public.initialiser_message_avis(id) from public.organisations","-- RGPD : à l''anonymisation d''un client, ses notifications (titres pouvant
-- contenir un nom, un rappel ou un numéro de document) sont supprimées, quel
-- que soit le chemin d''effacement (demande du client ou purge automatique).
create or replace function public.purger_notifications_client()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
begin
  if old.anonymise_le is null and new.anonymise_le is not null then
    delete from public.notifications n
    where n.organisation_id = new.organisation_id
      and (n.lien in (select ''/devis/'' || d.id from public.devis d where d.client_id = new.id)
        or n.lien in (select ''/factures/'' || f.id from public.factures f where f.client_id = new.id)
        or n.lien in (select ''/chantiers/'' || c.id from public.chantiers c where c.client_id = new.id)
        or n.cle in (select ''rappel:'' || r.id from public.rappels r
                     where r.chantier_id in (select c.id from public.chantiers c where c.client_id = new.id)
                        or r.evenement_id in (select e.id from public.evenements e
                                              where e.chantier_id in (select c.id from public.chantiers c where c.client_id = new.id))
                        or (r.document_type = ''devis'' and r.document_id in (select d.id from public.devis d where d.client_id = new.id))
                        or (r.document_type = ''facture'' and r.document_id in (select f.id from public.factures f where f.client_id = new.id))));
  end if;
  return new;
end;
$$","revoke execute on function public.purger_notifications_client() from public, anon, authenticated","create trigger clients_purger_notifications after update of anonymise_le on public.clients
  for each row execute function public.purger_notifications_client()","-- Historique des accords de diffusion des photos : chaque accord (texte accepté,
-- date) et son éventuel retrait restent tracés (preuve de l''accord au moment
-- d''une publication). Ni modifiable (hors date de retrait) ni supprimable par une session.
create table public.accords_diffusion_photos (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  chantier_id       uuid not null,
  texte             text not null check (length(texte) between 10 and 500),
  accorde_le        timestamptz not null default now(),
  retire_le         timestamptz,
  foreign key (organisation_id, chantier_id) references public.chantiers (organisation_id, id) on delete cascade,
  check (retire_le is null or retire_le >= accorde_le)
)","create index accords_diffusion_chantier_idx on public.accords_diffusion_photos (organisation_id, chantier_id)","select public.appliquer_rls_standard(''public.accords_diffusion_photos'')","revoke update, delete on public.accords_diffusion_photos from authenticated","grant update (retire_le) on public.accords_diffusion_photos to authenticated","create trigger accords_diffusion_audit after insert or update or delete on public.accords_diffusion_photos
  for each row execute function public.tracer_audit()","-- Notifications : conservées 90 jours (tâche de conservation), puis supprimées.
create or replace function public.purger_notifications()
returns integer
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_n integer;
begin
  delete from public.notifications where cree_le < now() - interval ''90 days'';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$","revoke execute on function public.purger_notifications() from public, anon, authenticated","grant execute on function public.purger_notifications() to service_role"}'::text[]);
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261019000100', 'recette_phase8', E'{"-- Phase 8 (recette) : logo de l''entreprise et textes légaux modifiables.
--
-- 1. Logo : déposé par le serveur dans l''espace privé « marque », sous
--    <organisation>/logo/<uuid>.(png|jpg). Les documents émis gardent le logo
--    de leur date (leur PDF est figé à l''émission).
-- 2. Textes légaux des documents (rétractation, exécution anticipée, « devis
--    reçu », médiateur, rappel de la réception, autoliquidation) : modifiables
--    dans les Paramètres. Absents = texte par défaut de l''application. Tant que
--    le comptable ne les a pas validés (date), ils restent « À VÉRIFIER ».

alter table public.parametres_entreprise
  add constraint logo_chemin_range check (
    logo_chemin is null
    or logo_chemin ~ ''^[0-9a-f-]{36}/logo/[0-9a-f-]{36}\\\\.(png|jpg)$''
  )","create or replace function public.textes_legaux_valides(p jsonb)
returns boolean
language sql
immutable
set search_path = ''''
as $$
  select jsonb_typeof(p) = ''object''
    and not exists (
      select 1 from jsonb_each(p) e
      where e.key not in (''retractation'', ''execution_anticipee'', ''devis_recu'', ''mediateur'', ''rappel_reception'', ''autoliquidation'')
         or jsonb_typeof(e.value) <> ''string''
         or length(btrim(e.value #>> ''{}'')) not between 1 and 3000
         -- Caractères de contrôle interdits, sauf le retour à la ligne.
         or (e.value #>> ''{}'') ~ ''[\\\\x01-\\\\x09\\\\x0b-\\\\x1f\\\\x7f]''
    );
$$","revoke execute on function public.textes_legaux_valides(jsonb) from public, anon","grant execute on function public.textes_legaux_valides(jsonb) to authenticated, service_role","alter table public.parametres_entreprise
  add column textes_legaux jsonb not null default ''{}''::jsonb,
  add column textes_legaux_valides_le date,
  add constraint textes_legaux_forme check (public.textes_legaux_valides(textes_legaux))","-- 3. Acompte : cumul des acomptes précédents sur lequel son montant a été
--    calculé (base en cumulé). À l''émission, il doit être celui des acomptes
--    ÉMIS : sinon (acompte précédent supprimé ou pas encore émis), le montant
--    s''écarterait d''un centime de l''échéancier du devis. Fixé à la création.
alter table public.factures
  add column acompte_cumul_avant_bp integer check (acompte_cumul_avant_bp between 0 and 9999),
  add constraint acompte_cumul_type check (acompte_cumul_avant_bp is null or type = ''acompte'')","grant insert (acompte_cumul_avant_bp) on public.factures to authenticated","-- 4. Contrôles d''émission ajoutés en recette (sous les verrous d''emettre_facture :
--    devis pour un acompte, facture d''origine pour un avoir).
--    a. Acompte : le cumul sur lequel son montant a été calculé doit être celui
--       des acomptes ÉMIS du devis (sinon écart d''un centime avec l''échéancier).
--    b. Avoir : par taux, le cumul des avoirs (base ET TVA) ne dépasse jamais le
--       net de la facture d''origine ; l''avoir qui la solde la solde EXACTEMENT
--       (TVA créditée = TVA facturée, taux par taux).

-- Net par taux d''une facture : sa ventilation moins celle des factures qu''elle déduit.
create or replace function public.ventilation_nette(p_ventilation jsonb, p_deductions jsonb)
returns table (taux_bp integer, base bigint, tva bigint)
language sql
stable
security definer
set search_path = ''''
as $$
  select t, sum(b)::bigint, sum(v)::bigint from (
    select (x ->> ''taux_bp'')::integer t, (x ->> ''base_ht_cents'')::bigint b, (x ->> ''tva_cents'')::bigint v
    from jsonb_array_elements(p_ventilation) x
    union all
    select (x ->> ''taux_bp'')::integer, -(x ->> ''base_ht_cents'')::bigint, -(x ->> ''tva_cents'')::bigint
    from jsonb_array_elements(coalesce(p_deductions, ''[]'')) d
    join public.factures f on f.id = (d ->> ''facture_id'')::uuid,
    jsonb_array_elements(f.ventilation_tva) x
  ) n group by t;
$$","revoke execute on function public.ventilation_nette(jsonb, jsonb) from public, anon, authenticated","create or replace function public.controler_emission_recette()
returns trigger
language plpgsql
security definer
set search_path = ''''
as $$
declare
  v_cumul integer;
  v_origine public.factures%rowtype;
  v_avoirs bigint;
  v_negatif integer;
  v_reste_non_nul integer;
begin
  if not (old.statut = ''brouillon'' and new.statut = ''emise'') then return new; end if;

  if new.type = ''acompte'' and new.acompte_cumul_avant_bp is not null and new.devis_id is not null then
    select coalesce(sum(acompte_pct_bp), 0) into v_cumul from public.factures
    where devis_id = new.devis_id and type = ''acompte'' and statut = ''emise'' and id <> new.id;
    if v_cumul <> new.acompte_cumul_avant_bp then
      raise exception ''Acompte calculé après d''''autres acomptes qui ne sont pas (ou plus) tous émis : supprimez ce brouillon et recréez-le.''
        using errcode = ''P0001'';
    end if;
  end if;

  if new.type = ''avoir'' then
    select * into v_origine from public.factures where id = new.facture_origine_id;
    select coalesce(sum(net_a_payer_cents), 0) into v_avoirs from public.factures
    where facture_origine_id = new.facture_origine_id and type = ''avoir'' and statut = ''emise'' and id <> new.id;
    with reste as (
      select t, sum(b) b, sum(v) v from (
        select taux_bp t, base b, tva v from public.ventilation_nette(v_origine.ventilation_tva, v_origine.deductions)
        union all
        select n.taux_bp, -n.base, -n.tva from public.factures a, lateral public.ventilation_nette(a.ventilation_tva, a.deductions) n
        where a.facture_origine_id = new.facture_origine_id and a.type = ''avoir'' and a.statut = ''emise'' and a.id <> new.id
        union all
        select taux_bp, -base, -tva from public.ventilation_nette(new.ventilation_tva, new.deductions)
      ) x group by t)
    select count(*) filter (where b < 0 or v < 0), count(*) filter (where b <> 0 or v <> 0)
      into v_negatif, v_reste_non_nul from reste;
    if v_negatif > 0 then
      raise exception ''Avoir : pour un taux de TVA, le total des avoirs dépasserait la facture d''''origine.'' using errcode = ''P0001'';
    end if;
    if v_avoirs + new.net_a_payer_cents = v_origine.net_a_payer_cents and v_reste_non_nul > 0 then
      raise exception ''Avoir : il solde la facture sans solder exactement chaque taux de TVA.'' using errcode = ''P0001'';
    end if;
  end if;
  return new;
end;
$$","revoke execute on function public.controler_emission_recette() from public, anon, authenticated","create trigger factures_controle_recette before update of statut on public.factures
  for each row execute function public.controler_emission_recette()","-- 5. Logo : écrit par le SERVEUR seulement (contenu vérifié, métadonnées retirées,
--    dimensions bornées). Plus d''écriture directe dans l''espace « marque » ni de
--    modification de logo_chemin par une session.
drop policy if exists hdecor_ajout on storage.objects","drop policy if exists hdecor_maj on storage.objects","drop policy if exists hdecor_suppr on storage.objects","do $$
declare v_colonnes text;
begin
  select string_agg(quote_ident(column_name), '', '' order by ordinal_position) into v_colonnes
  from information_schema.columns
  where table_schema = ''public'' and table_name = ''parametres_entreprise'' and column_name not in (''organisation_id'', ''logo_chemin'');
  -- La ligne est créée par initialiser_organisation et jamais supprimée : ni insertion ni suppression par une session.
  execute ''revoke insert, update, delete on public.parametres_entreprise from authenticated'';
  execute format(''grant update (%s) on public.parametres_entreprise to authenticated'', v_colonnes);
end $$"}'::text[]);

commit;

-- Contrôle (à lancer après) : 27 lignes attendues.
-- select version, name from supabase_migrations.schema_migrations order by version;
