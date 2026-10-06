-- Benchmark v2: card catalog, legality engine, social features.
-- Builds on 001_initial.sql. Safe to run once on the existing project.

create extension if not exists pg_trgm with schema extensions;

/* ============================================================
   Card catalog (mirrored from TCGdex by the catalog-sync function)
   ============================================================ */
create table if not exists public.sets (
  id text primary key,                     -- TCGdex set id, e.g. sv02
  name text not null,
  series text not null default '',
  code text not null default '',           -- Pokémon TCG Live / TCGplayer code, e.g. PAL
  release_date date,
  legal_date date,                         -- tournament-legal from (2 weeks after release)
  reg_mark text not null default '',       -- most common regulation mark in the set
  official_count int,
  total_count int,
  logo text not null default '',
  symbol text not null default '',
  is_promo boolean not null default false,
  is_classic boolean not null default false, -- Classic Collection: never tournament legal
  tcgp_group_id int,
  briefs_at timestamptz,                   -- when the card list was last fetched
  prices_at timestamptz,                   -- when prices were last refreshed
  created_at timestamptz not null default now()
);

-- Extra spellings of set codes seen in deck lists (PTCGL, PTCGO, Limitless).
create table if not exists public.set_codes (
  code text primary key,
  set_id text not null references public.sets(id) on delete cascade
);

create table if not exists public.cards (
  id text primary key,                     -- TCGdex card id, e.g. sv02-185
  set_id text not null references public.sets(id) on delete cascade,
  local_id text not null,
  num_key text not null default '',        -- collector number normalized for matching ("185", "TG5")
  name text not null,
  name_norm text not null default '',
  category text not null default '',       -- Pokemon | Trainer | Energy
  stage text not null default '',
  trainer_type text not null default '',
  energy_type text not null default '',
  suffix text not null default '',
  evolves_from text not null default '',
  types text[] not null default '{}',
  hp int,
  retreat int,
  rarity text not null default '',
  reg_mark text not null default '',
  illustrator text not null default '',
  effect text not null default '',
  abilities jsonb not null default '[]',
  attacks jsonb not null default '[]',
  weaknesses jsonb not null default '[]',
  resistances jsonb not null default '[]',
  variants text[] not null default '{}',   -- normal, holo, reverse, firstEdition
  image text not null default '',
  sig text not null default '',            -- gameplay identity, used for the reprint rules
  is_ace boolean not null default false,
  is_radiant boolean not null default false,
  is_prism boolean not null default false,
  is_basic_energy boolean not null default false,
  tcgp_product_id int,
  prices jsonb not null default '{}'::jsonb, -- TCGplayer market price per finish {normal, holo, reverse}
  prices_at timestamptz,
  tcgdex_legal jsonb,                      -- TCGdex's own legality flags, kept as a cross-check
  legal_standard boolean not null default false,
  legal_expanded boolean not null default false,
  standard_from date,                      -- not legal yet: becomes Standard legal on this date
  rotating boolean not null default false, -- leaves Standard at the next announced rotation
  rotating_on date,                        -- that rotation's date (null = not announced yet)
  banned_in text[] not null default '{}',
  detail_at timestamptz,                   -- when full card details were last fetched
  updated_at timestamptz not null default now()
);
create index if not exists cards_set on public.cards (set_id);
create index if not exists cards_name on public.cards (name_norm);
create index if not exists cards_name_trgm on public.cards using gin (name_norm extensions.gin_trgm_ops);
create index if not exists cards_sig on public.cards (sig);
create index if not exists cards_num on public.cards (num_key);
create index if not exists cards_detail on public.cards (detail_at nulls first);
create index if not exists cards_product on public.cards (tcgp_product_id);

/* ============================================================
   Format rules (kept current by the rules-sync function; admins can edit)
   ============================================================ */
create table if not exists public.format_rules (
  format text primary key check (format in ('standard', 'expanded')),
  min_mark text,                           -- Standard: lowest legal regulation mark
  min_release date,                        -- Expanded: earliest legal set release
  season text not null default '',
  notes text not null default '',
  source text not null default '',
  checked_at timestamptz,                  -- last time the rules were checked against the source
  updated_at timestamptz not null default now()
);
insert into public.format_rules (format, min_mark, min_release, season, notes, source) values
  ('standard', 'H', null, '2026-27', 'Regulation marks H and later. In effect since April 10, 2026 (March 26 on Pokémon TCG Live).', 'https://bulbapedia.bulbagarden.net/wiki/Standard_format_(TCG)'),
  ('expanded', null, '2011-04-25', '', 'Black & White onward.', 'https://bulbapedia.bulbagarden.net/wiki/Expanded_format_(TCG)')
