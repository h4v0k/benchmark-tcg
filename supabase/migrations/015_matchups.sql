-- Matchup statistics: how each archetype does against every other archetype.
-- Free for everyone. Data from Limitless (credited on the page).

----------------------------------------------------------------------------
-- 1. Matchup data
--    online:   Limitless Play API (play.limitlesstcg.com/api), Standard events with 32+ players, last 60 days
--    official: Limitless Labs (Regionals, Internationals, Worlds), Masters division, last 180 days
--    Both use the same deck ids (e.g. 'dragapult-ex'), so the two sets line up.
----------------------------------------------------------------------------
create table if not exists public.archetypes (
  slug text primary key,
  name text not null,
  icons text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.archetypes enable row level security;
drop policy if exists "Archetypes are public" on public.archetypes;
create policy "Archetypes are public" on public.archetypes for select using (true);
grant select on public.archetypes to anon, authenticated;

create table if not exists public.mu_events (
  source text not null check (source in ('online', 'official')),
  event_id text not null,
  name text not null default '',
  date date not null,
  starts_at timestamptz,                   -- online: start time (pairings are read a day later)
  players int,
  rounds int,
  rounds_done int[] not null default '{}',   -- official: rounds already counted
  status text not null default 'new' check (status in ('new', 'standings', 'rounds', 'done', 'skip')),
  tries int not null default 0,
  revived boolean not null default false,    -- a skipped event gets one more chance when it shows up in the list again
  first_seen timestamptz not null default now(),
  done_at timestamptz,
  primary key (source, event_id)
);
-- columns added while this migration was being written, in case an earlier draft of it was ever applied
alter table public.mu_events add column if not exists starts_at timestamptz;
alter table public.mu_events add column if not exists rounds_done int[] not null default '{}';
alter table public.mu_events add column if not exists revived boolean not null default false;
create index if not exists mu_events_todo on public.mu_events (status, date desc) where status not in ('done', 'skip');
create index if not exists mu_events_source_date on public.mu_events (source, date desc) where status = 'done';

-- online only: who played what, kept until the event's pairings are counted
create table if not exists public.mu_players (
  event_id text not null,
  player text not null,
  deck text,
  primary key (event_id, player)
);

-- one row per (event, deck, opponent deck), from that deck's point of view; both directions are stored
create table if not exists public.mu_results (
  source text not null,
  event_id text not null,
  deck text not null,
  opp text not null,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  primary key (source, event_id, deck, opp),
  foreign key (source, event_id) references public.mu_events(source, event_id) on delete cascade
);
create index if not exists mu_results_deck on public.mu_results (source, deck);

create table if not exists public.mu_fetch (
  net_id bigint primary key,
  kind text not null check (kind in ('online_index', 'online_standings', 'online_pairings', 'official_index', 'official_info', 'official_round')),
  event_id text,
  round int,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

alter table public.mu_events enable row level security;
alter table public.mu_players enable row level security;
alter table public.mu_results enable row level security;
alter table public.mu_fetch enable row level security;
revoke all on public.mu_events, public.mu_players, public.mu_results, public.mu_fetch from anon, authenticated;

create or replace function public.mu_get(p_kind text, p_url text, p_event text default null, p_round int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmark-tcg.mpr0317.workers.dev; matchup stats, cached)'),
    timeout_milliseconds := 30000);
  insert into public.mu_fetch (net_id, kind, event_id, round) values (nid, p_kind, p_event, p_round);
end $$;

-- Deck ids from Limitless look like 'dragapult-ex'; anything else is ignored.
create or replace function public.mu_slug_ok(p text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p, '') ~ '^[a-z0-9][a-z0-9-]{0,63}$' and p <> 'other' $$;

-- Reads a stored setting as a time; anything unreadable counts as "never" instead of breaking the collector.
create or replace function public.mu_ts(v text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return coalesce(v::timestamptz, '-infinity');
exception when others then
  return '-infinity';
end $$;

create or replace function public.mu_archetype(p_slug text, p_name text, p_icons text[]) returns void
language sql security definer set search_path = public as $$
  insert into public.archetypes (slug, name, icons)
  select p_slug, left(coalesce(nullif(btrim(p_name), ''), p_slug), 100),
         coalesce((select array_agg(left(x, 40)) from (select x from unnest(p_icons) x where x ~ '^[a-z0-9-]{1,40}$' limit 4) y), '{}')
  where public.mu_slug_ok(p_slug)
  on conflict (slug) do update set name = excluded.name, icons = excluded.icons, updated_at = now()  -- touched on every sighting
$$;

-- Adds one match result in both directions. p_result: 'w' (deck won), 'l', 't'.
create or replace function public.mu_add(p_source text, p_event text, p_a text, p_b text, p_result text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.mu_slug_ok(p_a) or not public.mu_slug_ok(p_b) then return; end if;
  insert into public.mu_results as r (source, event_id, deck, opp, wins, losses, ties)
  values (p_source, p_event, p_a, p_b, (p_result = 'w')::int, (p_result = 'l')::int, (p_result = 't')::int)
  on conflict (source, event_id, deck, opp) do update
    set wins = r.wins + excluded.wins, losses = r.losses + excluded.losses, ties = r.ties + excluded.ties;
  insert into public.mu_results as r (source, event_id, deck, opp, wins, losses, ties)
  values (p_source, p_event, p_b, p_a, (p_result = 'l')::int, (p_result = 'w')::int, (p_result = 't')::int)
  on conflict (source, event_id, deck, opp) do update
    set wins = r.wins + excluded.wins, losses = r.losses + excluded.losses, ties = r.ties + excluded.ties;
end $$;

create or replace function public.mu_read(f public.mu_fetch, body text) returns void
language plpgsql security definer set search_path = public as $$
declare j jsonb := body::jsonb; e jsonb; ev public.mu_events; res text; w text;
begin
  if f.kind = 'online_index' then
    if jsonb_typeof(j) is distinct from 'array' then raise exception 'online_index: not a list'; end if;
    -- f.round holds the page number; each backfill page that reads OK is noted, so a failed one is fetched again
    if f.round between 1 and 4 then
      insert into public.app_settings (key, value) values ('mu_backfill_page_' || f.round, now()::text) on conflict (key) do nothing;
    end if;
    for e in select * from jsonb_array_elements(j) loop
      begin  -- one odd entry shouldn't sink the whole page
        if coalesce(e->>'id', '') ~ '^[A-Za-z0-9_-]{1,64}$' and coalesce(e->>'players', '') ~ '^\d+$'
           and (e->>'players')::int >= 32 and upper(coalesce(e->>'format', '')) = 'STANDARD'
           and (e->>'date')::timestamptz between now() - interval '60 days' and now() then
          insert into public.mu_events (source, event_id, name, date, starts_at, players)
          values ('online', e->>'id', left(coalesce(e->>'name', ''), 200), (e->>'date')::timestamptz::date, (e->>'date')::timestamptz, (e->>'players')::int)
          on conflict (source, event_id) do update set status = 'new', tries = 0, done_at = null, revived = true
            where mu_events.status = 'skip' and not mu_events.revived;
        end if;
      exception when others then continue;
      end;
    end loop;

  elsif f.kind = 'online_standings' then
    if jsonb_typeof(j) is distinct from 'array' then raise exception 'online_standings: not a list'; end if;
    delete from public.mu_players where event_id = f.event_id;
    for e in select * from jsonb_array_elements(j) loop
      if e->'deck'->>'id' is not null and e->>'player' is not null then
        insert into public.mu_players (event_id, player, deck) values (f.event_id, e->>'player', e->'deck'->>'id') on conflict do nothing;
        perform public.mu_archetype(e->'deck'->>'id', e->'deck'->>'name',
          array(select jsonb_array_elements_text(coalesce(e->'deck'->'icons', '[]'::jsonb))));
      end if;
    end loop;
    if (select count(*) from public.mu_players where event_id = f.event_id) < 16 then
      update public.mu_events set status = 'skip', done_at = now() where source = 'online' and event_id = f.event_id;  -- no deck data
      delete from public.mu_players where event_id = f.event_id;
    else
      update public.mu_events set status = 'standings' where source = 'online' and event_id = f.event_id;
    end if;

  elsif f.kind = 'online_pairings' then
    if jsonb_typeof(j) is distinct from 'array' or jsonb_array_length(j) = 0 then raise exception 'online_pairings: no pairings yet'; end if;
    -- a match with two players and no result means the event is still running: try again next run.
    -- After 3 days, assume it was abandoned and count the matches that did finish.
    if exists (select 1 from jsonb_array_elements(j) x where coalesce(x->>'player2', '') <> '' and (x->'winner' is null or x->'winner' = 'null'::jsonb))
       and coalesce((select coalesce(starts_at, date::timestamptz) from public.mu_events where source = 'online' and event_id = f.event_id), now()) > now() - interval '72 hours' then
      raise exception 'online_pairings: event not finished' using errcode = 'MU001';  -- not a failure: try again next run
    end if;
    delete from public.mu_results where source = 'online' and event_id = f.event_id;  -- safe to re-run
    for e in select * from jsonb_array_elements(j) loop
      continue when coalesce(e->>'player2', '') = '' or e->>'winner' = '-1';
      w := e->>'winner';
      res := case when w = '0' then 't' when w = e->>'player1' then 'w' when w = e->>'player2' then 'l' end;
      continue when res is null;
      perform public.mu_add('online', f.event_id,
        (select deck from public.mu_players where event_id = f.event_id and player = e->>'player1'),
        (select deck from public.mu_players where event_id = f.event_id and player = e->>'player2'), res);
    end loop;
    delete from public.mu_players where event_id = f.event_id;
    update public.mu_events set status = 'done', done_at = now() where source = 'online' and event_id = f.event_id;

  elsif f.kind = 'official_index' then
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'array' then raise exception 'official_index: bad response'; end if;
    for e in select * from jsonb_array_elements(j->'message') loop
      begin
        if coalesce(e->>'id', '') ~ '^\d{1,6}$' and e->>'completed' in ('1', 'true')
           and e->>'type' in ('regional', 'international', 'worlds')
           and (e->>'utc_start')::timestamp >= now() - interval '180 days' then
          insert into public.mu_events (source, event_id, name, date)
          values ('official', lpad(e->>'id', 4, '0'),
            case e->>'type' when 'worlds' then 'World Championship' when 'international' then 'International Championship'
                 else 'Regional Championship' end || ' ' || coalesce(e->>'city', ''),
            (e->>'utc_start')::timestamp::date)
          on conflict (source, event_id) do update set status = 'new', tries = 0, done_at = null, rounds_done = '{}', revived = true
            where mu_events.status = 'skip' and not mu_events.revived;
        end if;
      exception when others then continue;
      end;
    end loop;

  elsif f.kind = 'official_info' then
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'object' then raise exception 'official_info: bad response'; end if;
    update public.mu_events set players = (j->'message'->>'players')::int, rounds = (j->'message'->>'round')::int,
      status = case when coalesce((j->'message'->>'round')::int, 0) > 0 then 'rounds' else 'skip' end
    where source = 'official' and event_id = f.event_id;

  elsif f.kind = 'official_round' then
    select * into ev from public.mu_events where source = 'official' and event_id = f.event_id;
    if ev.status <> 'rounds' or f.round = any(ev.rounds_done) then return; end if;  -- already counted
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'array' then raise exception 'official_round: bad response'; end if;
    for e in select * from jsonb_array_elements(j->'message') loop
      continue when e->>'player2' is null or coalesce((e->>'completed')::int, 1) <> 1;
      perform public.mu_archetype(e->>'p1_deck', e->>'p1_deck_name', string_to_array(nullif(e->>'p1_icons', ''), ' '));
      perform public.mu_archetype(e->>'p2_deck', e->>'p2_deck_name', string_to_array(nullif(e->>'p2_icons', ''), ' '));
      w := e->>'winner';
      res := case when w = '0' then 't' when w = e->>'player1' then 'w' when w = e->>'player2' then 'l' end;
      continue when res is null;
      perform public.mu_add('official', f.event_id, e->>'p1_deck', e->>'p2_deck', res);
    end loop;
    update public.mu_events set rounds_done = rounds_done || f.round,
      status = case when cardinality(rounds_done) + 1 >= coalesce(rounds, 0) then 'done' else status end,
      done_at = case when cardinality(rounds_done) + 1 >= coalesce(rounds, 0) then now() end
    where source = 'official' and event_id = f.event_id;
  end if;
end $$;

-- Two cron jobs call this (see bottom of file):
--   every 6 hours: read anything still waiting, then send the next small batch (p_send = true)
--   5 minutes later: only read the answers to that batch (p_send = false), before pg_net clears them
-- Each send run sends at most `budget` event requests plus the online event list (page 1, plus pages 2-4 of the one-time
-- backfill). Of everything sent, no more than `site_cap` requests go to the Labs site (official list included);
-- the Play API gets the rest of the budget. If Limitless answers 429 (too many requests), sending stops for at
-- least 12 hours, doubling on each run that gets one (up to 4 days), or as long as Retry-After asks (up to 4 days).
drop function if exists public.mu_tick(int, boolean);  -- older two-argument version
create or replace function public.mu_tick(budget int default 20, p_send boolean default true, site_cap int default 8) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.mu_fetch; resp record; sent int := 0; ev_sent int := 0; labs_sent int := 0; ev public.mu_events;
  last_at timestamptz; pages int; ok boolean; rnd int; failed text[] := '{}'; worked text[] := '{}'; k text;
  pause interval; retry_after int; streak int; saw429 boolean := false; max_retry int; src text; not_yet boolean;
  ok_src text[] := '{}'; down_src text[] := '{}'; heard_src text[] := '{}';   -- which sites ('online' = Play API, 'official' = Labs) answered well / were down this run
begin
  -- one run at a time (cron plus a manual call must not read the same response twice)
  if not pg_try_advisory_xact_lock(hashtext('benchmark_mu_tick')) then return jsonb_build_object('busy', true); end if;

  -- 1. read finished responses
  for f in select * from public.mu_fetch where handled_at is null order by created_at loop
    select status_code, content, headers into resp from net._http_response where id = f.net_id;
    if not found then
      -- pg_net already cleared it (or it never came back): counts as a failed try for the event
      if f.created_at < now() - interval '3 hours' then
        down_src := down_src || (case when f.kind like 'online%' then 'online' else 'official' end);
        if f.event_id is not null then
          failed := failed || ((case when f.kind like 'online%' then 'online' else 'official' end) || ':' || f.event_id);
        elsif f.kind like '%index' then
          update public.app_settings set value = '-infinity' where key = 'mu_' || f.kind || '_at';  -- fetch the list again next run
        end if;
        update public.mu_fetch set handled_at = now() where net_id = f.net_id;
      end if;
      continue;
    end if;

    if resp.status_code is not null and resp.status_code < 500 then
      heard_src := heard_src || (case when f.kind like 'online%' then 'online' else 'official' end);  -- the site is up
    end if;
    if resp.status_code = 429 then
      -- rate limited: noted here, acted on once after the loop; not the event's fault, so no try is counted
      saw429 := true;
      retry_after := case when coalesce(resp.headers->>'Retry-After', resp.headers->>'retry-after', '') ~ '^\d{1,7}$'
                          then coalesce(resp.headers->>'Retry-After', resp.headers->>'retry-after')::int end;
      max_retry := greatest(max_retry, retry_after);
      if f.kind like '%index' then update public.app_settings set value = '-infinity' where key = 'mu_' || f.kind || '_at'; end if;
      update public.mu_fetch set handled_at = now() where net_id = f.net_id;
      continue;
    end if;

    ok := false; not_yet := false;
    src := case when f.kind like 'online%' then 'online' else 'official' end;
    begin
      -- anything that isn't a usable 200 (5xx, timeout, 404, a body in the wrong shape) is a failed try
      if resp.status_code = 200 and resp.content is not null then perform public.mu_read(f, resp.content); ok := true; end if;
    exception
      when sqlstate 'MU001' then not_yet := true;  -- event still running: neither a success nor a failure
      when others then raise warning 'mu_read % % failed: %', f.kind, f.event_id, sqlerrm;
    end;
    if f.event_id is not null and not not_yet then
      k := src || ':' || f.event_id;
      if ok then worked := worked || k; else failed := failed || k; end if;
    end if;
    if ok or not_yet then ok_src := ok_src || src;
    elsif resp.status_code is null or resp.status_code >= 500 then down_src := down_src || src; end if;
    if f.event_id is null and not ok and f.kind like '%index' then
      update public.app_settings set value = '-infinity' where key = 'mu_' || f.kind || '_at';  -- fetch the list again next run
    end if;
    update public.mu_fetch set handled_at = now() where net_id = f.net_id;
  end loop;
  delete from public.mu_fetch where handled_at < now() - interval '2 days';
  -- At most one try per event per run (an official event sends many rounds at once); a clean run resets it.
  -- If a site gave no good answer this run and some of its requests got server errors or no answer, that site is
  -- down: its events don't lose a try (an outage can't use up retries). After 4 days down, tries count again, so
  -- something broken for good is still given up on eventually.
  foreach src in array array['online', 'official'] loop
    if not (src = any(ok_src)) and src = any(down_src) then
      insert into public.app_settings (key, value) values ('mu_down_since_' || src, now()::text) on conflict (key) do nothing;
    elsif src = any(heard_src) then
      delete from public.app_settings where key = 'mu_down_since_' || src;  -- answered at all (even 4xx/429): not down
    end if;
    if public.mu_ts((select value from public.app_settings where key = 'mu_down_since_' || src)) < now() - interval '4 days'
       or not exists (select 1 from public.app_settings where key = 'mu_down_since_' || src) then
      update public.mu_events set tries = tries + 1 where source = src and source || ':' || event_id = any(failed);
    end if;
  end loop;
  update public.mu_events set tries = 0 where source || ':' || event_id = any(worked) and not (source || ':' || event_id = any(failed));

  -- 429s, once per run: pause 12h (skips the next send run), doubling on each run that gets one, up to 4 days,
  -- or longer if Limitless asks (Retry-After, also capped at 4 days). A run with good answers and no 429 ends the streak.
  if saw429 then
    streak := coalesce((select case when value ~ '^\d{1,3}$' then value::int end from public.app_settings where key = 'mu_429_streak'), 0) + 1;
    pause := least(interval '12 hours' * power(2, least(streak - 1, 3)), interval '4 days');
    if max_retry is not null then pause := least(greatest(pause, make_interval(secs => max_retry)), interval '4 days'); end if;
    insert into public.app_settings (key, value) values ('mu_429_streak', streak::text) on conflict (key) do update set value = excluded.value;
    insert into public.app_settings as a (key, value) values ('mu_backoff_until', (now() + pause)::text)
      on conflict (key) do update set value = greatest(public.mu_ts(a.value), excluded.value::timestamptz)::text;
  elsif cardinality(ok_src) > 0 then
    delete from public.app_settings where key = 'mu_429_streak';
  end if;

  if not p_send then return jsonb_build_object('read', true); end if;
  if exists (select 1 from public.mu_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.mu_fetch where handled_at is null));
  end if;

  -- give up on events that fail 5 runs in a row (30 hours). An official event that already has some rounds
  -- counted keeps them and is finished as is (a round Limitless never serves shouldn't wipe the rest);
  -- anything else is skipped and whatever it had is dropped.
  update public.mu_events set status = 'done', done_at = now()
   where status = 'rounds' and tries >= 5 and cardinality(rounds_done) > 0;
  with gone as (
    update public.mu_events set status = 'skip', done_at = now() where status not in ('done', 'skip') and tries >= 5
    returning source, event_id)
  delete from public.mu_results r using gone g where r.source = g.source and r.event_id = g.event_id;
  delete from public.mu_players p where not exists (select 1 from public.mu_events e where e.source = 'online' and e.event_id = p.event_id and e.status = 'standings');

  -- 4. forget events older than 180 days, and archetypes nothing refers to any more
  delete from public.mu_events where date < current_date - 180;
  delete from public.archetypes a where updated_at < now() - interval '30 days'
    and not exists (select 1 from public.mu_results r where r.deck = a.slug);

  if public.mu_ts((select value from public.app_settings where key = 'mu_backoff_until')) > now() then
    return jsonb_build_object('backoff_until', (select value from public.app_settings where key = 'mu_backoff_until'));
  end if;

  -- 2. event lists: online page 1 every run, plus pages 2-4 (~60 days back) until each has been read once; official once a day
  last_at := public.mu_ts((select value from public.app_settings where key = 'mu_online_index_at'));
  if last_at < now() - interval '5 hours' then
    for i in 1..4 loop
      -- page 1 always (new events); pages 2-4 only until each has been read once
      continue when i > 1 and exists (select 1 from public.app_settings where key = 'mu_backfill_page_' || i);
      perform public.mu_get('online_index', 'https://play.limitlesstcg.com/api/tournaments?game=PTCG&format=STANDARD&limit=200&page=' || i, null, i);
      sent := sent + 1;
    end loop;
    insert into public.app_settings (key, value) values ('mu_online_index_at', now()::text) on conflict (key) do update set value = excluded.value;
  end if;
  last_at := public.mu_ts((select value from public.app_settings where key = 'mu_official_index_at'));
  if last_at < now() - interval '23 hours' then
    perform public.mu_get('official_index', 'https://mew.limitlesstcg.com/labs/data/tcg/tournaments');
    sent := sent + 1; labs_sent := labs_sent + 1;  -- counts toward the Labs cap
    insert into public.app_settings (key, value) values ('mu_official_index_at', now()::text) on conflict (key) do update set value = excluded.value;
  end if;

  -- 3. work through events, newest first (both sources), so recent weeks fill in before the backfill
  -- online events wait a day after their start so Swiss and top cut are finished
  for ev in select * from public.mu_events where status not in ('done', 'skip')
              and (source = 'official' or coalesce(starts_at, date::timestamptz) <= now() - interval '24 hours')
            order by date desc, (source = 'official') desc loop
    exit when ev_sent >= budget;
    if ev.source = 'online' then
      if ev.status = 'new' then
        perform public.mu_get('online_standings', 'https://play.limitlesstcg.com/api/tournaments/' || ev.event_id || '/standings', ev.event_id);
      else
        perform public.mu_get('online_pairings', 'https://play.limitlesstcg.com/api/tournaments/' || ev.event_id || '/pairings', ev.event_id);
      end if;
      ev_sent := ev_sent + 1;
    elsif labs_sent >= site_cap then
      continue;  -- enough for the Labs site this run; online events can still use the rest of the budget
    elsif ev.status = 'new' then
      perform public.mu_get('official_info', 'https://mew.limitlesstcg.com/labs/data/tcg/tournament?id=' || ev.event_id || '&division=MA', ev.event_id);
      ev_sent := ev_sent + 1; labs_sent := labs_sent + 1;
    else
      -- rounds not counted yet, as far as the budget and the per-site cap allow
      for rnd in 1..coalesce(ev.rounds, 0) loop
        continue when rnd = any(ev.rounds_done);
        exit when ev_sent >= budget or labs_sent >= site_cap;
        perform public.mu_get('official_round', 'https://mew.limitlesstcg.com/labs/data/tcg/pairings?tournamentId=' || ev.event_id
          || '&division=MA&round=' || rnd, ev.event_id, rnd);
        ev_sent := ev_sent + 1; labs_sent := labs_sent + 1;
      end loop;
    end if;
  end loop;
  sent := sent + ev_sent;

  return jsonb_build_object('sent', sent);
end $$;

revoke execute on function public.mu_get(text, text, text, int) from public, anon, authenticated;
revoke execute on function public.mu_archetype(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.mu_slug_ok(text) from public, anon, authenticated;
revoke execute on function public.mu_ts(text) from public, anon, authenticated;
revoke execute on function public.mu_add(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mu_read(public.mu_fetch, text) from public, anon, authenticated;
revoke execute on function public.mu_tick(int, boolean, int) from public, anon, authenticated;

-- Every 6 hours at :17 (off the top of the hour), plus a read-only pass 5 minutes later.
-- cron.schedule with an existing name updates that job, so re-running this is safe.
select cron.schedule('benchmark-matchups', '17 */6 * * *', 'select public.mu_tick()');
select cron.schedule('benchmark-matchups-read', '22 */6 * * *', 'select public.mu_tick(0, false)');

----------------------------------------------------------------------------
-- 2. Reading the stats
--    Win rate counts a tie as a third of a win, like tournament points (win 3, tie 1).
----------------------------------------------------------------------------

-- Every archetype with its games and overall win rate (mirrors left out). Powers the picker.
create or replace function public.matchup_decks(p_source text default 'online', p_days int default 30)
returns table (deck text, name text, icons text[], games bigint, wins bigint, losses bigint, ties bigint, win_pct numeric, events bigint)
language sql stable security definer set search_path = public as $$
  select r.deck, coalesce(a.name, r.deck), coalesce(a.icons, '{}'),
    sum(r.wins + r.losses + r.ties), sum(r.wins), sum(r.losses), sum(r.ties),
    round(100.0 * (3 * sum(r.wins) + sum(r.ties)) / nullif(3 * sum(r.wins + r.losses + r.ties), 0), 1),
    count(distinct r.event_id)
  from public.mu_results r
  join public.mu_events e on e.source = r.source and e.event_id = r.event_id
  left join public.archetypes a on a.slug = r.deck
  where r.source = p_source and e.status = 'done' and r.deck <> r.opp and e.date >= current_date - least(greatest(p_days, 7), 180)
  group by r.deck, a.name, a.icons
  having sum(r.wins + r.losses + r.ties) >= 10
  order by 4 desc
$$;
grant execute on function public.matchup_decks(text, int) to anon, authenticated;

-- One archetype against every opponent archetype.
create or replace function public.matchups(p_deck text, p_source text default 'online', p_days int default 30)
returns table (opp text, name text, icons text[], games bigint, wins bigint, losses bigint, ties bigint, win_pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select r.opp, coalesce(a.name, r.opp), coalesce(a.icons, '{}'::text[]),
    sum(r.wins + r.losses + r.ties)::bigint, sum(r.wins)::bigint, sum(r.losses)::bigint, sum(r.ties)::bigint,
    round(100.0 * (3 * sum(r.wins) + sum(r.ties)) / nullif(3 * sum(r.wins + r.losses + r.ties), 0), 1)
  from public.mu_results r
  join public.mu_events e on e.source = r.source and e.event_id = r.event_id
  left join public.archetypes a on a.slug = r.opp
  where r.source = p_source and e.status = 'done' and r.deck = p_deck and r.opp <> r.deck
    and e.date >= current_date - least(greatest(p_days, 7), 180)
  group by r.opp, a.name, a.icons
  order by sum(r.wins + r.losses + r.ties) desc;
end $$;
grant execute on function public.matchups(text, text, int) to anon, authenticated;

-- What the stats are built from, for the page footer.
create or replace function public.matchup_coverage(p_source text default 'online', p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'events', count(*) filter (where status = 'done' and exists (select 1 from public.mu_results r where r.source = e.source and r.event_id = e.event_id)),
    'pending', count(*) filter (where status not in ('done', 'skip')),
    'from', min(date) filter (where status = 'done' and exists (select 1 from public.mu_results r where r.source = e.source and r.event_id = e.event_id)),
    'to', max(date) filter (where status = 'done' and exists (select 1 from public.mu_results r where r.source = e.source and r.event_id = e.event_id)),
    'event_names', (select jsonb_agg(x.name order by x.date desc) from (select e2.name, e2.date from public.mu_events e2
        where e2.source = p_source and e2.status = 'done' and e2.date >= current_date - least(greatest(p_days, 7), 180)
          and exists (select 1 from public.mu_results r2 where r2.source = e2.source and r2.event_id = e2.event_id)
        order by e2.date desc limit 8) x))
  from public.mu_events e
  where e.source = p_source and e.date >= current_date - least(greatest(p_days, 7), 180)
$$;
grant execute on function public.matchup_coverage(text, int) to anon, authenticated;
