-- Japan preview, round 2:
--   * everything since the preview set came out in Japan (jp_since, Storm Emeralda = 2026-07-31), not just 21 days
--   * top 32 standings and lists where the event has them (City Leagues usually post 16)
--   * lists fetched best placings first across all events, so wins and top 4s fill in before 30th places
--   * a one-time catch-up: 4 requests a minute until the backlog is in, then it switches itself off and the
--     normal job (3 requests every 10 minutes) carries on. Every request still names Benchmark in its User-Agent.
--   * "winningest" card stats (wins, top 4, top 8, weighted finish points) and a per-card page

update public.app_settings set value = (value::jsonb || '{"jp_since":"2026-07-31"}')::text
 where key = 'jp_preview' and not (value::jsonb ? 'jp_since');

create or replace function public.jp_since() returns date
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(public.jp_cfg()->>'jp_since', '')::date, current_date - 30)
$$;
revoke execute on function public.jp_since() from public, anon, authenticated;

-- Points for a finish, so "winningest" weighs a win above a 16th place. Same steps as Limitless top cuts.
create or replace function public.jp_points(p_place int) returns numeric
language sql immutable as $$
  select case when p_place = 1 then 8 when p_place = 2 then 6 when p_place <= 4 then 4 when p_place <= 8 then 2
              when p_place <= 16 then 1 when p_place <= 32 then 0.5 else 0 end::numeric
$$;

