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
