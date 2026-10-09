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
         or v_f.total_ttc_cents <> v_origine.total_ttc_cents) then
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