-- majors from the main tournament list (a weekly look, in case the other job's daily copy missed one)
alter table public.jp_fetch drop constraint if exists jp_fetch_kind_check;
alter table public.jp_fetch add constraint jp_fetch_kind_check check (kind in ('index', 'standings', 'list', 'majors'));

create or replace function public.jp_read(f public.jp_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; i int; n int := 0; v_id int; v_icons text[]; v_list text; t public.jp_tournaments; p record;
begin
  if f.kind = 'majors' then
    perform public.jp_read_majors(body);

  elsif f.kind = 'index' then
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
      for ch in select x from regexp_split_to_table(
                  substring(body from position('<table class="data-table' in body)), '<tr>') x offset 1 loop
        i := substring(ch from '^\s*<td>(\d+)</td>')::int;
        continue when i is null;
        exit when i > 32;
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
      status = case when n > 0 and status <> 'lists' then 'lists' else status end, done_at = null
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

-- Work still to do: events without standings, and lists not fetched yet.
create or replace function public.jp_backlog() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'standings', (select count(*) from public.jp_tournaments t where t.status = 'new' and t.date >= public.jp_since() and t.standings_tries < 3),
    'lists', (select count(*) from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
              where t.date >= public.jp_since() and d.list_ref is not null and d.cards is null and d.attempts < 3 and d.place <= 32))
$$;
revoke execute on function public.jp_backlog() from public, anon, authenticated;

drop function if exists public.jp_tick();
create or replace function public.jp_tick(budget int default 3) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.jp_fetch; resp record; sent int := 0; ev record; dl record; since date := public.jp_since();
  last_index timestamptz; last_majors timestamptz; back int; seen timestamptz; ix record; majors int := 0; oldest date;
begin
  -- one run at a time (the normal job and the catch-up can land on the same minute)
  if not pg_try_advisory_xact_lock(hashtext('benchmark-jp-tick')) then return jsonb_build_object('busy', true); end if;
  budget := least(greatest(budget, 1), 6);

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

  -- 2. majors from the main tournament list the other job downloaded (no request of our own)
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

  -- 3. City League list: newest 100 daily; step back a page at a time until we reach jp_since
  select value::timestamptz into last_index from public.app_settings where key = 'jp_index_at';
  select value::int into back from public.app_settings where key = 'jp_index_back';
  back := coalesce(back, 1);
  select min(date) into oldest from public.jp_tournaments where kind = 'city_league';
  if last_index is null or last_index < now() - interval '23 hours' then
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100');
    insert into public.app_settings (key, value) values ('jp_index_at', now()::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  elsif back < 12 and (oldest is null or oldest >= since) then
    back := back + 1;
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100&page=' || back);
    insert into public.app_settings (key, value) values ('jp_index_back', back::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 4. main tournament list once a week, for Champions League events
  select value::timestamptz into last_majors from public.app_settings where key = 'jp_majors_at';
  if sent < budget and (last_majors is null or last_majors < now() - interval '7 days') then
    perform public.jp_get('majors', 'https://limitlesstcg.com/tournaments?show=100');
    insert into public.app_settings (key, value) values ('jp_majors_at', now()::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 5. standings: events since jp_since, majors first, newest first; retry a day later, 3 tries
  for ev in select * from public.jp_tournaments
           where status = 'new' and date >= since and standings_tries < 3
             and (standings_at is null or standings_at < now() - interval '23 hours')
           order by (kind = 'major') desc, date desc limit greatest(0, least(2, budget - sent)) loop
    perform public.jp_get('standings',
      case when ev.kind = 'major' then 'https://limitlesstcg.com/tournaments/' || ev.src_id
           else 'https://limitlesstcg.com/tournaments/jp/' || ev.src_id end, ev.id);
    sent := sent + 1;
  end loop;

  -- 6. deck lists up to 32nd: best placings first across all events (wins, then 2nds...), majors and newer first within a place
  for dl in select d.tournament_id, d.place, d.list_ref from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
           where t.date >= since and d.list_ref is not null and d.cards is null and d.attempts < 3 and d.place <= 32
           order by public.jp_points(d.place) desc, (t.kind = 'major') desc, t.date desc, d.place
           limit greatest(0, budget - sent) loop
    perform public.jp_get('list', 'https://limitlesstcg.com/decks/list/' || dl.list_ref, dl.tournament_id, dl.place);
    sent := sent + 1;
  end loop;

  -- 7. finished events
  update public.jp_tournaments t set status = 'done', done_at = now()
   where status <> 'done' and (
     (status = 'lists' and not exists (select 1 from public.jp_decks d where d.tournament_id = t.id and d.list_ref is not null
        and d.cards is null and d.attempts < 3 and d.place <= 32))
     or (status = 'new' and (standings_tries >= 3 or date < since)));
  delete from public.jp_fetch where handled_at < now() - interval '7 days';

  return jsonb_build_object('sent', sent, 'majors', majors);
end $$;
revoke execute on function public.jp_tick(int) from public, anon, authenticated;

-- Events already marked done under the old limits (top 8 standings, top 4 lists) get their standings read again.
update public.jp_tournaments set status = 'new', standings_tries = 0, standings_at = null, done_at = null
 where date >= public.jp_since() and (select count(*) from public.jp_decks d where d.tournament_id = jp_tournaments.id) = 8;
update public.jp_tournaments set status = 'lists', done_at = null
 where status = 'done' and date >= public.jp_since() and exists (select 1 from public.jp_decks d where d.tournament_id = jp_tournaments.id);

-- Catch-up: every minute, 4 requests, until the backlog is empty; then it unschedules itself.
create or replace function public.jp_catchup_tick() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare b jsonb := public.jp_backlog(); idx_done boolean;
begin
  select coalesce(value::int, 1) >= 12 or exists (select 1 from public.jp_tournaments where kind = 'city_league' and date < public.jp_since())
    into idx_done from public.app_settings where key = 'jp_index_back';
  if (b->>'standings')::int = 0 and (b->>'lists')::int = 0 and coalesce(idx_done, false)
     and not exists (select 1 from public.jp_fetch where handled_at is null) then
    perform cron.unschedule('benchmark-japan-catchup');
    insert into public.app_settings (key, value) values ('jp_catchup_done', now()::text) on conflict (key) do update set value = excluded.value;
    return jsonb_build_object('done', true);
  end if;
  return public.jp_tick(4) || jsonb_build_object('backlog', b);
end $$;
revoke execute on function public.jp_catchup_tick() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'benchmark-japan') then perform cron.unschedule('benchmark-japan'); end if;
  perform cron.schedule('benchmark-japan', '5-59/10 * * * *', 'select public.jp_tick(3)');
  if not exists (select 1 from cron.job where jobname = 'benchmark-japan-catchup')
     and not exists (select 1 from public.app_settings where key = 'jp_catchup_done') then
    perform cron.schedule('benchmark-japan-catchup', '* * * * *', 'select public.jp_catchup_tick()');
  end if;
end $$;

/* ---------- page data ---------- */

drop function if exists public.jp_meta(int, boolean);
create function public.jp_meta(p_days int default 14, p_preview_only boolean default false)
returns table (archetype text, icons text[], placings bigint, top8 bigint, top4 bigint, wins bigint, events bigint, points numeric,
               lists bigint, preview_lists bigint, best_tournament text, best_place int)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.*, t.date from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(p_days, 3), 180) and d.archetype <> '' and d.place <= 32
  ), best as (
    select distinct on (archetype) archetype, tournament_id, place from d
    where cards is not null and (not p_preview_only or has_preview) order by archetype, place, date desc
  ), agg as (
    select d.archetype, string_to_array((array_agg(array_to_string(d.icons, ',') order by d.date desc))[1], ',') icons,
           count(*) placings, count(*) filter (where d.place <= 8) top8, count(*) filter (where d.place <= 4) top4,
           count(*) filter (where d.place = 1) wins, count(distinct d.tournament_id) events, sum(public.jp_points(d.place)) points,
           count(d.cards) lists, count(d.cards) filter (where d.has_preview) preview_lists
    from d group by d.archetype
  )
  select a.archetype, a.icons, a.placings, a.top8, a.top4, a.wins, a.events, a.points, a.lists, a.preview_lists, b.tournament_id, b.place
  from agg a left join best b using (archetype)
  where not p_preview_only or a.preview_lists > 0
  order by a.points desc, a.wins desc, a.archetype
$$;
grant execute on function public.jp_meta(int, boolean) to anon, authenticated;

-- Preview-set cards with play rate and results. p_sort: 'wins' (finish points, the default) or 'played'.
drop function if exists public.jp_preview_cards(int);
drop function if exists public.jp_preview_cards(int, text);
create function public.jp_preview_cards(p_days int default 14, p_sort text default 'wins')
returns table (name text, code text, num text, lists bigint, share numeric, avg_copies numeric,
               wins bigint, top4 bigint, top8 bigint, points numeric, best_place int, avg_place numeric,
               top_decks text[], best_tournament text)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.* from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(p_days, 3), 180) and d.cards is not null
  ), total as (select count(*) n from d),
  l as (
    select d.tournament_id, d.place, d.archetype, x->>'name' name, x->>'code' code, x->>'num' num, (x->>'qty')::int qty
    from d, jsonb_array_elements(d.cards) x where (x->>'preview')::boolean
  ), per as (
    select tournament_id, place, archetype, name, min(code) code, min(num) num, sum(qty) qty from l group by 1, 2, 3, 4
  ), decks as (
    select name, array_agg(archetype order by n desc, archetype) top from (
      select name, archetype, count(*) n, row_number() over (partition by name order by count(*) desc, archetype) r
      from per group by name, archetype) z where r <= 3 group by name
  ), best as (
    select distinct on (name) name, tournament_id from per order by name, place, qty desc
  )
  select p.name, min(p.code), min(p.num), count(*),
         round(100.0 * count(*) / nullif((select n from total), 0), 1), round(avg(p.qty), 1),
         count(*) filter (where p.place = 1), count(*) filter (where p.place <= 4), count(*) filter (where p.place <= 8),
         sum(public.jp_points(p.place)), min(p.place), round(avg(p.place), 1),
         (select top from decks where decks.name = p.name), b.tournament_id
  from per p left join best b on b.name = p.name
  group by p.name, b.tournament_id
  order by case when p_sort = 'played' then count(*)::numeric else sum(public.jp_points(p.place)) end desc,
           count(*) filter (where p.place = 1) desc, count(*) desc, p.name
