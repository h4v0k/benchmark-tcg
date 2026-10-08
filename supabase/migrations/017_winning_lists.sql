-- Winning lists: keep the top 16 decklists from each online event with their records, so a deck's page can
-- show the winningest list and other strong ones. (Official events publish lists per player on separate pages;
-- those may come later.)

create table if not exists public.mu_lists (
  id bigserial unique,
  source text not null,
  event_id text not null,
  player text not null,               -- Limitless username (key only; the page shows `name`)
  name text not null default '',
  deck text not null,
  place int,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  list text not null,                 -- one card per line: "4 Iono PAL 185"
  primary key (source, event_id, player),
  foreign key (source, event_id) references public.mu_events(source, event_id) on delete cascade
);
create index if not exists mu_lists_deck on public.mu_lists (deck, source);
alter table public.mu_lists enable row level security;
revoke all on public.mu_lists from anon, authenticated;

-- Limitless decklist JSON ({pokemon:[{count,name,set,number}], trainer:[...], energy:[...]}) to plain text.
create or replace function public.mu_list_text(d jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(
           (card->>'count') || ' ' || btrim(card->>'name') || coalesce(' ' || nullif(btrim(card->>'set'), '') || ' ' || nullif(btrim(card->>'number'), ''), ''),
           E'\n' order by s.ord, t.ord), '')
  from (values ('pokemon', 1), ('trainer', 2), ('energy', 3)) s(sec, ord),
       lateral jsonb_array_elements(case when jsonb_typeof(d -> s.sec) = 'array' then d -> s.sec else '[]'::jsonb end) with ordinality t(card, ord)
  where coalesce(card->>'count', '') ~ '^\d{1,2}$' and coalesce(btrim(card->>'name'), '') <> '' and length(card->>'name') <= 80
$$;
revoke execute on function public.mu_list_text(jsonb) from public, anon, authenticated;

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

-- A deck's lists, best record first (win rate with ties as a third of a win, then more wins, bigger event,
-- better finish). Only finished events, at least 5 games played.
create or replace function public.deck_lists(p_deck text, p_days int default 30, p_limit int default 25)
returns table (id bigint, event_name text, date date, event_players int, player text, place int,
               wins int, losses int, ties int, win_pct numeric)
language sql stable security definer set search_path = public as $$
  select l.id, e.name, e.date, e.players, l.name, l.place, l.wins, l.losses, l.ties,
         round(100.0 * (3 * l.wins + l.ties) / nullif(3 * (l.wins + l.losses + l.ties), 0), 1)
  from public.mu_lists l
  join public.mu_events e on e.source = l.source and e.event_id = l.event_id
  where l.deck = p_deck and e.status = 'done' and e.date >= current_date - least(greatest(p_days, 7), 180)
    and l.wins + l.losses + l.ties >= 5
  order by (3 * l.wins + l.ties)::numeric / nullif(3 * (l.wins + l.losses + l.ties), 0) desc nulls last,
           l.wins desc, e.players desc nulls last, l.place, e.date desc
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.deck_lists(text, int, int) to anon, authenticated;

-- One list's cards. (The output columns changed while this was written, so drop any older version first.)
drop function if exists public.deck_list(bigint);
create or replace function public.deck_list(p_id bigint)
returns table (id bigint, deck text, event_id text, event_name text, date date, event_players int, player text, place int,
               wins int, losses int, ties int, list text)
language sql stable security definer set search_path = public as $$
  select l.id, l.deck, l.event_id, e.name, e.date, e.players, l.name, l.place, l.wins, l.losses, l.ties, l.list
  from public.mu_lists l join public.mu_events e on e.source = l.source and e.event_id = l.event_id
  where l.id = p_id and e.status = 'done'
$$;
grant execute on function public.deck_list(bigint) to anon, authenticated;

-- Online events already read before lists were kept: read them once more so their lists are captured too.
-- (Their match results are recounted the same way; nothing is lost.)
update public.mu_events e set status = 'new', tries = 0, next_at = null
 where e.source = 'online' and e.status in ('standings', 'done')
   and not exists (select 1 from public.mu_lists l where l.source = e.source and l.event_id = e.event_id)
   and not exists (select 1 from public.app_settings where key = 'mu_lists_backfilled');
insert into public.app_settings (key, value) values ('mu_lists_backfilled', now()::text) on conflict (key) do nothing;
