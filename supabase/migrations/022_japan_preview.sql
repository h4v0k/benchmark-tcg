-- Japan preview: City League and Champions League results from Limitless, kept in their own tables.
-- Japan plays sets before the US does, so these lists can hold cards that aren't legal in US Standard yet
-- (the "preview set", Delta Reign = Japanese Storm Emeralda, set code M6). Nothing here feeds the Standard
-- views (tourney_meta, deck_lists, archetype pages, matchups) or card legality; only the Japan page reads it.
--
-- Requests stay small and spread out (at most 3 every 10 minutes, offset from the main tournament job):
--   * the City League index, once a day (plus a one-time look back over a few more pages)
--   * Champions League events come from the main tournament list the other job already downloads (no extra request)
--   * an event's standings once, a few deck lists per run (City League top 4, Champions League top 16)

-- The set that is legal in Japan but not in the US yet. Edit this row when the next one comes along.
insert into public.app_settings (key, value) values
  ('jp_preview', '{"name":"Delta Reign","code":"ME06","jp_name":"Storm Emeralda","jp_codes":["M6"],"us_release":"2026-11-06"}')
  on conflict (key) do nothing;

create table if not exists public.jp_tournaments (
  id text primary key,                   -- 'c' || City League id, 'm' || Limitless tournament id for majors
  src_id int not null,
  kind text not null check (kind in ('city_league', 'major')),
  name text not null,
  date date not null,
  city text not null default '',         -- prefecture for City Leagues
  shop text not null default '',
  players int,
  status text not null default 'new' check (status in ('new', 'lists', 'done')),
  standings_tries int not null default 0,
  standings_at timestamptz,
  first_seen timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists jp_tournaments_date on public.jp_tournaments (date desc);

create table if not exists public.jp_decks (
  tournament_id text not null references public.jp_tournaments(id) on delete cascade,
  place int not null,
  player text not null default '',
  archetype text not null default '',
  icons text[] not null default '{}',
  list_ref text,                         -- 'jp/75534' (City League) or '29455' (major); null if no list posted
  cards jsonb,                           -- [{i, qty, name, code, num, sec, preview, cid, cat}]; null until fetched
  missing text[] not null default '{}',  -- legal-set lines we couldn't match to a card
  card_count int,
  price numeric,                         -- cards already sold in the US only
  has_preview boolean not null default false,
  preview_qty int not null default 0,
  fetched_at timestamptz,
  attempts int not null default 0,
  primary key (tournament_id, place)
);
create index if not exists jp_decks_archetype on public.jp_decks (archetype);

alter table public.jp_tournaments enable row level security;
alter table public.jp_decks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'jp_tournaments' and policyname = 'Japan tournaments are public') then
    create policy "Japan tournaments are public" on public.jp_tournaments for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'jp_decks' and policyname = 'Japan decks are public') then
    create policy "Japan decks are public" on public.jp_decks for select using (true);
  end if;
end $$;
revoke all on public.jp_tournaments, public.jp_decks from anon, authenticated;
grant select on public.jp_tournaments, public.jp_decks to anon, authenticated;

create table if not exists public.jp_fetch (
  net_id bigint primary key,
  kind text not null check (kind in ('index', 'standings', 'list')),
  tournament_id text,
  place int,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.jp_fetch enable row level security;
revoke all on public.jp_fetch from anon, authenticated;

create or replace function public.jp_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value::jsonb from public.app_settings where key = 'jp_preview'), '{}'::jsonb)
$$;
revoke execute on function public.jp_cfg() from public, anon, authenticated;

create or replace function public.jp_codes() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select upper(x) from jsonb_array_elements_text(public.jp_cfg()->'jp_codes') x), '{}')
$$;
revoke execute on function public.jp_codes() from public, anon, authenticated;

-- What the page shows about the preview set. Dates come from the card catalog once the set is in it.
create or replace function public.jp_preview_info() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select public.jp_cfg() j),
  s as (select s.release_date, s.legal_date from public.sets s, c
        where (upper(s.code) = upper(c.j->>'code') or lower(s.name) = lower(c.j->>'name')) and not s.hidden
        order by s.release_date desc nulls last limit 1)
  select jsonb_build_object(
    'name', c.j->>'name', 'code', c.j->>'code', 'jp_name', c.j->>'jp_name', 'jp_codes', c.j->'jp_codes',
    'us_release', coalesce((select release_date::text from s), c.j->>'us_release'),
    'us_legal', coalesce((select legal_date::text from s), c.j->>'us_legal'),
    'updated', (select max(fetched_at) from public.jp_decks))
  from c
