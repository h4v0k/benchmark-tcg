-- Live standings for official events (Regionals, Internationals, Worlds) while they're being played.
--
-- Limitless Labs posts each round's pairings and the standings while an event runs. Until now only
-- finished events were read. Now:
--   * The Labs event list is checked every hour on event weekends (Fri-Mon UTC) or while an event is live;
--     otherwise it's still read once a day.
--   * A live event (status 'live') gets its info and standings read once an hour, plus any rounds that have
--     finished since the last check (at most 4 per hour), so matchup data fills in as the event goes.
--     That's about 3-6 small requests an hour, only while an event is on.
--   * When Labs marks it finished, it goes back to the normal pipeline, which reads the remaining rounds.
--   * The Tournaments page shows live events with the round, standings and when they were last updated.
--   * Every pause Limitless asks for (429 back-off) still applies.

alter table public.mu_events drop constraint if exists mu_events_status_check;
alter table public.mu_events add constraint mu_events_status_check
  check (status in ('new', 'standings', 'rounds', 'done', 'skip', 'live'));
alter table public.mu_events
  add column if not exists city text not null default '',
  add column if not exists country text not null default '',
  add column if not exists kind text not null default '',
  add column if not exists live_round int,
  add column if not exists total_rounds int,
  add column if not exists labs_updated_at timestamptz,
  add column if not exists live_checked_at timestamptz,
  add column if not exists finished_at timestamptz;

alter table public.mu_fetch drop constraint if exists mu_fetch_kind_check;
alter table public.mu_fetch add constraint mu_fetch_kind_check check (kind in
  ('online_index', 'online_standings', 'online_pairings', 'official_index', 'official_info', 'official_round', 'live_info', 'live_standings'));

-- Latest standings of a live (or just finished) official event, Masters division.
create table if not exists public.live_standings (
  event_id text not null,
  pos int not null,
  placement int,
  name text not null default '',
  country text not null default '',
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points int not null default 0,
  deck text not null default '',
  deck_name text not null default '',
  dropped boolean not null default false,
  day2 boolean not null default false,
  topcut boolean not null default false,
  primary key (event_id, pos)
);
alter table public.live_standings enable row level security;
revoke all on public.live_standings from anon, authenticated;

