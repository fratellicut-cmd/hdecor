-- =============================================================================
-- H'DECOR (Phase 1) : corrections demandées par les audits de fin de phase.
--   1. Fichiers à supprimer : l'espace de stockage est connu et enregistré
--      (plus de suppression « dans tous les espaces »).
--   2. Une seule liste des champs effacés d'une fiche client (anonymisation
--      à la demande ET purge automatique passent par la même fonction).
--   3. Une fiche anonymisée ne peut plus être modifiée, même par l'API.
--   4. Purge des prospects étendue aux clients sans devis accepté ni facture
--      émise, et seulement une fois la durée de conservation confirmée.
--   5. Confirmation des valeurs « À VÉRIFIER » atomique (pas de lecture puis
--      écriture côté serveur).
-- =============================================================================

-- 1. Espaces de stockage ------------------------------------------------------
alter table public.documents_chantier
  add column espace text not null default 'justificatifs' check (espace in ('documents', 'justificatifs'));

alter table public.fichiers_a_supprimer
  add column espace text not null default 'documents' check (espace in ('documents', 'photos', 'justificatifs', 'signatures', 'marque'));
alter table public.fichiers_a_supprimer alter column espace drop default;
create index fichiers_a_supprimer_org_idx on public.fichiers_a_supprimer (organisation_id);
create index fichiers_a_supprimer_reprise_idx on public.fichiers_a_supprimer (tentatives, id);

-- 3. Fiche anonymisée figée ---------------------------------------------------
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymise_le is not null then
    raise exception 'Fiche anonymisée : modification impossible.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function public.client_anonymise_fige() from public, anon, authenticated;
create trigger clients_anonymise_fige before update on public.clients
  for each row execute function public.client_anonymise_fige();

-- 2. Anonymisation : cœur commun ----------------------------------------------
-- Effacement de la fiche elle-même : UNIQUE liste des champs personnels.
create or replace function public.vider_fiche_client(p_client_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.clients set
    civilite = null, nom = 'Client anonymisé', prenom = null, raison_sociale = null,
    siret = null, tva_intra = null, email = null, telephone = null,
    fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
    notes = null, source = null, consentement_le = null, anonymise_le = now()
  where id = p_client_id;
$$;
revoke execute on function public.vider_fiche_client(uuid) from public, anon, authenticated;

-- Anonymisation complète SANS contrôle d'appartenance : réservée aux
-- fonctions qui ont déjà contrôlé (effacer_client) ou au serveur (purge).
-- Renvoie l'espace et le chemin de chaque fichier à supprimer du stockage.
drop function public.effacer_client(uuid);
drop function public.anonymiser_client(uuid);
create function public.anonymiser_client_interne(p_client_id uuid)
returns table (espace text, chemin text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chantiers uuid[];
  v_devis_non_acceptes uuid[];
begin
  perform 1 from public.clients where id = p_client_id for update;
  select coalesce(array_agg(id), '{}') into v_chantiers from public.chantiers where client_id = p_client_id;

  perform public.vider_fiche_client(p_client_id);

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

  -- PV non signés et attestations de devis jamais acceptés : supprimés.
  -- (Une attestation SIGNÉE est conservée comme preuve, durée À VÉRIFIER.)
  return query delete from public.pv_reception p
    where p.chantier_id = any (v_chantiers) and p.signature_id is null and p.pdf_chemin is not null
    returning 'documents'::text, p.pdf_chemin;
  delete from public.pv_reception where chantier_id = any (v_chantiers) and signature_id is null;
  return query delete from public.attestations_tva a
    where a.devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and a.signature_id is null and a.pdf_chemin is not null
    returning 'documents'::text, a.pdf_chemin;
  delete from public.attestations_tva
    where devis_id in (select id from public.devis where client_id = p_client_id and statut <> 'accepte')
      and signature_id is null;

  -- Brouillons : supprimés (aucun numéro attribué, aucune obligation).
  delete from public.factures where client_id = p_client_id and statut = 'brouillon';
  delete from public.devis d where d.client_id = p_client_id and d.statut = 'brouillon'
    and not exists (select 1 from public.devis v where v.devis_precedent_id = d.id);

  select coalesce(array_agg(id), '{}') into v_devis_non_acceptes
  from public.devis where client_id = p_client_id and statut in ('envoye', 'refuse', 'remplace');

  update public.liens_publics set revoque_le = now()
  where revoque_le is null
    and (devis_id in (select id from public.devis where client_id = p_client_id)
         or facture_id in (select id from public.factures where client_id = p_client_id));

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

  return query select 'documents'::text, d.pdf_chemin from public.devis d
    where d.id = any (v_devis_non_acceptes) and d.pdf_chemin is not null;
  return query delete from public.photos ph where ph.chantier_id = any (v_chantiers)
    returning 'photos'::text, ph.chemin;
  return query delete from public.documents_chantier dc where dc.chantier_id = any (v_chantiers)
    returning dc.espace, dc.chemin;
end;
$$;
revoke execute on function public.anonymiser_client_interne(uuid) from public, anon, authenticated, service_role;

-- Point d'entrée de l'application : contrôle d'appartenance, anonymisation et
-- mise en file des fichiers dans la même transaction.
create function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_anonymise timestamptz;
  n integer;
begin
  select organisation_id, anonymise_le into v_org, v_anonymise from public.clients where id = p_client_id for update;
  if v_org is null or not public.est_membre(v_org) then
    raise exception 'Client introuvable.' using errcode = 'P0002';
  end if;
  if v_anonymise is not null then
    raise exception 'Client déjà anonymisé.' using errcode = 'P0001';
  end if;
  insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
  select v_org, f.espace, f.chemin from public.anonymiser_client_interne(p_client_id) f;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.effacer_client(uuid) from public, anon;
grant execute on function public.effacer_client(uuid) to authenticated, service_role;

-- 4. Purge automatique des prospects ------------------------------------------
-- Client sans facture émise ni devis accepté, sans activité (fiche, devis,
-- chantier) depuis la durée paramétrée. Rien n'est purgé tant que cette
-- durée est encore « À VÉRIFIER » (purge irréversible).
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    select c.id, c.organisation_id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and not ('duree_conservation_prospects_mois' = any (p.valeurs_a_verifier))
      and not exists (select 1 from public.factures f where f.client_id = c.id and f.statut <> 'brouillon')
      and not exists (select 1 from public.devis d where d.client_id = c.id and d.statut = 'accepte')
      and greatest(c.created_at, c.updated_at,
                   (select max(d.updated_at) from public.devis d where d.client_id = c.id),
                   (select max(ch.updated_at) from public.chantiers ch where ch.client_id = c.id))
          < now() - make_interval(months => p.duree_conservation_prospects_mois)
  loop
    insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
    select v.organisation_id, f.espace, f.chemin from public.anonymiser_client_interne(v.id) f;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated;
grant execute on function public.purger_prospects_inactifs() to service_role;

-- 5. Confirmation atomique des valeurs « À VÉRIFIER » --------------------------
-- SECURITY INVOKER : la RLS limite la mise à jour à l'organisation du membre.
create or replace function public.confirmer_valeurs(p_organisation_id uuid, p_confirmees text[])
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with maj as (
    update public.parametres_entreprise
    set valeurs_a_verifier = array(select v from unnest(valeurs_a_verifier) v where v <> all (coalesce(p_confirmees, '{}')))
    where organisation_id = p_organisation_id
    returning 1)
  select exists (select 1 from maj);
$$;
revoke execute on function public.confirmer_valeurs(uuid, text[]) from public, anon;
grant execute on function public.confirmer_valeurs(uuid, text[]) to authenticated;
