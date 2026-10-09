-- =============================================================================
-- H'DECOR (Phase 1) : effacement d'un client sans perte des fichiers à
-- supprimer.
--
-- anonymiser_client renvoie les chemins des fichiers à retirer du stockage.
-- Si le serveur s'arrêtait entre la transaction et la suppression, ces
-- chemins seraient perdus (les lignes qui les portaient sont supprimées) et
-- les fichiers resteraient indéfiniment. effacer_client les inscrit donc dans
-- une file, DANS LA MÊME TRANSACTION ; le serveur la vide ensuite (et la
-- tâche planifiée reprend ce qui a échoué).
-- =============================================================================

create table public.fichiers_a_supprimer (
  id               bigint generated always as identity primary key,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  chemin           text not null,
  cree_le          timestamptz not null default now(),
  tentatives       integer not null default 0,
  derniere_erreur  text,
  check (public.chemin_de_l_organisation(chemin, organisation_id))
);
-- Invisible pour une session : seul le serveur (service_role) la lit et la
-- vide. Politique explicite réservée à service_role (aucune pour authenticated).
alter table public.fichiers_a_supprimer enable row level security;
create policy serveur_uniquement on public.fichiers_a_supprimer for all to service_role
  using (true) with check (true);
revoke all on public.fichiers_a_supprimer from public, anon, authenticated;
grant select, insert, update, delete on public.fichiers_a_supprimer to service_role;

-- Point d'entrée de l'application pour l'effacement d'un client.
-- Renvoie le nombre de fichiers mis en file.
create or replace function public.effacer_client(p_client_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  n integer;
begin
  -- anonymiser_client contrôle l'appartenance (est_membre) et verrouille la fiche.
  select organisation_id into v_org from public.clients where id = p_client_id;
  insert into public.fichiers_a_supprimer (organisation_id, chemin)
  select v_org, c from public.anonymiser_client(p_client_id) c;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.effacer_client(uuid) from public, anon;
grant execute on function public.effacer_client(uuid) to authenticated, service_role;

-- L'application passe obligatoirement par effacer_client : un appel direct
-- d'anonymiser_client par une session perdrait la liste des fichiers.
revoke execute on function public.anonymiser_client(uuid) from authenticated;