$$;
grant execute on function public.jp_preview_info() to anon, authenticated;

create or replace function public.jp_get(p_kind text, p_url text, p_tid text default null, p_place int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmark-tcg.mpr0317.workers.dev; daily cache)'),
    timeout_milliseconds := 20000);
  insert into public.jp_fetch (net_id, kind, tournament_id, place) values (nid, p_kind, p_tid, p_place);
end $$;
revoke execute on function public.jp_get(text, text, text, int) from public, anon, authenticated;

-- City League standings only show Pokémon icons; use the archetype with the same icons, else name it after them.
create or replace function public.jp_deck_name(p_icons text[]) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.name from public.archetypes a
      where a.icons is not null and cardinality(a.icons) = cardinality(p_icons)
        and a.icons @> p_icons and a.icons <@ p_icons
      order by (a.icons = p_icons) desc, a.name limit 1),
    nullif(array_to_string(array(
      select case when x ~ '-mega$' then 'Mega ' || initcap(replace(regexp_replace(x, '-mega$', ''), '-', ' '))
                  else initcap(replace(x, '-', ' ')) end
      from unnest(p_icons) with ordinality u(x, n) order by n), ' '), ''),
    '')
$$;
revoke execute on function public.jp_deck_name(text[]) from public, anon, authenticated;

-- Reads a Limitless deck list page into lines, flags preview-set cards, matches the rest to the catalog.
create or replace function public.jp_parse_list(body text)
returns table (cards jsonb, missing text[], card_count int, price numeric, preview_qty int)
language plpgsql stable security definer set search_path = public as $$
declare col text; ch text; sec text; lines jsonb := '[]'; i int := 0; codes text[] := public.jp_codes(); v_code text;
begin
  for col in select x from regexp_split_to_table(body, 'decklist-column-heading">') x offset 1 loop
    sec := case when col ~* '^\s*pok' then 'pokemon' when col ~* '^\s*trainer' then 'trainer' when col ~* '^\s*energy' then 'energy' else 'other' end;
    for ch in select y from regexp_split_to_table(col, 'class="decklist-card"') y offset 1 loop
      v_code := coalesce(substring(ch from 'data-set="([^"]*)"'), '');
      lines := lines || jsonb_build_object('i', i,
        'qty', coalesce(substring(ch from 'class="card-count">\s*(\d+)'), '0')::int,
        'name', public.html_text(trim(coalesce(substring(ch from 'class="card-name">([^<]*)<'), ''))),
        'code', v_code,
        'num', coalesce(substring(ch from 'data-number="([^"]*)"'), ''),
        'sec', sec,
        'preview', upper(v_code) = any(codes));
      i := i + 1;
    end loop;
  end loop;
  if jsonb_array_length(lines) = 0 then return; end if;
  return query
  with l as (select x from jsonb_array_elements(lines) x),
  r as (select * from public.resolve_decklist_v2(
          coalesce((select jsonb_agg(x) from l where not (x->>'preview')::boolean), '[]'), 'standard', 'exact')),
  j as (
    select l.x || jsonb_build_object('cid', r.card_id, 'cat', c.category) as line,
           (l.x->>'preview')::boolean as pv, r.card_id, (l.x->>'qty')::int as qty, l.x->>'name' as nm, c.prices
    from l left join r on r.i = (l.x->>'i')::int left join public.cards c on c.id = r.card_id
  )
  select jsonb_agg(j.line order by (j.line->>'i')::int),
         coalesce(array_agg(j.nm) filter (where not j.pv and j.card_id is null), '{}'),
         coalesce(sum(j.qty), 0)::int,
         round(coalesce(sum(j.qty * coalesce(public.card_price(j.prices), 0)) filter (where j.card_id is not null), 0), 2),
         coalesce(sum(j.qty) filter (where j.pv), 0)::int
  from j;
end $$;
revoke execute on function public.jp_parse_list(text) from public, anon, authenticated;

-- Major Japanese events (Champions League, Japan Championships) from a main tournament-list page.
create or replace function public.jp_read_majors(body text) returns int
language plpgsql security definer set search_path = public as $$
declare ch text; v_name text; v_id int; n int := 0;
begin
  for ch in select x from regexp_split_to_table(body, '<tr data-date=') x offset 1 loop
    v_name := public.html_text(substring(ch from 'data-name="([^"]+)"'));
    v_id := substring(ch from 'href="/tournaments/(\d+)"')::int;
    continue when v_id is null or v_name is null or v_name !~* '^(champions league|japan championships?)\M';
    insert into public.jp_tournaments (id, src_id, kind, name, date, city, players)
    values ('m' || v_id, v_id, 'major', v_name, substring(ch from '^"(\d{4}-\d{2}-\d{2})"')::date,
            coalesce(substring(ch from 'data-country="([^"]*)"'), ''), nullif(substring(ch from 'data-players="(\d+)"'), '')::int)
    on conflict (id) do update set players = coalesce(excluded.players, jp_tournaments.players);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.jp_read_majors(text) from public, anon, authenticated;

