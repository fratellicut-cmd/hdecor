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