on conflict (format) do nothing;

create table if not exists public.rotations (
  id bigint generated always as identity primary key,
  format text not null default 'standard' check (format = 'standard'),
  new_min_mark text not null check (new_min_mark ~ '^[A-Z]$'),
  season text not null default '',
  effective_date date,                     -- null: announced, date not confirmed yet
  online_date date,                        -- Pokémon TCG Live usually rotates earlier
  source text not null default '',
  created_at timestamptz not null default now(),
  unique (format, new_min_mark)
);
insert into public.rotations (new_min_mark, season, effective_date, online_date, source) values
  ('H', '2026-27', '2026-04-10', '2026-03-26', 'https://www.pokemon.com/us/pokemon-news/2026-pokemon-tcg-standard-format-rotation-announcement')
on conflict do nothing;

create table if not exists public.bans (
  id bigint generated always as identity primary key,
  format text not null check (format in ('standard', 'expanded')),
  card_name text not null,
  printings jsonb not null default '[]',   -- [{"set": "Noble Victories", "num": "67"}] as published
  printings_key text not null default '',
  card_ids text[] not null default '{}',   -- resolved catalog printings
  effective_date date,
  source text not null default '',
  note text not null default '',
  active boolean not null default true,
  first_seen timestamptz not null default now(),
  removed_at timestamptz,
  unique (format, card_name, printings_key)
);

-- Public log of every rules change: bans, unbans, rotations, new sets becoming legal.
create table if not exists public.rule_changes (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  format text not null default '',
  kind text not null,                      -- ban | unban | rotation | rotation_announced | set_legal | set_added | rules
  title text not null,
  detail text not null default '',
  card_ids text[] not null default '{}'
);
create index if not exists rule_changes_time on public.rule_changes (happened_at desc);

create table if not exists public.sync_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  detail jsonb not null default '{}'
);
create index if not exists sync_runs_job on public.sync_runs (job, started_at desc);

/* ============================================================
   Profiles, decks and social
   ============================================================ */
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists bio text not null default '' check (char_length(bio) <= 500);
alter table public.profiles add column if not exists avatar_card text not null default '';
alter table public.profiles add column if not exists follower_count int not null default 0;
alter table public.profiles add column if not exists following_count int not null default 0;

create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists folders_owner on public.folders (owner);

alter table public.decks add column if not exists primer text not null default '' check (char_length(primer) <= 20000);
alter table public.decks add column if not exists tags text[] not null default '{}';
alter table public.decks add column if not exists folder_id uuid references public.folders(id) on delete set null;
alter table public.decks add column if not exists view_count int not null default 0;
alter table public.decks add column if not exists comment_count int not null default 0;
alter table public.decks add column if not exists featured boolean not null default false;
alter table public.decks add column if not exists card_names text[] not null default '{}';
alter table public.decks add column if not exists archetype text not null default '' check (char_length(archetype) <= 60);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'decks_tags_check') then
    alter table public.decks add constraint decks_tags_check check (cardinality(tags) <= 10 and array_to_string(tags, '') !~ '[<>]');
  end if;
end $$;
create index if not exists decks_featured on public.decks (featured, updated_at desc) where featured and is_public;
create index if not exists decks_card_names on public.decks using gin (card_names);
create index if not exists decks_tags on public.decks using gin (tags);
create index if not exists decks_name_trgm on public.decks using gin (lower(name) extensions.gin_trgm_ops);

