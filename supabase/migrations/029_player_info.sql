-- Private tournament details for deck registration sheets. Only the owner can read or write their row.
-- Date of birth is deliberately NOT stored here: it stays on the device.

create table if not exists public.player_info (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  player_name text not null default '' check (char_length(player_name) <= 60),
  player_id text not null default '' check (player_id ~ '^[0-9]{0,12}$'),
  division text not null default '' check (division in ('', 'junior', 'senior', 'masters')),
  updated_at timestamptz not null default now()
);
alter table public.player_info enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'player_info' and policyname = 'player_info select') then
    create policy "player_info select" on public.player_info for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'player_info' and policyname = 'player_info insert') then
    create policy "player_info insert" on public.player_info for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'player_info' and policyname = 'player_info update') then
    create policy "player_info update" on public.player_info for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'player_info' and policyname = 'player_info delete') then
    create policy "player_info delete" on public.player_info for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;

revoke all on public.player_info from anon, authenticated, public;
grant select, insert, update, delete on public.player_info to authenticated;

create or replace function public.player_info_fill() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then new.user_id := auth.uid(); end if;
  new.updated_at := now();
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'player_info_fill' and tgrelid = 'public.player_info'::regclass) then
    create trigger player_info_fill before insert or update on public.player_info
      for each row execute function public.player_info_fill();
  end if;
end $$;
