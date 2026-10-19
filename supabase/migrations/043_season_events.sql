-- Season coverage (Oct 2026).
-- The Tournaments page now shows the current season: every event since the day after last season's Worlds.
-- Before, standings were only fetched for events from the last 120 days, so the spring Regionals first seen
-- at launch were never read and sat on the page as "Lists coming" forever.
-- Major events now also include Special Events and the Asian league events Limitless lists (Premier Ball
-- League, Korean League), and Japan's majors (from the Japan feed) are listed alongside them.
-- Events whose lists use cards that weren't legal in the US on the event date are flagged, so the page can label them.

-- 1. The season starts the day after the latest Worlds that a newer event has followed
--    (so Worlds stays in its own season until the next season's first event appears).
create or replace function public.season_start() returns date
language sql stable set search_path = public as $$
  select coalesce(
    (select w.date + 1 from public.tournaments w
      where w.kind = 'worlds' and exists (select 1 from public.tournaments x where x.date > w.date)
      order by w.date desc limit 1),
    current_date - 365)
$$;
grant execute on function public.season_start() to anon, authenticated;

-- 2. More kinds of major event
alter table public.tournaments drop constraint if exists tournaments_kind_check;
alter table public.tournaments add constraint tournaments_kind_check
  check (kind in ('regional', 'special', 'international', 'worlds', 'league'));
alter table public.tournaments add column if not exists non_us boolean not null default false;

create or replace function public.tourney_kind(n text) returns text
language sql immutable set search_path = public as $$
  select case
    when n ~* '^world championships' then 'worlds'
    when n ~* '(international championship|^(naic|euic|laic|ocic|maic)\M)' then 'international'
    when n ~* '^regional\M' then 'regional'
    when n ~* '^special event\M' then 'special'
    when n ~* '(premier ball league|^korean league\M)' then 'league'
  end
$$;

-- 3. Flag events with cards that weren't legal in the US on the event date:
--    a non-US format, a list line that matches no US card, or a card only printed in a set that became legal later.
create or replace function public.tourney_set_non_us(p_id int) returns void
language sql security definer set search_path = public as $$
  update public.tournaments t set non_us = (t.format <> 'standard') or exists (
    select 1 from public.tournament_decks d
     where d.tournament_id = t.id and (
       cardinality(d.missing) > 0
       -- Play! Pokémon events (Regionals through Worlds) share one card pool worldwide, so the set-date
       -- check only applies to the Asian league events, which run on Asia's earlier releases.
       or t.kind = 'league' and exists (select 1 from jsonb_array_elements(coalesce(d.cards, '[]'::jsonb)) x
                    join public.cards c on c.id = x->>'cid' join public.sets s on s.id = c.set_id
                   where s.legal_date > t.date
                     and not exists (select 1 from public.cards c2 join public.sets s2 on s2.id = c2.set_id
                                      where (c2.sig = c.sig or c2.id = c.id) and s2.legal_date <= t.date))))
  where t.id = p_id
$$;
revoke execute on function public.tourney_set_non_us(int) from public, anon, authenticated;

-- 4. Reader: keep each event's format (Standard or Standard (JP)) and refresh the flag as lists come in.
create or replace function public.tourney_read(f public.tourney_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_name text; v_kind text; v_id int; v_fmt text; lines jsonb := '[]'; i int := 0; n int := 0;
  v_cards jsonb; v_miss text[]; v_cnt int; v_pr numeric;
begin
  if f.kind = 'index' then
    for ch in select x from regexp_split_to_table(body, '<tr data-date=') x offset 1 loop
      v_name := substring(ch from 'data-name="([^"]+)"');
      v_kind := public.tourney_kind(v_name);
      v_id := substring(ch from 'href="/tournaments/(\d+)"')::int;
      v_fmt := coalesce(substring(ch from 'data-format="([^"]*)"'), '');
      continue when v_kind is null or v_id is null or v_fmt not in ('standard', 'standard-jp');
      insert into public.tournaments (id, name, date, country, players, kind, format)
      values (v_id, replace(v_name, '&amp;', '&'), substring(ch from '^"(\d{4}-\d{2}-\d{2})"')::date,
              coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
              nullif(substring(ch from 'data-players="(\d+)"'), '')::int, v_kind, v_fmt)
      on conflict (id) do update set players = excluded.players;
    end loop;

  elsif f.kind = 'standings' then
    for ch in select x from regexp_split_to_table(body, '<tr data-rank=') x offset 1 loop
      i := substring(ch from '^"(\d+)"')::int;
      exit when i is null or i > 32;
      insert into public.tournament_decks (tournament_id, place, player, country, archetype, list_id)
      values (f.tournament_id, i,
        replace(coalesce(substring(ch from 'data-name="([^"]*)"'), ''), '&amp;', '&'),
        coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
        replace(coalesce(substring(ch from 'data-deck="([^"]*)"'), ''), '&amp;', '&'),
        substring(ch from 'href="/decks/list/(\d+)"')::int)
      on conflict (tournament_id, place) do update set
        player = excluded.player, country = excluded.country, archetype = excluded.archetype,
        list_id = coalesce(excluded.list_id, tournament_decks.list_id);
      n := n + 1;
    end loop;
    -- Only move on once standings actually had rows; an empty page counts as a try.
    update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1,
      status = case when status = 'new' and n > 0 then 'lists' else status end
      where id = f.tournament_id;

  elsif f.kind = 'list' then
    i := 0;
    for ch in select x from regexp_split_to_table(body, 'class="decklist-card"') x offset 1 loop
      lines := lines || jsonb_build_object('i', i,
        'qty', coalesce(substring(ch from 'class="card-count">\s*(\d+)'), '0')::int,
        'name', replace(replace(trim(coalesce(substring(ch from 'class="card-name">([^<]*)<'), '')), '&amp;', '&'), '&#039;', ''''),
        'code', coalesce(substring(ch from 'data-set="([^"]*)"'), ''),
        'num', coalesce(substring(ch from 'data-number="([^"]*)"'), ''));
      i := i + 1;
    end loop;
    if jsonb_array_length(lines) = 0 then
      update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      return;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('cid', r.card_id, 'qty', (l->>'qty')::int, 'board', 'main', 'name', c.name, 'cat', c.category)) filter (where r.card_id is not null), '[]'),
           coalesce(array_agg(l->>'name') filter (where r.card_id is null), '{}'),
           coalesce(sum((l->>'qty')::int), 0),
           round(coalesce(sum((l->>'qty')::int * coalesce(public.card_price(c.prices), 0)) filter (where r.card_id is not null), 0), 2)
      into v_cards, v_miss, v_cnt, v_pr
      from jsonb_array_elements(lines) l
      join public.resolve_decklist_v2(lines, 'standard', 'exact') r on r.i = (l->>'i')::int
      left join public.cards c on c.id = r.card_id;
    update public.tournament_decks set cards = v_cards, missing = v_miss, card_count = v_cnt, price = v_pr, fetched_at = now(), attempts = attempts + 1
      where tournament_id = f.tournament_id and place = f.place;
    perform public.tourney_set_non_us(f.tournament_id);
  end if;
end $$;
revoke execute on function public.tourney_read(public.tourney_fetch, text) from public, anon, authenticated;

-- 5. Tick: the fetch window is the season, not the last 120 days. Same request budget (6 per 10-minute run).
create or replace function public.tourney_tick() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.tourney_fetch; resp record; sent int := 0; budget int := 6; ev record; dl record; last_index timestamptz;
  v_season date := public.season_start();
begin
  -- 1. read finished responses
  for f in select * from public.tourney_fetch where handled_at is null order by created_at loop
    select status_code, content, timed_out, error_msg into resp from net._http_response where id = f.net_id;
    if not found then
      if f.created_at < now() - interval '1 hour' then update public.tourney_fetch set handled_at = now() where net_id = f.net_id; end if;
      continue;
    end if;
    begin
      if resp.status_code = 200 and resp.content is not null then perform public.tourney_read(f, resp.content);
      elsif f.kind = 'list' then update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
      if resp.status_code = 429 then
        insert into public.app_settings (key, value) values ('tourney_pause_until', (now() + interval '6 hours')::text) on conflict (key) do update set value = excluded.value;
      end if;
    exception when others then
      raise warning 'tourney_read % failed: %', f.kind, sqlerrm;
      -- a page we can't read counts as a try, so it isn't fetched again forever
      if f.kind = 'list' then update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
    end;
    update public.tourney_fetch set handled_at = now() where net_id = f.net_id;
  end loop;

  -- nothing new while requests are still out
  if exists (select 1 from public.tourney_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.tourney_fetch where handled_at is null));
  end if;

  -- Limitless asked us to slow down (429): send nothing until the pause is over.
  if coalesce((select value::timestamptz from public.app_settings where key = 'tourney_pause_until'), '-infinity') > now() then
    return jsonb_build_object('paused', true);
  end if;

  -- 2. the tournament list, once a day
  select value::timestamptz into last_index from public.app_settings where key = 'tourney_index_at';
  if last_index is null or last_index < now() - interval '23 hours' then
    perform public.tourney_get('index', 'https://limitlesstcg.com/tournaments');
    insert into public.app_settings (key, value) values ('tourney_index_at', now()::text)
      on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 3. standings: new events this season, and once a day for events still missing lists (up to 14 days)
  for ev in select * from public.tournaments
           where date >= v_season
             and ((status = 'new' and standings_tries < 3 and (standings_at is null or standings_at < now() - interval '23 hours'))
               or (status = 'lists' and standings_at < now() - interval '23 hours' and date >= current_date - 14
                   and exists (select 1 from public.tournament_decks d where d.tournament_id = tournaments.id and d.list_id is null)))
           order by date desc limit greatest(0, 2 - sent) loop
    perform public.tourney_get('standings', 'https://limitlesstcg.com/tournaments/' || ev.id, ev.id);
    sent := sent + 1;
  end loop;

  -- 4. deck lists we don't have yet (a few per run); give up on a list after 3 failed tries
  for dl in select dd.* from public.tournament_decks dd join public.tournaments tt on tt.id = dd.tournament_id
           where dd.list_id is not null and dd.cards is null and dd.attempts < 3
           order by tt.date desc, dd.place limit greatest(0, budget - sent) loop
    perform public.tourney_get('list', 'https://limitlesstcg.com/decks/list/' || dl.list_id, dl.tournament_id, dl.place);
    sent := sent + 1;
  end loop;

  -- 5. events with every top-32 list in hand, or past their 14-day window, are done
  update public.tournaments t set status = 'done', done_at = now()
   where status = 'lists'
     and (not exists (select 1 from public.tournament_decks d where d.tournament_id = t.id and (d.list_id is null or (d.cards is null and d.attempts < 3)))
          or (t.date < current_date - 14 and not exists (select 1 from public.tournament_decks d where d.tournament_id = t.id and d.list_id is not null and d.cards is null and d.attempts < 3)));

  -- events that never yield standings (3 tries) or are from an earlier season are closed
  update public.tournaments set status = 'done', done_at = now()
   where status = 'new' and (standings_tries >= 3 or date < v_season);

  return jsonb_build_object('sent', sent);
end $$;
revoke execute on function public.tourney_tick() from public, anon, authenticated;

-- 6. The season's events for the Tournaments page: US-feed majors plus Japan's majors, newest first.
--    label: 'japan' (Japanese event), 'non_us' (lists use cards not legal in the US then), or null.
create or replace function public.season_events()
returns table (id text, src text, name text, date date, country text, players int, kind text, status text, lists int, label text)
language sql stable set search_path = public as $$
  with s as (select public.season_start() d)
  select t.id::text, 'us', t.name, t.date, t.country, t.players, t.kind, t.status,
         (select count(*) from public.tournament_decks x where x.tournament_id = t.id and x.cards is not null)::int,
         case when t.non_us then 'non_us' end
    from public.tournaments t, s where t.date >= s.d
  union all
  select j.id, 'jp', j.name, j.date, 'JP', j.players, 'japan', j.status,
         (select count(*) from public.jp_decks x where x.tournament_id = j.id and x.cards is not null)::int, 'japan'
    from public.jp_tournaments j, s where j.kind = 'major' and j.date >= s.d
  order by 4 desc, 3
$$;
grant execute on function public.season_events() to anon, authenticated;

-- 7. One-time: flag events already loaded, and read the tournament list again on the next run
--    so this season's newly counted majors are picked up now rather than tomorrow.
select public.tourney_set_non_us(id) from public.tournaments;
delete from public.app_settings where key = 'tourney_index_at';