create or replace function public.mu_read(f public.mu_fetch, body text) returns void
language plpgsql security definer set search_path = public as $$
declare j jsonb := body::jsonb; e jsonb; ev public.mu_events; res text; w text; is_live boolean;
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
    -- keep the top 16 decklists (as plain text, the format Pokémon TCG Live and Limitless export) with each record
    delete from public.mu_lists where source = 'online' and event_id = f.event_id;
    insert into public.mu_lists (source, event_id, player, name, deck, place, wins, losses, ties, list)
    select 'online', f.event_id, x->>'player', left(coalesce(nullif(x->>'name', ''), x->>'player'), 60), x->'deck'->>'id',
           (x->>'placing')::int, coalesce((x->'record'->>'wins')::int, 0), coalesce((x->'record'->>'losses')::int, 0),
           coalesce((x->'record'->>'ties')::int, 0), public.mu_list_text(x->'decklist')
    from jsonb_array_elements(j) x
    where public.mu_slug_ok(x->'deck'->>'id') and x->>'player' is not null
      and coalesce(x->>'placing', '') ~ '^\d{1,5}$' and (x->>'placing')::int <= 16
      and public.mu_list_text(x->'decklist') <> ''
    on conflict do nothing;
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
        if coalesce(e->>'id', '') ~ '^\d{1,6}$' and e->>'type' in ('regional', 'international', 'worlds') then
          is_live := e->>'started' in ('1', 'true') and e->>'completed' not in ('1', 'true');
          if (e->>'completed' in ('1', 'true') and (e->>'utc_start')::timestamp >= now() - interval '180 days')
             or (is_live and (e->>'utc_start')::timestamp >= now() - interval '5 days') then
            insert into public.mu_events as m (source, event_id, name, date, status, city, country, kind)
            values ('official', lpad(e->>'id', 4, '0'),
              case e->>'type' when 'worlds' then 'World Championship' when 'international' then 'International Championship'
                   else 'Regional Championship' end || ' ' || coalesce(e->>'city', ''),
              (e->>'utc_start')::timestamp::date, case when is_live then 'live' else 'new' end,
              left(coalesce(e->>'city', ''), 80), left(coalesce(e->>'country', ''), 8), e->>'type')
            on conflict (source, event_id) do update set
              city = excluded.city, country = excluded.country, kind = excluded.kind,
              status = case
                when is_live and m.status not in ('done', 'live') then 'live'           -- started since we saw it
                when not is_live and m.status = 'live' then 'new'                         -- finished: normal pipeline reads the rest
                when m.status = 'skip' and not m.revived and not is_live then 'new'
                else m.status end,
              finished_at = case when not is_live and m.status = 'live' then now() else m.finished_at end,
              next_at = case when not is_live and m.status = 'live' then null else m.next_at end,
              tries = case when (m.status = 'skip' and not m.revived) or (not is_live and m.status = 'live') then 0 else m.tries end,
              done_at = case when m.status = 'skip' and not m.revived and not is_live then null else m.done_at end,
              rounds_done = case when m.status = 'skip' and not m.revived and not is_live then '{}' else m.rounds_done end,
              revived = m.revived or (m.status = 'skip' and not is_live);
          end if;
        end if;
      exception when others then continue;
      end;
    end loop;

  elsif f.kind = 'official_info' then
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'object' then raise exception 'official_info: bad response'; end if;
    update public.mu_events set players = (j->'message'->>'players')::int, rounds = (j->'message'->>'round')::int,
      status = case when coalesce((j->'message'->>'round')::int, 0) > 0 then 'rounds' else 'skip' end
    where source = 'official' and event_id = f.event_id and status <> 'live';

  elsif f.kind = 'live_info' then
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'object' then raise exception 'live_info: bad response'; end if;
    update public.mu_events set
      players = coalesce((j->'message'->>'players')::int, players),
      live_round = (j->'message'->>'round')::int,
      total_rounds = (j->'message'->>'rounds')::int,
      labs_updated_at = case when coalesce(j->'message'->>'updated_at', '') ~ '^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$'
                             then (j->'message'->>'updated_at')::timestamp at time zone 'UTC' else labs_updated_at end,
      live_checked_at = now(),
      -- finished: hand it back to the normal pipeline, which reads the final round count and the rest of the rounds
      status = case when j->'message'->>'completed' in ('1', 'true') then 'new' else status end,
      finished_at = case when j->'message'->>'completed' in ('1', 'true') then now() else finished_at end,
      next_at = case when j->'message'->>'completed' in ('1', 'true') then null else next_at end,
      tries = 0
    where source = 'official' and event_id = f.event_id and status = 'live';

  elsif f.kind = 'live_standings' then
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'array' then raise exception 'live_standings: bad response'; end if;
    if jsonb_array_length(j->'message') = 0 then return; end if;  -- nothing posted yet: keep what we had
    delete from public.live_standings where event_id = f.event_id;
    insert into public.live_standings (event_id, pos, placement, name, country, wins, losses, ties, points, deck, deck_name, dropped, day2, topcut)
    select f.event_id, x.n::int,
      case when coalesce(x.e->>'placement', '') ~ '^\d{1,6}$' then (x.e->>'placement')::int end,
      left(coalesce(x.e->>'name', ''), 80), left(coalesce(x.e->>'country', ''), 8),
      case when coalesce(x.e->>'wins', '') ~ '^\d{1,3}$' then (x.e->>'wins')::int else 0 end,
      case when coalesce(x.e->>'losses', '') ~ '^\d{1,3}$' then (x.e->>'losses')::int else 0 end,
      case when coalesce(x.e->>'ties', '') ~ '^\d{1,3}$' then (x.e->>'ties')::int else 0 end,
      case when coalesce(x.e->>'points', '') ~ '^\d{1,4}$' then (x.e->>'points')::int else 0 end,
      case when public.mu_slug_ok(x.e->>'deck_id') then x.e->>'deck_id' else '' end,
      left(coalesce(x.e->>'deck_name', ''), 80),
      coalesce(x.e->>'dropped', '0') in ('1', 'true'), coalesce(x.e->>'day2', '0') in ('1', 'true'), coalesce(x.e->>'topcut', '0') in ('1', 'true')
    from jsonb_array_elements(j->'message') with ordinality as x(e, n)
    where x.n <= 5000;
    update public.mu_events set live_checked_at = now() where source = 'official' and event_id = f.event_id;

  elsif f.kind = 'official_round' then
    select * into ev from public.mu_events where source = 'official' and event_id = f.event_id;
    if ev.status not in ('rounds', 'live') or f.round = any(ev.rounds_done) then return; end if;  -- already counted
    if j->>'ok' is distinct from 'true' or jsonb_typeof(j->'message') is distinct from 'array' then raise exception 'official_round: bad response'; end if;
    -- during the event, only count a round once every match in it has a result
    if ev.status = 'live' and (jsonb_array_length(j->'message') = 0 or exists (
         select 1 from jsonb_array_elements(j->'message') x where x->>'player2' is not null and coalesce(x->>'completed', '1') <> '1')) then
      raise exception 'official_round: round still being played' using errcode = 'MU001';
    end if;
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
      status = case when status = 'rounds' and cardinality(rounds_done) + 1 >= coalesce(rounds, 0) then 'done' else status end,
      done_at = case when status = 'rounds' and cardinality(rounds_done) + 1 >= coalesce(rounds, 0) then now() else done_at end
    where source = 'official' and event_id = f.event_id;
  end if;
