-- =============================================================================
-- H'DECOR (Phase 1) : faille H1 de l'audit sécurité (boucle 2).
-- Une ligne photos / documents_chantier pouvait pointer vers le PDF d'une
-- facture émise ; l'effacement du client propriétaire de cette ligne mettait
-- alors ce PDF en file de suppression (clé de service : la politique de
-- stockage qui protège les documents émis ne s'appliquait pas).
-- Défenses, de la plus forte à la dernière ligne :
--   1. les fichiers de chantier vivent sous <org>/chantiers/<chantier>/… :
--      ils ne peuvent plus désigner un document émis ;
--   2. leur chemin et leur espace ne sont plus modifiables par une session ;
--   3. un document de chantier ne vit que dans l'espace « justificatifs » ;
--   4. la file refuse tout chemin référencé par un document émis, signé ou
--      accepté, et n'accepte que les espaces documents / photos / justificatifs.
-- =============================================================================

-- 1. Préfixe propre au chantier ------------------------------------------------
create or replace function public.chemin_du_chantier(p_chemin text, p_organisation_id uuid, p_chantier_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_chemin like p_organisation_id::text || '/chantiers/' || p_chantier_id::text || '/%'
     and position('..' in p_chemin) = 0
     and position('//' in p_chemin) = 0;
$$;
-- Fonction pure appelée par les contraintes CHECK : celles-ci s'évaluent avec
-- les droits de la session qui insère (comme chemin_de_l_organisation).
revoke execute on function public.chemin_du_chantier(text, uuid, uuid) from public, anon;
grant execute on function public.chemin_du_chantier(text, uuid, uuid) to authenticated, service_role;

alter table public.photos add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id));
alter table public.documents_chantier add constraint chemin_du_chantier
  check (public.chemin_du_chantier(chemin, organisation_id, chantier_id));

-- 3. Un seul espace pour les documents de chantier ----------------------------
alter table public.documents_chantier drop constraint documents_chantier_espace_check;
alter table public.documents_chantier add constraint documents_chantier_espace_check check (espace = 'justificatifs');

-- 2. Chemin et espace figés après dépôt ----------------------------------------
revoke update on public.photos from authenticated;
grant update (piece_id, moment, annotations, legende) on public.photos to authenticated;
revoke update on public.documents_chantier from authenticated;
grant update (type, nom) on public.documents_chantier to authenticated;

-- 4. File de suppression : jamais un document protégé --------------------------
alter table public.fichiers_a_supprimer drop constraint fichiers_a_supprimer_espace_check;
alter table public.fichiers_a_supprimer add constraint fichiers_a_supprimer_espace_check
  check (espace in ('documents', 'photos', 'justificatifs'));

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
      or exists (select 1 from public.pv_reception p where p.pdf_chemin = p_chemin and p.signature_id is not null)
      or exists (select 1 from public.attestations_tva a where a.pdf_chemin = p_chemin and a.signature_id is not null);
$$;
revoke execute on function public.fichier_protege(text) from public, anon, authenticated;

-- Une ligne visant un fichier protégé est écartée (pas d'erreur : l'effacement
-- RGPD du reste doit aboutir) ; l'écart est tracé dans les journaux serveur.
create or replace function public.file_sans_fichier_protege()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.fichier_protege(new.chemin) then
    raise warning 'Fichier protégé écarté de la file de suppression (organisation %)', new.organisation_id;
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.file_sans_fichier_protege() from public, anon, authenticated;
create trigger fichiers_a_supprimer_proteges before insert on public.fichiers_a_supprimer
  for each row execute function public.file_sans_fichier_protege();

-- Relecture : la fiche anonymisée reste figée pour les sessions et la clé de
-- service ; le propriétaire (migrations, fonctions internes) garde la main
-- pour une évolution de schéma (nouvelle colonne à remplir, par exemple).
create or replace function public.client_anonymise_fige()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymise_le is not null and current_user in ('authenticated', 'anon', 'service_role') then
    raise exception 'Fiche anonymisée : modification impossible.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