create table if not exists public.follows (
  follower uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index if not exists follows_followee on public.follows (followee);

create table if not exists public.deck_comments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists deck_comments_deck on public.deck_comments (deck_id, created_at);

create table if not exists public.deck_views (
  deck_id uuid not null references public.decks(id) on delete cascade,
  viewer text not null,
  day date not null default current_date,
  primary key (deck_id, viewer, day)
);

/* ---------- helpers ---------- */
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

/* ---------- counters only the database may change ---------- */
-- Replaces the body of the original like-count guard; its trigger (decks_guard_like_count) stays.
create or replace function public.guard_like_count() returns trigger
language plpgsql set search_path = public as $$
declare bump boolean := coalesce(current_setting('benchmark.counter_bump', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.like_count := 0; new.view_count := 0; new.comment_count := 0; new.featured := false;
  elsif not bump then
    new.like_count := old.like_count;
    new.view_count := old.view_count;
    new.comment_count := old.comment_count;
    new.featured := old.featured;
    new.owner := old.owner;
  end if;
  -- searchable names of the cards in the deck
  new.card_names := coalesce((select array_agg(distinct x->>'name') from jsonb_array_elements(new.cards) x where x->>'name' is not null), '{}');
  new.tags := coalesce((select array_agg(distinct lower(btrim(t))) from unnest(new.tags) t where btrim(t) <> '' and char_length(btrim(t)) <= 24), '{}');
  if new.folder_id is not null and not exists (select 1 from public.folders f where f.id = new.folder_id and f.owner = new.owner) then
    new.folder_id := null;
  end if;
  if tg_op = 'UPDATE' and new.cards is distinct from old.cards or tg_op = 'UPDATE' and new.name is distinct from old.name then
    new.updated_at := now();
  end if;
  return new;
end $$;

create or replace function public.bump_like_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('benchmark.counter_bump', 'on', true);
  if tg_op = 'INSERT' then
    update public.decks set like_count = like_count + 1 where id = new.deck_id;
  else
    update public.decks set like_count = greatest(like_count - 1, 0) where id = old.deck_id;
  end if;
  perform set_config('benchmark.counter_bump', 'off', true);
  return null;
end $$;

create or replace function public.bump_comment_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('benchmark.counter_bump', 'on', true);
  if tg_op = 'INSERT' then
    update public.decks set comment_count = comment_count + 1 where id = new.deck_id;
  else
    update public.decks set comment_count = greatest(comment_count - 1, 0) where id = old.deck_id;
  end if;
  perform set_config('benchmark.counter_bump', 'off', true);
  return null;
end $$;
create trigger deck_comments_bump after insert or delete on public.deck_comments
for each row execute function public.bump_comment_count();

create or replace function public.bump_follow_counts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('benchmark.profile_bump', 'on', true);
  if tg_op = 'INSERT' then
    update public.profiles set follower_count = follower_count + 1 where id = new.followee;
    update public.profiles set following_count = following_count + 1 where id = new.follower;
  else
    update public.profiles set follower_count = greatest(follower_count - 1, 0) where id = old.followee;
    update public.profiles set following_count = greatest(following_count - 1, 0) where id = old.follower;
  end if;
  perform set_config('benchmark.profile_bump', 'off', true);
  return null;
end $$;
create trigger follows_bump after insert or delete on public.follows
for each row execute function public.bump_follow_counts();

-- People may edit their bio and avatar, never their admin flag, counters or username.
create or replace function public.guard_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('benchmark.profile_bump', true), '') = 'on' then return new; end if;
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_admin := false; new.follower_count := 0; new.following_count := 0;
    else
      new.is_admin := old.is_admin;
      new.follower_count := old.follower_count;
      new.following_count := old.following_count;
      new.username := old.username;
      new.id := old.id;
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard_columns before insert or update on public.profiles
for each row execute function public.guard_profile_columns();

-- Count a view at most once per viewer per day.
create or replace function public.record_view(p_deck uuid, p_viewer text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := coalesce(auth.uid()::text, 'a:' || left(coalesce(p_viewer, ''), 64));
begin
  if v = 'a:' then return; end if;
  if not exists (select 1 from public.decks where id = p_deck and (is_public or owner = auth.uid())) then return; end if;
  insert into public.deck_views (deck_id, viewer) values (p_deck, v) on conflict do nothing;
  if found then
    perform set_config('benchmark.counter_bump', 'on', true);
    update public.decks set view_count = view_count + 1 where id = p_deck and owner is distinct from auth.uid();
    perform set_config('benchmark.counter_bump', 'off', true);
  end if;
end $$;

create or replace function public.set_featured(p_deck uuid, p_featured boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can feature decks'; end if;
  perform set_config('benchmark.counter_bump', 'on', true);
  update public.decks set featured = p_featured where id = p_deck and is_public;
  perform set_config('benchmark.counter_bump', 'off', true);
end $$;

/* ============================================================
   Legality engine
   Standard: regulation mark at or above the current minimum (rotations apply on their date).
     Trainer and Special Energy cards are also legal in any print when a print of the same
     card (same name and text) is legal. Pokémon must carry a legal mark themselves.
   Expanded: sets released on or after Black & White, with the same reprint rule.
   Both: a set becomes legal on its legal date (reprints of already-legal cards right away);
     Basic Energy is always legal; Classic Collection never; banned printings never.
   ============================================================ */
create or replace function public.recompute_legality() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  std_mark text;
  exp_from date;
  nxt record;
  res jsonb;
begin
  select greatest(fr.min_mark, coalesce((select max(r.new_min_mark) from public.rotations r where r.effective_date <= current_date), fr.min_mark))
    into std_mark from public.format_rules fr where fr.format = 'standard';
  select min_release into exp_from from public.format_rules where format = 'expanded';
  select * into nxt from public.rotations r
    where r.new_min_mark > std_mark and (r.effective_date is null or r.effective_date > current_date)
    order by r.new_min_mark limit 1;

  with base as (
    select c.id, c.name, c.sig, c.category, c.is_basic_energy, s.is_classic, s.legal_date,
           coalesce(nullif(c.reg_mark, ''), case when not c.is_basic_energy then nullif(s.reg_mark, '') end, '') as mark,
           (s.legal_date is null or s.legal_date <= current_date) as live,
           (s.release_date is not null and s.release_date >= exp_from) as exp_era,
           c.legal_standard as old_std
    from public.cards c join public.sets s on s.id = c.set_id
  ), f as (
    select base.*,
           (mark ~ '^[A-Z]$' and mark >= std_mark) as mark_ok,
           (nxt.new_min_mark is null or (mark ~ '^[A-Z]$' and mark >= nxt.new_min_mark)) as mark_next
    from base
  ), g as (
    select sig, bool_or(live and mark_ok) as a_std, bool_or(mark_ok and mark_next) as a_next, bool_or(live and exp_era) as a_exp
    from f where sig <> '' group by sig
  ), bn as (
    select x.card_id, array_agg(distinct b.format order by b.format) as formats
    from public.bans b cross join lateral unnest(b.card_ids) as x(card_id)
    where b.active and (b.effective_date is null or b.effective_date <= current_date)
    group by x.card_id
  ), r0 as (
    select f.id, f.name, f.old_std, coalesce(bn.formats, '{}') as banned,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.mark_ok and (f.live or coalesce(g.a_std, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_std, false) or (f.live and f.mark_ok)))
      ) as std_raw,
      (not f.is_classic) and (
        f.is_basic_energy
        or (f.category = 'Pokemon' and f.mark_ok and f.mark_next)
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_next, false) or (f.mark_ok and f.mark_next)))
      ) as std_next,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.exp_era and (f.live or coalesce(g.a_exp, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_exp, false) or (f.live and f.exp_era)))
      ) as exp_raw,
      f.live, f.mark_ok, f.is_classic, f.legal_date
    from f left join g on g.sig = f.sig left join bn on bn.card_id = f.id
  ), r as (
    select r0.*,
      (r0.std_raw and not ('standard' = any(r0.banned))) as std,
      (r0.exp_raw and not ('expanded' = any(r0.banned))) as exp,
      (r0.std_raw and not r0.std_next) as rot,
      case when not r0.std_raw and not r0.live and r0.mark_ok and not r0.is_classic then r0.legal_date end as std_from
    from r0
  ), upd as (
    update public.cards c set
      legal_standard = r.std,
      legal_expanded = r.exp,
      rotating = r.rot,
      rotating_on = case when r.rot then nxt.effective_date end,
      standard_from = r.std_from,
      banned_in = r.banned
    from r
    where r.id = c.id and (
      c.legal_standard is distinct from r.std
      or c.legal_expanded is distinct from r.exp
      or c.rotating is distinct from r.rot
      or c.rotating_on is distinct from (case when r.rot then nxt.effective_date end)
      or c.standard_from is distinct from r.std_from
      or c.banned_in is distinct from r.banned)
    returning c.id
  )
  select jsonb_build_object(
    'updated', (select count(*) from upd),
    'standard_legal', (select count(*) from r where r.std),
    'standard_min_mark', std_mark,
    'next_rotation', case when nxt.id is null then null else jsonb_build_object('mark', nxt.new_min_mark, 'date', nxt.effective_date) end,
    'became_legal', coalesce((select jsonb_agg(distinct r.name) from r where r.std and not r.old_std), '[]'),
    'became_illegal', coalesce((select jsonb_agg(distinct r.name) from r where not r.std and r.old_std), '[]'))
  into res;
  return res;