create or replace function public.jp_read(f public.jp_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; i int; n int := 0; v_id int; v_icons text[]; v_list text; t public.jp_tournaments; p record;
begin
  if f.kind = 'index' then
    for ch in select x from regexp_split_to_table(body, '<tr data-date=') x offset 1 loop
      v_id := substring(ch from 'href="https://limitlesstcg\.com/tournaments/jp/(\d+)"')::int;
      continue when v_id is null;
      insert into public.jp_tournaments (id, src_id, kind, name, date, city, shop)
      values ('c' || v_id, v_id, 'city_league',
              'City League ' || public.html_text(coalesce(substring(ch from 'data-city="([^"]*)"'), '')),
              substring(ch from '^"(\d{4}-\d{2}-\d{2})"')::date,
              public.html_text(coalesce(substring(ch from 'data-city="([^"]*)"'), '')),
              public.html_text(coalesce(substring(ch from 'data-shop="([^"]*)"'), '')))
      on conflict (id) do nothing;
    end loop;

  elsif f.kind = 'standings' then
    select * into t from public.jp_tournaments where id = f.tournament_id;
    if not found then return; end if;
    if t.kind = 'city_league' then
      -- rows: <td>place</td> <td>player</td> <td>icons → /decks/list/jp/N</td>
      for ch in select x from regexp_split_to_table(
                  substring(body from position('<table class="data-table' in body)), '<tr>') x offset 1 loop
        i := substring(ch from '^\s*<td>(\d+)</td>')::int;
        continue when i is null;
        exit when i > 8;
        v_icons := array(select m[1] from regexp_matches(ch, 'class="pokemon"[^>]*alt="([^"]+)"', 'g') m);
        v_list := substring(ch from 'href="https://limitlesstcg\.com/decks/list/(jp/\d+)"');
        insert into public.jp_decks (tournament_id, place, player, archetype, icons, list_ref)
        values (t.id, i, public.html_text(coalesce(substring(ch from '<a href="/players/[^"]*">([^<]*)</a>'), '')),
                public.jp_deck_name(v_icons), v_icons, v_list)
        on conflict (tournament_id, place) do update set
          player = excluded.player, archetype = excluded.archetype, icons = excluded.icons,
          list_ref = coalesce(excluded.list_ref, jp_decks.list_ref);
        n := n + 1;
      end loop;
    else
      -- major events use the main standings layout (as in tourney_read)
      for ch in select x from regexp_split_to_table(body, '<tr data-rank=') x offset 1 loop
        i := substring(ch from '^"(\d+)"')::int;
        exit when i is null or i > 32;
        v_icons := array(select m[1] from regexp_matches(ch, 'class="pokemon"[^>]*alt="([^"]+)"', 'g') m);
        insert into public.jp_decks (tournament_id, place, player, archetype, icons, list_ref)
        values (t.id, i, public.html_text(coalesce(substring(ch from 'data-name="([^"]*)"'), '')),
                coalesce(nullif(public.html_text(coalesce(substring(ch from 'data-deck="([^"]*)"'), '')), ''), public.jp_deck_name(v_icons)),
                v_icons, substring(ch from 'href="/decks/list/(\d+)"'))
        on conflict (tournament_id, place) do update set
          player = excluded.player, archetype = excluded.archetype, icons = excluded.icons,
          list_ref = coalesce(excluded.list_ref, jp_decks.list_ref);
        n := n + 1;
      end loop;
    end if;
    update public.jp_tournaments set standings_at = now(), standings_tries = standings_tries + 1,
      status = case when n > 0 and status = 'new' then 'lists' else status end
      where id = t.id;

  elsif f.kind = 'list' then
    select * into p from public.jp_parse_list(body);
    if p.cards is null then
      update public.jp_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      return;
    end if;
    update public.jp_decks set cards = p.cards, missing = p.missing, card_count = p.card_count, price = p.price,
      preview_qty = p.preview_qty, has_preview = p.preview_qty > 0, fetched_at = now(), attempts = attempts + 1
      where tournament_id = f.tournament_id and place = f.place;
  end if;
end $$;
revoke execute on function public.jp_read(public.jp_fetch, text) from public, anon, authenticated;

-- Runs every 10 minutes (5 minutes after the main tournament job). Sends at most 3 requests.
drop function if exists public.jp_tick(int);  -- (024 replaces this with jp_tick(budget); keeps a re-run of 022 unambiguous)
create or replace function public.jp_tick() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.jp_fetch; resp record; sent int := 0; budget int := 3; ev record; dl record;
  last_index timestamptz; back int; seen timestamptz; ix record; majors int := 0;
begin
  -- 1. read finished responses
  for f in select * from public.jp_fetch where handled_at is null order by created_at loop
    select status_code, content into resp from net._http_response where id = f.net_id;
    if not found then
      if f.created_at < now() - interval '1 hour' then update public.jp_fetch set handled_at = now() where net_id = f.net_id; end if;
      continue;
    end if;
    begin
      if resp.status_code = 200 and resp.content is not null then perform public.jp_read(f, resp.content);
      elsif f.kind = 'list' then update public.jp_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.jp_tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
    exception when others then raise warning 'jp_read % failed: %', f.kind, sqlerrm;
    end;
    update public.jp_fetch set handled_at = now() where net_id = f.net_id;
  end loop;

  -- 2. Champions League events, from the main tournament list the other job downloaded (no request of our own)
  select value::timestamptz into seen from public.app_settings where key = 'jp_majors_seen';
  for ix in select tf.created_at, r.content from public.tourney_fetch tf join net._http_response r on r.id = tf.net_id
            where tf.kind = 'index' and tf.handled_at is not null and r.status_code = 200
              and tf.created_at > coalesce(seen, '-infinity'::timestamptz)
            order by tf.created_at loop
    begin majors := majors + public.jp_read_majors(ix.content);
    exception when others then raise warning 'jp_read_majors failed: %', sqlerrm;
    end;
    insert into public.app_settings (key, value) values ('jp_majors_seen', ix.created_at::text)
      on conflict (key) do update set value = excluded.value;
  end loop;

  if exists (select 1 from public.jp_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.jp_fetch where handled_at is null));
  end if;

  -- 3. the City League list: newest 100 once a day; the first few days also step back one page per run
  select value::timestamptz into last_index from public.app_settings where key = 'jp_index_at';
  select coalesce(value::int, 1) into back from public.app_settings where key = 'jp_index_back';
  back := coalesce(back, 1);
  if last_index is null or last_index < now() - interval '23 hours' then
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100');
    insert into public.app_settings (key, value) values ('jp_index_at', now()::text)
      on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  elsif back < 5 then
    back := back + 1;
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100&page=' || back);
    insert into public.app_settings (key, value) values ('jp_index_back', back::text)
      on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 4. standings for events from the last 21 days (majors first); retry a day later, 3 tries
  for ev in select * from public.jp_tournaments
           where status = 'new' and date >= current_date - 21 and standings_tries < 3
             and (standings_at is null or standings_at < now() - interval '23 hours')
           order by (kind = 'major') desc, date desc limit greatest(0, 2 - sent) loop
    perform public.jp_get('standings',
      case when ev.kind = 'major' then 'https://limitlesstcg.com/tournaments/' || ev.src_id
           else 'https://limitlesstcg.com/tournaments/jp/' || ev.src_id end, ev.id);
    sent := sent + 1;
  end loop;

  -- 5. deck lists: City League top 4, majors top 16, newest first; give up on a list after 3 tries
  for dl in select d.tournament_id, d.place, d.list_ref from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
           where d.list_ref is not null and d.cards is null and d.attempts < 3
             and d.place <= case when t.kind = 'major' then 16 else 4 end
           order by (t.kind = 'major') desc, t.date desc, d.place limit greatest(0, budget - sent) loop
    perform public.jp_get('list', 'https://limitlesstcg.com/decks/list/' || dl.list_ref, dl.tournament_id, dl.place);
    sent := sent + 1;
  end loop;

  -- 6. finished events
  update public.jp_tournaments t set status = 'done', done_at = now()
   where status <> 'done' and (
     (status = 'lists' and not exists (select 1 from public.jp_decks d where d.tournament_id = t.id and d.list_ref is not null
        and d.cards is null and d.attempts < 3 and d.place <= case when t.kind = 'major' then 16 else 4 end))
     or (status = 'new' and (standings_tries >= 3 or date < current_date - 21)));
  delete from public.jp_fetch where handled_at < now() - interval '7 days';

  return jsonb_build_object('sent', sent, 'majors', majors);
