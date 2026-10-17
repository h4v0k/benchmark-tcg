-- Browser errors from visitors, so problems on the live site show up on the Admin page instead of going unseen.
-- Written only through log_client_error (rate-limited, deduplicated); readable only by admins.
create table if not exists public.client_errors (
  id bigserial primary key,
  sig text not null,                    -- message + first stack frame, used to group repeats
  message text not null,
  stack text not null default '',
  page text not null default '',
  agent text not null default '',
  release text not null default '',
  signed_in boolean not null default false,
  count int not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (sig, release)
);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

create or replace function public.log_client_error(p_message text, p_stack text, p_page text, p_agent text, p_release text)
returns void language plpgsql security definer set search_path = public as $$
declare v_msg text := left(coalesce(p_message, ''), 300); v_stack text := left(coalesce(p_stack, ''), 1000);
  v_sig text; v_rel text := left(coalesce(p_release, ''), 40); v_hour text := to_char(now() at time zone 'utc', 'YYYYMMDDHH24'); v_n int;
begin
  if v_msg = '' then return; end if;
  -- Anyone can call this, so it's capped hard: at most 300 reports an hour from everyone together (counted per call,
  -- repeats included), and the table never holds more than 1000 groups (~1.5 MB). Rows are kept 14 days.
  insert into public.app_settings as a (key, value) values ('client_errors_hour', v_hour || ':1')
  on conflict (key) do update set value = case when split_part(a.value, ':', 1) = v_hour
    then v_hour || ':' || (coalesce(nullif(split_part(a.value, ':', 2), ''), '0')::int + 1) else v_hour || ':1' end
  returning split_part(value, ':', 2)::int into v_n;
  if v_n > 300 then return; end if;
  v_sig := md5(v_msg || '|' || split_part(v_stack, E'\n', 2));
  if not exists (select 1 from public.client_errors where sig = v_sig and release = v_rel)
     and (select count(*) from public.client_errors) >= 1000 then return; end if;
  insert into public.client_errors (sig, message, stack, page, agent, release, signed_in)
  values (v_sig, v_msg, v_stack, left(coalesce(p_page, ''), 200), left(coalesce(p_agent, ''), 200), v_rel, auth.uid() is not null)
  on conflict (sig, release) do update set count = client_errors.count + 1, last_at = now(),
    page = excluded.page, agent = excluded.agent;
  delete from public.client_errors where last_at < now() - interval '14 days';
end $$;
revoke execute on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text) to anon, authenticated;

create or replace function public.admin_client_errors(p_limit int default 100)
returns setof public.client_errors language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return query select * from public.client_errors order by last_at desc limit least(greatest(p_limit, 1), 500);
end $$;
revoke execute on function public.admin_client_errors(int) from public, anon;
grant execute on function public.admin_client_errors(int) to authenticated;

create or replace function public.admin_clear_client_error(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from public.client_errors where id = p_id;
end $$;
revoke execute on function public.admin_clear_client_error(bigint) from public, anon;
grant execute on function public.admin_clear_client_error(bigint) to authenticated;
