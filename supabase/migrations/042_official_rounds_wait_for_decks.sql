-- Official rounds read before Limitless revealed decks added nothing but were marked as read (Nice, Oct 2026).
-- Now such rounds wait for the decks, and events that were affected get their rounds read again.
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
    -- Limitless reveals decks only after the event (or late in it). A round whose pairings carry no decks at all
    -- would add nothing and be marked as read for good, so wait for the decks instead: try again later (not a failure).
    -- After a week, count it as it is so a deckless event can't wait forever.
    if not exists (select 1 from jsonb_array_elements(j->'message') x where coalesce(x->>'p1_deck', '') <> '' or coalesce(x->>'p2_deck', '') <> '')
       and (ev.status = 'live' or coalesce(ev.finished_at, ev.date::timestamptz) > now() - interval '7 days') then
      raise exception 'official_round: decks not revealed yet' using errcode = 'MU001';
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

update public.mu_events e set rounds_done = '{}', next_at = null
 where e.source = 'official' and cardinality(e.rounds_done) > 0 and e.status in ('live', 'rounds', 'new')
   and not exists (select 1 from public.mu_results r where r.source = 'official' and r.event_id = e.event_id);
