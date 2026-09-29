-- Benchmark database setup (already applied to your Supabase project).
-- To recreate it elsewhere: Supabase dashboard → SQL Editor → New query → paste this file → Run.

-- Usernames
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

-- Decks (cards are stored as a JSON list on the deck)
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null default 'Untitled deck' check (char_length(name) between 1 and 80),
  format text not null default 'standard' check (format in ('standard','expanded','unlimited')),
  description text not null default '' check (char_length(description) <= 4000),
  is_public boolean not null default false,
  cards jsonb not null default '[]'::jsonb,
  cover text not null default '',
  price numeric(10,2) not null default 0,
  card_count int not null default 0,
  like_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index decks_owner on public.decks (owner, updated_at desc);
create index decks_public on public.decks (is_public, like_count desc, updated_at desc);

-- Likes
create table public.deck_likes (
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);

-- Keep like_count honest: only the like trigger may change it.
create or replace function public.guard_like_count() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.like_count := 0;
  elsif new.like_count is distinct from old.like_count
        and coalesce(current_setting('benchmark.like_bump', true), '') <> 'on' then
    new.like_count := old.like_count;
  end if;
  return new;
end $$;
create trigger decks_guard_like_count before insert or update on public.decks
for each row execute function public.guard_like_count();

create or replace function public.bump_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('benchmark.like_bump', 'on', true);
  if tg_op = 'INSERT' then
    update public.decks set like_count = like_count + 1 where id = new.deck_id;
  else
    update public.decks set like_count = greatest(like_count - 1, 0) where id = old.deck_id;
  end if;
  perform set_config('benchmark.like_bump', 'off', true);
  return null;
end $$;
create trigger deck_likes_bump after insert or delete on public.deck_likes
for each row execute function public.bump_like_count();

-- Row level security
alter table public.profiles enable row level security;
alter table public.decks enable row level security;
alter table public.deck_likes enable row level security;

create policy "Profiles are public" on public.profiles for select using (true);
create policy "Create your own profile" on public.profiles for insert with check (auth.uid() = id);

create policy "Read public decks and your own" on public.decks for select using (is_public or owner = auth.uid());
create policy "Create your own decks" on public.decks for insert with check (owner = auth.uid());
create policy "Edit your own decks" on public.decks for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "Delete your own decks" on public.decks for delete using (owner = auth.uid());

create policy "Likes are public" on public.deck_likes for select using (true);
create policy "Like public decks you don't own" on public.deck_likes for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.decks d where d.id = deck_id and d.is_public and d.owner <> auth.uid())
);
create policy "Remove your own likes" on public.deck_likes for delete using (user_id = auth.uid());

revoke execute on function public.bump_like_count() from public, anon, authenticated;
revoke execute on function public.guard_like_count() from public, anon, authenticated;

-- TCGplayer product cache used by the "tcgplayer" Edge Function.
-- Only the Edge Function (service role) reads and writes these tables.
create table if not exists public.tcgp_groups (
  group_id int primary key,
  name text not null,
  abbreviation text not null default '',
  fetched_at timestamptz not null default now()
);
create table if not exists public.tcgp_group_sync (
  group_id int primary key,
  synced_at timestamptz not null default now()
);
create table if not exists public.tcgp_products (
  product_id int primary key,
  group_id int not null,
  name text not null,
  number_raw text not null default '',
  number_key text not null default '',
  url text not null default ''
);
create index if not exists tcgp_products_lookup on public.tcgp_products (group_id, number_key);
alter table public.tcgp_groups enable row level security;
alter table public.tcgp_group_sync enable row level security;
alter table public.tcgp_products enable row level security;
