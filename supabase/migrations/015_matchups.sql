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
  next_round int not null default 1,
  status text not null default 'new' check (status in ('new', 'standings', 'rounds', 'done', 'skip')),
  tries int not null default 0,
  first_seen timestamptz not null default now(),
  done_at timestamptz,
  primary key (source, event_id)
);
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

create or replace function public.mu_archetype(p_slug text, p_name text, p_icons text[]) returns void
language sql security definer set search_path = public as $$
  insert into public.archetypes (slug, name, icons) values (p_slug, coalesce(nullif(p_name, ''), p_slug), coalesce(p_icons, '{}'))
  on conflict (slug) do update set name = excluded.name, icons = excluded.icons, updated_at = now()
  where archetypes.name is distinct from excluded.name or archetypes.icons is distinct from excluded.icons
$$;

-- Adds one match result in both directions. p_result: 'w' (deck won), 'l', 't'.
create or replace function public.mu_add(p_source text, p_event text, p_a text, p_b text, p_result text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_a is null or p_b is null or p_a = '' or p_b = '' or p_a = 'other' or p_b = 'other' then return; end if;
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
    for e in select * from jsonb_array_elements(j) loop
      begin  -- one odd entry shouldn't sink the whole page
        if coalesce(e->>'id', '') ~ '^[A-Za-z0-9_-]{1,64}$' and coalesce(e->>'players', '') ~ '^\d+$'
           and (e->>'players')::int >= 32 and upper(coalesce(e->>'format', '')) = 'STANDARD'
           and (e->>'date')::timestamptz between now() - interval '60 days' and now() then
          insert into public.mu_events (source, event_id, name, date, starts_at, players)
          values ('online', e->>'id', left(coalesce(e->>'name', ''), 200), (e->>'date')::timestamptz::date, (e->>'date')::timestamptz, (e->>'players')::int)
          on conflict do nothing;
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
          on conflict do nothing;
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
    if ev.next_round <> f.round then return; end if;  -- already counted
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
    update public.mu_events set next_round = next_round + 1,
      status = case when next_round + 1 > coalesce(rounds, 0) then 'done' else status end,
      done_at = case when next_round + 1 > coalesce(rounds, 0) then now() end
    where source = 'official' and event_id = f.event_id;
  end if;
end $$;

-- Runs every 5 minutes. Sends at most a few requests per run so Limitless is never hammered.
create or replace function public.mu_tick(budget int default 6) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.mu_fetch; resp record; sent int := 0; ev public.mu_events; last_at timestamptz; pages int; ok boolean;
begin
  -- one run at a time (cron plus a manual call must not read the same response twice)
  if not pg_try_advisory_xact_lock(hashtext('benchmark_mu_tick')) then return jsonb_build_object('busy', true); end if;

  -- 1. read finished responses
  for f in select * from public.mu_fetch where handled_at is null order by created_at loop
    select status_code, content into resp from net._http_response where id = f.net_id;
    if not found then
      if f.created_at < now() - interval '1 hour' then update public.mu_fetch set handled_at = now() where net_id = f.net_id; end if;
      continue;
    end if;
    ok := false;
    if f.kind like '%index' and resp.status_code is distinct from 200 then
      delete from public.app_settings where key = 'mu_' || f.kind || '_at';  -- the list failed: fetch it again after any pause
    end if;
    if resp.status_code is null or resp.status_code >= 500 then
      -- Limitless is down or erroring: pause for 20 minutes (the failed try still counts, below), so a short
      -- outage costs an event at most a couple of tries instead of a try every 5 minutes
      insert into public.app_settings (key, value) values ('mu_backoff_until', (now() + interval '20 minutes')::text)
        on conflict (key) do update set value = excluded.value;
    end if;
    if resp.status_code = 429 then
      -- rate limited: pause everything for 30 minutes; this doesn't count against the event
      insert into public.app_settings (key, value) values ('mu_backoff_until', (now() + interval '30 minutes')::text)
        on conflict (key) do update set value = excluded.value;
      update public.mu_fetch set handled_at = now() where net_id = f.net_id;
      continue;
    end if;
    begin
      -- anything else that isn't a 200 (5xx, timeout, 404) counts as a failed try for the event
      if resp.status_code = 200 and resp.content is not null then perform public.mu_read(f, resp.content); ok := true; end if;
    exception when others then
      raise warning 'mu_read % % failed: %', f.kind, f.event_id, sqlerrm;
    end;
    if f.event_id is not null then
      -- a success resets the error count; tries only adds up for errors in a row
      update public.mu_events set tries = case when ok then 0 else tries + 1 end where event_id = f.event_id
        and source = case when f.kind like 'online%' then 'online' else 'official' end;
    end if;
    update public.mu_fetch set handled_at = now() where net_id = f.net_id;
  end loop;
  delete from public.mu_fetch where handled_at < now() - interval '2 days';

  if exists (select 1 from public.mu_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.mu_fetch where handled_at is null));
  end if;

  -- give up on events that fail 5 times in a row (with the pauses above, that's well over an hour of errors),
  -- and drop anything partly counted from them
  with gone as (
    update public.mu_events set status = 'skip', done_at = now() where status not in ('done', 'skip') and tries >= 5
    returning source, event_id)
  delete from public.mu_results r using gone g where r.source = g.source and r.event_id = g.event_id;

  if coalesce((select value::timestamptz from public.app_settings where key = 'mu_backoff_until'), '-infinity') > now() then
    return jsonb_build_object('backoff_until', (select value from public.app_settings where key = 'mu_backoff_until'));
  end if;
  delete from public.mu_players p where not exists (select 1 from public.mu_events e where e.source = 'online' and e.event_id = p.event_id and e.status = 'standings');

  -- 2. event lists: online every 6 hours (two pages the first time, to fill the last few weeks), official once a day
  select value::timestamptz into last_at from public.app_settings where key = 'mu_online_index_at';
  if last_at is null or last_at < now() - interval '6 hours' then
    pages := case when last_at is null then 2 else 1 end;
    for i in 1..pages loop
      perform public.mu_get('online_index', 'https://play.limitlesstcg.com/api/tournaments?game=PTCG&format=STANDARD&limit=200&page=' || i);
      sent := sent + 1;
    end loop;
    insert into public.app_settings (key, value) values ('mu_online_index_at', now()::text) on conflict (key) do update set value = excluded.value;
  end if;
  select value::timestamptz into last_at from public.app_settings where key = 'mu_official_index_at';
  if last_at is null or last_at < now() - interval '23 hours' then
    perform public.mu_get('official_index', 'https://mew.limitlesstcg.com/labs/data/tcg/tournaments');
    sent := sent + 1;
    insert into public.app_settings (key, value) values ('mu_official_index_at', now()::text) on conflict (key) do update set value = excluded.value;
  end if;

  -- 3. work through events, newest first; official first since there are few and they matter most
  -- online events wait a day after their start so Swiss and top cut are finished
  for ev in select * from public.mu_events where status not in ('done', 'skip')
              and (source = 'official' or starts_at <= now() - interval '24 hours')
            order by (source = 'official') desc, date desc limit greatest(0, budget - sent) loop
    if ev.source = 'online' then
      if ev.status = 'new' then
        perform public.mu_get('online_standings', 'https://play.limitlesstcg.com/api/tournaments/' || ev.event_id || '/standings', ev.event_id);
      else
        perform public.mu_get('online_pairings', 'https://play.limitlesstcg.com/api/tournaments/' || ev.event_id || '/pairings', ev.event_id);
      end if;
    elsif ev.status = 'new' then
      perform public.mu_get('official_info', 'https://mew.limitlesstcg.com/labs/data/tcg/tournament?id=' || ev.event_id || '&division=MA', ev.event_id);
    else
      perform public.mu_get('official_round', 'https://mew.limitlesstcg.com/labs/data/tcg/pairings?tournamentId=' || ev.event_id
        || '&division=MA&round=' || ev.next_round, ev.event_id, ev.next_round);
    end if;
    sent := sent + 1;
  end loop;

  -- 4. forget events older than 180 days
  delete from public.mu_events where date < current_date - 180;

  return jsonb_build_object('sent', sent);
end $$;

revoke execute on function public.mu_get(text, text, text, int) from public, anon, authenticated;
revoke execute on function public.mu_archetype(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.mu_add(text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.mu_read(public.mu_fetch, text) from public, anon, authenticated;
revoke execute on function public.mu_tick(int) from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'benchmark-matchups') then
    perform cron.schedule('benchmark-matchups', '*/5 * * * *', 'select public.mu_tick()');
  end if;
end $$;

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
        order by e2.date desc limit 8) x))
  from public.mu_events e
  where e.source = p_source and e.date >= current_date - least(greatest(p_days, 7), 180)
$$;
grant execute on function public.matchup_coverage(text, int) to anon, authenticated;
