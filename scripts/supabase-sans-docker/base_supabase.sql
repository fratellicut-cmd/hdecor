-- Socle « type Supabase » pour la pile locale sans Docker (développement et
-- tests seulement) : rôles, schémas, privilèges par défaut et tables de
-- stockage minimales. Le schéma auth est créé et migré par GoTrue lui-même.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator-dev';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole password 'auth-admin-dev';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth authorization supabase_auth_admin;
do $$ begin
  execute format('grant create, connect on database %I to supabase_auth_admin', current_database());
end $$;
alter role supabase_auth_admin set search_path = auth;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;

-- Stockage : tables minimales (l'API de stockage n'est pas lancée ici).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null, owner uuid, created_at timestamptz default now(), metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;

-- Privilèges par défaut identiques à Supabase (la RLS fait le tri).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
