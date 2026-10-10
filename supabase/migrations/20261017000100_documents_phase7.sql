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
         or (jsonb_typeof(r -> 'levee_le') = 'string' and (r ->> 'levee_le') ~ '^\d{4}-\d{2}-\d{2}$'))
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
create or replace function public.proteger_pv()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contenu text[] := array['date_reception', 'avec_reserves', 'reserves', 'travaux', 'observations', 'delai_levee_jours', 'devis_id', 'chantier_id'];
begin
  if tg_op = 'DELETE' then
    if old.statut = 'signe' or old.signature_id is not null then
      raise exception 'Un PV signé ne peut pas être supprimé.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- La signature rattachée est celle de CE PV (même hors API).
  if new.signature_id is not null and (tg_op = 'INSERT' or new.signature_id is distinct from old.signature_id) and not exists (
       select 1 from public.signatures s
       where s.id = new.signature_id and s.organisation_id = new.organisation_id
         and s.document_type = 'pv_reception' and s.document_id = new.id) then
    raise exception 'Cette signature ne correspond pas à ce document.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if new.statut <> 'brouillon' or new.signature_id is not null then
      raise exception 'Un PV se crée en brouillon.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.statut = 'signe' or old.signature_id is not null then
    if (to_jsonb(new) - array['reserves', 'updated_at']) is distinct from (to_jsonb(old) - array['reserves', 'updated_at'])
       or jsonb_array_length(new.reserves) <> jsonb_array_length(old.reserves)
       or exists (select 1 from jsonb_array_elements(new.reserves) with ordinality n(r, i)
                  join jsonb_array_elements(old.reserves) with ordinality o(r, i) using (i)
                  where n.r ->> 'description' is distinct from o.r ->> 'description'
                     or (o.r ->> 'levee_le') is not null and n.r is distinct from o.r) then
      raise exception 'Ce PV est signé : seule la levée d''une réserve peut encore être notée.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Brouillon : un changement de contenu efface le PDF présenté.
  if new.statut = 'brouillon' and (select bool_or((to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)) from unnest(v_contenu) c)
     and new.pdf_sha256 is not distinct from old.pdf_sha256 then
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
  update public.pv_reception
  set reserves = jsonb_set(reserves, array[p_rang::text],
        (reserves -> p_rang) || jsonb_build_object('levee_le', p_date, 'levee_note', nullif(btrim(coalesce(p_note, '')), '')))
  where id = p_pv_id;
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
      or exists (select 1 from public.pv_reception p where p.statut = 'signe' and p_chemin in (p.pdf_chemin, p.signature_entreprise_chemin));
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
  insert into public.notifications (organisation_id, type, titre, lien, cle)
  values (p_org, p_type, left(p_titre, 300), p_lien, p_cle)
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
      format('Devis %s signé à distance par %s', coalesce(v_numero, ''), new.signataire_nom),
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
        (new.montant_cents / 100)::text || ',' || lpad((new.montant_cents % 100)::text, 2, '0'), coalesce(v_numero, '')),
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
  select organisation_id, 'rappel', left('Rappel : ' || titre, 300),
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
