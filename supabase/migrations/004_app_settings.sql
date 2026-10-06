-- Private settings (no RLS policies: only the service role and SQL can read them).
create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex')) on conflict (key) do nothing;
