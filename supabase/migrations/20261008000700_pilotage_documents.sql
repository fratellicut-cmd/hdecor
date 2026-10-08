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