$$;
grant execute on function public.jp_preview_cards(int, text) to anon, authenticated;

-- Every finish of lists playing one preview-set card, best first.
create or replace function public.jp_card_finishes(p_name text, p_days int default 30, p_limit int default 100)
returns table (tournament_id text, event_name text, date date, kind text, shop text, players int,
               place int, player text, archetype text, qty bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.date, t.kind, t.shop, t.players, d.place, d.player, d.archetype, sum((x->>'qty')::int)
  from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id, jsonb_array_elements(d.cards) x
  where t.date >= current_date - least(greatest(p_days, 3), 180) and d.cards is not null
    and (x->>'preview')::boolean and x->>'name' = p_name
  group by t.id, d.place, d.player, d.archetype
  order by d.place, t.date desc, t.id
  limit least(greatest(p_limit, 1), 300)
$$;
grant execute on function public.jp_card_finishes(text, int, int) to anon, authenticated;

-- What else lists with that card play: share of those lists and average copies, most common first.
create or replace function public.jp_card_partners(p_name text, p_days int default 30, p_limit int default 30)
returns table (name text, preview boolean, lists bigint, share numeric, avg_copies numeric, cid text)
language sql stable security definer set search_path = public as $$
  with d as (
    select d.tournament_id, d.place, d.cards from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(p_days, 3), 180) and d.cards is not null
      and exists (select 1 from jsonb_array_elements(d.cards) y where (y->>'preview')::boolean and y->>'name' = p_name)
  ), n as (select count(*) n from d),
  l as (
    select d.tournament_id, d.place, x->>'name' name, bool_or((x->>'preview')::boolean) preview, sum((x->>'qty')::int) qty, max(x->>'cid') cid
    from d, jsonb_array_elements(d.cards) x where x->>'name' <> p_name group by 1, 2, 3
  )
  select l.name, bool_or(l.preview), count(*), round(100.0 * count(*) / nullif((select n from n), 0), 1), round(avg(l.qty), 1), max(l.cid)
  from l group by l.name
  order by count(*) desc, avg(l.qty) desc, l.name
  limit least(greatest(p_limit, 1), 80)
$$;
grant execute on function public.jp_card_partners(text, int, int) to anon, authenticated;

-- The page shows how much is still loading during the catch-up.
create or replace function public.jp_preview_info() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select public.jp_cfg() j),
  s as (select s.release_date, s.legal_date from public.sets s, c
        where (upper(s.code) = upper(c.j->>'code') or lower(s.name) = lower(c.j->>'name')) and not s.hidden
        order by s.release_date desc nulls last limit 1)
  select jsonb_build_object(
    'name', c.j->>'name', 'code', c.j->>'code', 'jp_name', c.j->>'jp_name', 'jp_codes', c.j->'jp_codes',
    'jp_since', public.jp_since(),
    'us_release', coalesce((select release_date::text from s), c.j->>'us_release'),
    'us_legal', coalesce((select legal_date::text from s), c.j->>'us_legal'),
    'updated', (select max(fetched_at) from public.jp_decks),
    'lists', (select count(*) from public.jp_decks where cards is not null),
    'queued', public.jp_backlog())
  from c
$$;
grant execute on function public.jp_preview_info() to anon, authenticated;
