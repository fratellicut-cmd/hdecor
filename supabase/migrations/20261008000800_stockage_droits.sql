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
