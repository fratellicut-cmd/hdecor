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
