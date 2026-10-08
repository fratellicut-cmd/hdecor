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
