-- Finished official events reach the Tournaments page sooner (Oct 2026).
-- Limitless posts an event's results a few days after it ends, and the tournament list was only read
-- once a day, so a posted event could wait up to another day. While an official event that finished in
-- the last 10 days (known from the live feed) isn't on the list yet, the list is now read every 3 hours.
-- That's at most ~7 extra small requests a day, only in the days after an event.

-- Official events from the live feed that finished recently and aren't in tournaments yet.
create or replace function public.tourney_awaiting() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.mu_events e
   where e.source = 'official' and e.status <> 'live'
     and e.finished_at >= now() - interval '10 days'
     and not exists (select 1 from public.tournaments t
                      where t.country = e.country and t.date between e.date - 1 and e.date + 2)
$$;
revoke execute on function public.tourney_awaiting() from public, anon, authenticated;

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

  -- 2. the tournament list, once a day; every 3 hours while an official event that finished in the last
  --    10 days (from the live feed) hasn't been posted yet (matched by country and date)
  select value::timestamptz into last_index from public.app_settings where key = 'tourney_index_at';
  if last_index is null or last_index < now() - interval '23 hours'
     or (last_index < now() - interval '3 hours' and public.tourney_awaiting() > 0) then
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