end $$;
revoke execute on function public.mu_read(public.mu_fetch, text) from public, anon, authenticated;

-- Hourly: find events that just started, and read live events' info, standings and newly finished rounds.
create or replace function public.live_tick() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare ev public.mu_events; last_at timestamptz; sent int := 0; rnd int; per_ev int;
begin
  if not pg_try_advisory_xact_lock(hashtext('benchmark_mu_tick')) then return jsonb_build_object('busy', true); end if;
  if public.mu_ts((select value from public.app_settings where key = 'mu_backoff_until')) > now() then
    return jsonb_build_object('backoff_until', (select value from public.app_settings where key = 'mu_backoff_until'));
  end if;
  -- the previous hour's requests are read by the read job; don't stack new ones on top of unread ones
  if exists (select 1 from public.mu_fetch where handled_at is null and kind in ('live_info', 'live_standings', 'official_index')
             and created_at > now() - interval '50 minutes') then
    return jsonb_build_object('waiting', true);
  end if;

  -- an event Labs never marks finished stops being treated as live after 5 days
  update public.mu_events set status = 'new', next_at = null, tries = 0, finished_at = now()
   where status = 'live' and date < current_date - 5;
  -- live events don't run out of tries while they're being played
  update public.mu_events set tries = 0 where status = 'live';
  -- keep finished events' last standings for 3 days, then drop them
  delete from public.live_standings s using public.mu_events e
   where e.source = 'official' and e.event_id = s.event_id and e.status <> 'live' and e.finished_at < now() - interval '3 days';
  delete from public.live_standings s where not exists (select 1 from public.mu_events e where e.source = 'official' and e.event_id = s.event_id);

  -- the event list: hourly on event weekends (Fri-Mon UTC) or while anything is live
  if extract(isodow from now() at time zone 'UTC') in (1, 5, 6, 7)
     or exists (select 1 from public.mu_events where status = 'live') then
    last_at := public.mu_ts((select value from public.app_settings where key = 'mu_official_index_at'));
    if last_at < now() - interval '50 minutes' then
      perform public.mu_get('official_index', 'https://mew.limitlesstcg.com/labs/data/tcg/tournaments');
      insert into public.app_settings (key, value) values ('mu_official_index_at', now()::text) on conflict (key) do update set value = excluded.value;
      sent := sent + 1;
    end if;
  end if;

  for ev in select * from public.mu_events where source = 'official' and status = 'live' order by date desc limit 3 loop
    perform public.mu_get('live_info', 'https://mew.limitlesstcg.com/labs/data/tcg/tournament?id=' || ev.event_id || '&division=MA', ev.event_id);
    perform public.mu_get('live_standings', 'https://mew.limitlesstcg.com/labs/data/tcg/standings?tournamentId=' || ev.event_id || '&division=MA', ev.event_id);
    sent := sent + 2;
    -- rounds before the current one are finished; read up to 4 new ones an hour
    per_ev := 0;
    for rnd in 1..greatest(coalesce(ev.live_round, 0) - 1, 0) loop
      continue when rnd = any(ev.rounds_done);
      exit when per_ev >= 4;
      perform public.mu_get('official_round', 'https://mew.limitlesstcg.com/labs/data/tcg/pairings?tournamentId=' || ev.event_id
        || '&division=MA&round=' || rnd, ev.event_id, rnd);
      per_ev := per_ev + 1;
    end loop;
    sent := sent + per_ev;
  end loop;
  return jsonb_build_object('sent', sent);