end $$;

-- Current rules in one call, for the site.
create or replace function public.current_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'standard_min_mark', (select greatest(fr.min_mark, coalesce((select max(r.new_min_mark) from public.rotations r where r.effective_date <= current_date), fr.min_mark)) from public.format_rules fr where fr.format = 'standard'),
    'formats', (select jsonb_agg(to_jsonb(fr) order by fr.format) from public.format_rules fr),
    'next_rotation', (select to_jsonb(r) from public.rotations r
                      where (r.effective_date is null or r.effective_date > current_date)
                        and r.new_min_mark > (select greatest(fr.min_mark, coalesce((select max(x.new_min_mark) from public.rotations x where x.effective_date <= current_date), fr.min_mark)) from public.format_rules fr where fr.format = 'standard')
                      order by r.new_min_mark limit 1),
    'bans', (select coalesce(jsonb_agg(jsonb_build_object('format', b.format, 'card_name', b.card_name, 'printings', b.printings, 'card_ids', b.card_ids, 'effective_date', b.effective_date, 'source', b.source) order by b.format, b.card_name), '[]') from public.bans b where b.active),
    'upcoming_sets', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code, 'release_date', s.release_date, 'legal_date', s.legal_date) order by s.legal_date), '[]') from public.sets s where s.legal_date > current_date),
    'last_checked', (select max(checked_at) from public.format_rules),
    'last_catalog_sync', (select max(finished_at) from public.sync_runs where job = 'catalog' and ok),
    'card_count', (select count(*) from public.cards)
  )
