-- Reproduction minimale de l'environnement Supabase pour tester les
-- migrations sur un PostgreSQL nu : rôles, schéma auth (auth.uid() lit le
-- claim « sub » comme le fait Supabase), schéma storage, schéma extensions.
-- UTILISÉ UNIQUEMENT PAR LES TESTS.

-- Les rôles sont globaux au serveur : création idempotente.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema extensions;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
-- Comme Supabase : auth.jwt() lit les claims de la requête ; table des
-- facteurs de double authentification (colonnes utiles seulement).
create function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  factor_type text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;

grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

-- Privilèges par défaut identiques à Supabase (la RLS fait le tri).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
