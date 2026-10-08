-- Minimal Supabase stand-ins so migrations can run on plain Postgres. Test use only.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema extensions;
create schema net;
create schema cron;
create schema auth;

create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into id;
  return id;
end $$;

create table net._http_response (id bigint, status_code int, content text, timed_out bool, error_msg text, created timestamptz not null default now());
create table net.sent (id bigserial primary key, url text, at timestamptz default now());
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare nid bigint;
begin
  insert into net.sent (url) values (url) returning id into nid;
  return nid;
end $$;

create table public.app_settings (key text primary key, value text not null);
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