end $$;
revoke execute on function public.jp_tick() from public, anon, authenticated;

/* ---------- what the Japan page reads ---------- */

-- Events with list counts, newest first.
create or replace function public.jp_events(p_days int default 30, p_limit int default 80)
returns table (id text, kind text, name text, date date, city text, shop text, players int, status text,
               lists bigint, preview_lists bigint, winner text, winner_icons text[])
language sql stable security definer set search_path = public as $$
  select t.id, t.kind, t.name, t.date, t.city, t.shop, t.players, t.status,
         count(d.cards), count(d.cards) filter (where d.has_preview),
         max(d.archetype) filter (where d.place = 1),
         string_to_array(max(array_to_string(d.icons, ',')) filter (where d.place = 1), ',')
  from public.jp_tournaments t left join public.jp_decks d on d.tournament_id = t.id
  where t.date >= current_date - least(greatest(p_days, 7), 120) and t.status <> 'new'
  group by t.id
  order by t.date desc, (t.kind = 'major') desc, t.id desc
  limit least(greatest(p_limit, 1), 200)
$$;
grant execute on function public.jp_events(int, int) to anon, authenticated;

-- Archetypes across Japanese top 8s, and how many of their lists play preview-set cards.
drop function if exists public.jp_meta(int, boolean);
create function public.jp_meta(p_days int default 14, p_preview_only boolean default false)
returns table (archetype text, icons text[], top8 bigint, top4 bigint, wins bigint, events bigint,
               lists bigint, preview_lists bigint, best_tournament text, best_place int)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.*, t.date from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(p_days, 3), 120) and d.archetype <> '' and d.place <= 8
  ), best as (
    select distinct on (archetype) archetype, tournament_id, place from d
    where cards is not null and (not p_preview_only or has_preview) order by archetype, place, date desc
  ), agg as (
    select d.archetype, string_to_array((array_agg(array_to_string(d.icons, ',') order by d.date desc))[1], ',') icons,
           count(*) top8, count(*) filter (where d.place <= 4) top4, count(*) filter (where d.place = 1) wins,
           count(distinct d.tournament_id) events, count(d.cards) lists, count(d.cards) filter (where d.has_preview) preview_lists
    from d group by d.archetype
  )
  select a.archetype, a.icons, a.top8, a.top4, a.wins, a.events, a.lists, a.preview_lists, b.tournament_id, b.place
  from agg a left join best b using (archetype)
  where not p_preview_only or a.preview_lists > 0
  order by a.top8 desc, a.wins desc, a.archetype
