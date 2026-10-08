-- Catch-up mode for the first load, plus a per-event retry delay.
--
-- 1. Each event now has next_at: after a failure it isn't asked again for 3 hours, and while it's still running
--    for 5 hours. That keeps retries polite however often the collector runs.
-- 2. While the first 60 days (online) / 180 days (official) are loading, an extra job runs every 5 minutes with a
--    small batch (10 requests, at most 4 to the Labs site). It still honours every pause Limitless asks for
--    (429s stop it the same way). It switches itself off once nothing is left to load, or after 3 days at most.
--    After that only the regular 6-hour jobs run.

alter table public.mu_events add column if not exists next_at timestamptz;
create index if not exists mu_events_next on public.mu_events (next_at) where status not in ('done', 'skip');

create or replace function public.mu_tick(budget int default 20, p_send boolean default true, site_cap int default 8) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.mu_fetch; resp record; sent int := 0; ev_sent int := 0; labs_sent int := 0; ev public.mu_events;
  last_at timestamptz; pages int; ok boolean; rnd int; failed text[] := '{}'; worked text[] := '{}'; k text;
  pause interval; retry_after int; streak int; saw429 boolean := false; max_retry int; src text; not_yet boolean;
  ok_src text[] := '{}'; down_src text[] := '{}'; heard_src text[] := '{}'; waiting text[] := '{}';   -- which sites ('online' = Play API, 'official' = Labs) answered well / were down this run
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
    elsif f.event_id is not null then
      waiting := waiting || (src || ':' || f.event_id);  -- still running
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
  -- each event waits before it's asked again: 3 hours after a failure, 5 hours while it's still running.
  -- (Keeps retries polite however often this runs, and stops a burst of quick runs from using up an event's tries.)
  update public.mu_events set next_at = now() + interval '3 hours' where source || ':' || event_id = any(failed);
  update public.mu_events set next_at = now() + interval '5 hours' where source || ':' || event_id = any(waiting);
  update public.mu_events set next_at = null
   where source || ':' || event_id = any(worked) and not (source || ':' || event_id = any(failed)) and next_at is not null;

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
              and coalesce(next_at, '-infinity') <= now()
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
revoke execute on function public.mu_tick(int, boolean, int) from public, anon, authenticated;

create or replace function public.mu_backfill_tick(budget int default 10, site_cap int default 4) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare started timestamptz;
begin
  insert into public.app_settings (key, value) values ('mu_backfill_started', now()::text) on conflict (key) do nothing;
  started := public.mu_ts((select value from public.app_settings where key = 'mu_backfill_started'));

  -- caught up: all four list pages read, official events listed, and nothing left that could be fetched right now
  if (now() > started + interval '3 days')
     or ((select count(*) from public.app_settings where key like 'mu_backfill_page_%') = 4
         and exists (select 1 from public.mu_events where source = 'official')
         and not exists (select 1 from public.mu_fetch where handled_at is null)
         and not exists (select 1 from public.mu_events
                          where status not in ('done', 'skip')
                            and (source = 'official' or coalesce(starts_at, date::timestamptz) <= now() - interval '24 hours')
                            and coalesce(next_at, '-infinity') <= now())) then
    insert into public.app_settings (key, value) values ('mu_backfill_done', now()::text) on conflict (key) do nothing;
    if exists (select 1 from cron.job where jobname = 'benchmark-matchups-backfill') then
      perform cron.unschedule('benchmark-matchups-backfill');
    end if;
    return jsonb_build_object('backfill', 'done');
  end if;

  return public.mu_tick(budget, true, site_cap);
end $$;
revoke execute on function public.mu_backfill_tick(int, int) from public, anon, authenticated;

-- start catch-up mode once (not again after it has finished)
do $$ begin
  if not exists (select 1 from public.app_settings where key = 'mu_backfill_done') then
    perform cron.schedule('benchmark-matchups-backfill', '*/5 * * * *', 'select public.mu_backfill_tick()');
  end if;
end $$;