$$;

/* ---------- card search ---------- */
create or replace function public.norm_name(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(translate(coalesce(t, ''), 'éÉ’‘', 'ee''''')), '[^a-z0-9''&.◇★ -]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

-- One row per card name, best printing first: legal in the format, newest, regular collector number.
create or replace function public.search_cards(q text, fmt text default 'unlimited', cat text default '', lim int default 30)
returns table (name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings int, legal boolean)
language sql stable security definer set search_path = public, extensions as $$
  with term as (select public.norm_name(q) t),
  hits as (
    select c.*, s.name as s_name, s.release_date,
      case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end as ok
    from public.cards c join public.sets s on s.id = c.set_id, term
    where char_length(term.t) >= 2 and (c.name_norm like '%' || term.t || '%' or (char_length(term.t) >= 4 and c.name_norm % term.t))
      and (cat = '' or c.category = cat)
  ),
  grouped as (
    select distinct on (h.name) h.name, h.id, h.image, h.set_id, h.s_name, h.category,
      coalesce(nullif(h.trainer_type, ''), nullif(h.stage, ''), h.energy_type) as sub,
      count(*) over (partition by h.name) as printings,
      bool_or(h.ok) over (partition by h.name) as any_ok,
      h.name_norm
    from hits h
    order by h.name, h.ok desc, (h.image <> '') desc, h.release_date desc nulls last,
      (case when h.num_key ~ '^\d+$' then h.num_key::int else 9999 end)
  )
  select g.name, g.id, g.image, g.set_id, g.s_name, g.category, g.sub, g.printings::int, g.any_ok
  from grouped g, term
  where fmt = 'unlimited' or g.any_ok
  order by (g.name_norm = term.t) desc, (g.name_norm like term.t || '%') desc,
    (g.name_norm like '% ' || term.t || '%') desc, extensions.similarity(g.name_norm, term.t) desc, char_length(g.name), g.name
  limit greatest(1, least(lim, 60))
$$;

/* ---------- deck list matching ---------- */
-- Takes [{"i":0,"qty":4,"name":"Iono","code":"PAL","num":"185"}] and returns the best catalog card for each line.
create or replace function public.resolve_decklist(lines jsonb, fmt text default 'standard')
returns table (i int, card_id text, how text)
language plpgsql stable security definer set search_path = public as $$
declare l jsonb; nm text; cd text; nk text; sid text; cid text; how_ text; alt text[];
begin
  for l in select * from jsonb_array_elements(lines) loop
    nm := public.norm_name(l->>'name');
    cd := upper(coalesce(l->>'code', ''));
    nk := upper(regexp_replace(split_part(coalesce(l->>'num', ''), '/', 1), '^([A-Z]*)0*(\d+)([A-Z]?)$', '\1\2\3', 'i'));
    cid := null; how_ := null; sid := null;
    -- names to try: as written, then basic-energy spellings
    alt := array[nm,
      regexp_replace(nm, '^basic ', ''),
      'basic ' || regexp_replace(nm, '^basic ', ''),
      regexp_replace(nm, ' energy energy$', ' energy'),
      regexp_replace(nm, '^basic (\w+) energy energy$', '\1 energy')];
    if cd <> '' then
      select s.id into sid from public.sets s where upper(s.code) = cd order by s.release_date desc nulls last limit 1;
      if sid is null then select sc.set_id into sid from public.set_codes sc where upper(sc.code) = cd; end if;
    end if;
    if sid is not null and nk <> '' then
      select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk and c.name_norm = any(alt) limit 1;
      if cid is not null then how_ := 'exact'; end if;
      if cid is null then
        select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk limit 1;
        if cid is not null then how_ := 'number'; end if;
      end if;
    end if;
    if cid is null and sid is not null then
      select c.id into cid from public.cards c where c.set_id = sid and c.name_norm = any(alt)
        order by (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end) limit 1;
      if cid is not null then how_ := 'set'; end if;
    end if;
    if cid is null then
      select c.id into cid from public.cards c join public.sets s on s.id = c.set_id
        where c.name_norm = any(alt)
        order by (case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end) desc,
          (c.image <> '') desc, s.release_date desc nulls last,
          (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end)
        limit 1;
      if cid is not null then how_ := 'name'; end if;
    end if;
    i := (l->>'i')::int; card_id := cid; how := how_;
    return next;
  end loop;
end $$;

/* ============================================================
   Row level security
   ============================================================ */
alter table public.sets enable row level security;
alter table public.set_codes enable row level security;
alter table public.cards enable row level security;
alter table public.format_rules enable row level security;
alter table public.rotations enable row level security;
alter table public.bans enable row level security;
alter table public.rule_changes enable row level security;
alter table public.sync_runs enable row level security;
alter table public.folders enable row level security;
alter table public.follows enable row level security;
alter table public.deck_comments enable row level security;
alter table public.deck_views enable row level security;

create policy "Catalog is public" on public.sets for select using (true);
create policy "Catalog is public" on public.set_codes for select using (true);
create policy "Catalog is public" on public.cards for select using (true);
create policy "Rules are public" on public.format_rules for select using (true);
create policy "Admins edit rules" on public.format_rules for update using (public.is_admin()) with check (public.is_admin());
create policy "Rotations are public" on public.rotations for select using (true);
create policy "Admins edit rotations" on public.rotations for all using (public.is_admin()) with check (public.is_admin());
create policy "Bans are public" on public.bans for select using (true);
create policy "Admins edit bans" on public.bans for all using (public.is_admin()) with check (public.is_admin());
create policy "Rule changes are public" on public.rule_changes for select using (true);
create policy "Admins read sync runs" on public.sync_runs for select using (public.is_admin());

create policy "Edit your own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Your folders" on public.folders for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy "Follows are public" on public.follows for select using (true);
create policy "Follow as yourself" on public.follows for insert with check (follower = auth.uid());
create policy "Unfollow as yourself" on public.follows for delete using (follower = auth.uid());

create policy "Read comments on decks you can see" on public.deck_comments for select using (
  exists (select 1 from public.decks d where d.id = deck_id and (d.is_public or d.owner = auth.uid())));
create policy "Comment as yourself" on public.deck_comments for insert with check (
  user_id = auth.uid() and exists (select 1 from public.decks d where d.id = deck_id and (d.is_public or d.owner = auth.uid())));
create policy "Delete your comments or comments on your deck" on public.deck_comments for delete using (
  user_id = auth.uid() or exists (select 1 from public.decks d where d.id = deck_id and d.owner = auth.uid()) or public.is_admin());

-- deck_views has no policies: only record_view() writes it.

/* ---------- function permissions ---------- */
revoke execute on function public.recompute_legality() from public, anon, authenticated;
revoke execute on function public.bump_comment_count() from public, anon, authenticated;
revoke execute on function public.bump_follow_counts() from public, anon, authenticated;
revoke execute on function public.bump_like_count() from public, anon, authenticated;
grant execute on function public.record_view(uuid, text) to anon, authenticated;
grant execute on function public.set_featured(uuid, boolean) to authenticated;
grant execute on function public.search_cards(text, text, text, int) to anon, authenticated;
grant execute on function public.resolve_decklist(jsonb, text) to anon, authenticated;
grant execute on function public.current_rules() to anon, authenticated;
