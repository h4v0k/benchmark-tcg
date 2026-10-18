-- Live events: also count the current round once all its matches have results (e.g. after Day 1 ends).
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
    -- read up to 4 new rounds an hour, including the current one: overnight (or during a break) the current round
    -- is finished but the next hasn't started. A round still being played is skipped (mu_read raises MU001).
    per_ev := 0;
    for rnd in 1..greatest(coalesce(ev.live_round, 0), 0) loop
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
