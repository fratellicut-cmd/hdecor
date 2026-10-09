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