$$;
grant execute on function public.jp_meta(int, boolean) to anon, authenticated;

-- Each preview-set card: how many fetched lists play it, copies, finishes, and the decks that use it most.
drop function if exists public.jp_preview_cards(int, text);
drop function if exists public.jp_preview_cards(int);
create function public.jp_preview_cards(p_days int default 14)
returns table (name text, code text, num text, lists bigint, share numeric, avg_copies numeric,
               wins bigint, top_decks text[], best_tournament text, best_place int)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.* from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(p_days, 3), 120) and d.cards is not null
  ), total as (select count(*) n from d),
  l as (
    select d.tournament_id, d.place, d.archetype, x->>'name' name, x->>'code' code, x->>'num' num, (x->>'qty')::int qty
    from d, jsonb_array_elements(d.cards) x where (x->>'preview')::boolean
  ), per as (  -- one row per list and card name (a list can hold two printings)
    select tournament_id, place, archetype, name, min(code) code, min(num) num, sum(qty) qty from l group by 1, 2, 3, 4
  ), decks as (
    select name, array_agg(archetype order by n desc, archetype) top from (
      select name, archetype, count(*) n, row_number() over (partition by name order by count(*) desc, archetype) r
      from per group by name, archetype) z where r <= 3 group by name
  ), best as (
    select distinct on (name) name, tournament_id, place from per order by name, place, qty desc
  )
  select p.name, min(p.code), min(p.num), count(*),
         round(100.0 * count(*) / nullif((select n from total), 0), 1),
         round(avg(p.qty), 1), count(*) filter (where p.place = 1),
         (select top from decks where decks.name = p.name), b.tournament_id, b.place
  from per p left join best b on b.name = p.name
  group by p.name, b.tournament_id, b.place
  order by count(*) desc, p.name
$$;
grant execute on function public.jp_preview_cards(int) to anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'benchmark-japan') then
    perform cron.schedule('benchmark-japan', '5-59/10 * * * *', 'select public.jp_tick()');
  end if;
end $$;
