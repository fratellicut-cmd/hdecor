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
