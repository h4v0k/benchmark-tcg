-- Extra Supabase stand-ins (on top of stubs.sql) so the whole migration chain 001..N runs on plain Postgres. Test use only.
drop function public.is_admin(); drop table public.app_settings;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create extension if not exists pg_trgm schema extensions;
create extension if not exists pgcrypto schema extensions;
alter database postgres set search_path = public, extensions;
-- Supabase gives the API roles table access by default and relies on row-level security.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
