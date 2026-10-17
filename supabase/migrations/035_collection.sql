-- 035: my collection. Owned cards are counted per printing (cards.id); a deck can count any printing of the
-- same card (same cards.sig) as owned. Private: only the owner can see or change their rows.

create table if not exists public.collection (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references public.cards(id) on delete cascade,
  qty int not null check (qty between 0 and 999),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_id)
);
alter table public.collection enable row level security;
drop policy if exists "collection select own" on public.collection;
drop policy if exists "collection insert own" on public.collection;
drop policy if exists "collection update own" on public.collection;
drop policy if exists "collection delete own" on public.collection;
create policy "collection select own" on public.collection for select to authenticated using (user_id = (select auth.uid()));
create policy "collection insert own" on public.collection for insert to authenticated with check (user_id = (select auth.uid()));
create policy "collection update own" on public.collection for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "collection delete own" on public.collection for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.collection from anon, authenticated;
grant select, insert, update, delete on public.collection to authenticated;

-- The server's clock decides updated_at.
create or replace function public.collection_touch() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists collection_touch on public.collection;
create trigger collection_touch before insert or update on public.collection for each row execute function public.collection_touch();

-- The signed-in person's owned printings of the given cards (by gameplay identity), for the deck page.
create or replace function public.my_collection_for(p_sigs text[])
returns table (card_id text, sig text, qty int)
language sql stable security invoker set search_path = public as $$
  select c.id, c.sig, o.qty
  from public.cards c
  join public.collection o on o.card_id = c.id and o.user_id = auth.uid()
  where c.sig = any (p_sigs) and o.qty > 0
$$;
revoke execute on function public.my_collection_for(text[]) from public, anon;
grant execute on function public.my_collection_for(text[]) to authenticated;