end $$;
revoke execute on function public.live_tick() from public, anon, authenticated;

-- For the Tournaments page: live events, and ones that finished in the last 3 days, with the top of the standings.
create or replace function public.live_events(p_top int default 8) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'date' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', e.event_id, 'name', e.name, 'city', e.city, 'country', e.country, 'kind', e.kind, 'date', e.date,
      'live', e.status = 'live', 'players', e.players, 'round', e.live_round, 'rounds', e.total_rounds,
      'updated_at', e.labs_updated_at, 'checked_at', e.live_checked_at, 'finished_at', e.finished_at,
      'standings', coalesce((select jsonb_agg(to_jsonb(s) - 'event_id' order by s.pos) from (
          select * from public.live_standings s where s.event_id = e.event_id order by s.pos limit least(greatest(p_top, 1), 64)) s), '[]'::jsonb)) as x
    from public.mu_events e
    where e.source = 'official' and exists (select 1 from public.live_standings s where s.event_id = e.event_id)
      and (e.status = 'live' or e.finished_at >= now() - interval '3 days')
  ) q
$$;
create or replace function public.live_event(p_id text, p_limit int default 256, p_offset int default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.event_id, 'name', e.name, 'city', e.city, 'country', e.country, 'kind', e.kind, 'date', e.date,
    'live', e.status = 'live', 'players', e.players, 'round', e.live_round, 'rounds', e.total_rounds,
    'updated_at', e.labs_updated_at, 'checked_at', e.live_checked_at, 'finished_at', e.finished_at,
    'total', (select count(*) from public.live_standings s where s.event_id = e.event_id),
    'standings', coalesce((select jsonb_agg(to_jsonb(s) - 'event_id' order by s.pos) from (
        select * from public.live_standings s where s.event_id = e.event_id order by s.pos
        limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) s), '[]'::jsonb))
  from public.mu_events e
  where e.source = 'official' and e.event_id = p_id and exists (select 1 from public.live_standings s where s.event_id = e.event_id)
$$;
grant execute on function public.live_events(int) to anon, authenticated;
grant execute on function public.live_event(text, int, int) to anon, authenticated;

-- Send at :41, read the answers at :46 (the 6-hourly jobs at :17/:22 are unchanged).
select cron.schedule('benchmark-live', '41 * * * *', 'select public.live_tick()');
select cron.schedule('benchmark-live-read', '46 * * * *', 'select public.mu_tick(0, false)');
