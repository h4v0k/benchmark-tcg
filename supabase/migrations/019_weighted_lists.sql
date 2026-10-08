-- Winning lists: include major official events (Regionals, Internationals, Worlds) next to online events,
-- and rank by how strong the finish was rather than by raw record, so a deck that went deep in a big,
-- strong field ranks above one that won a small online event.
--
-- score = event weight × log2(players ÷ place)
--   log2(players ÷ place) is roughly how many times the field was halved while the player stayed in it
--   weights: Worlds 1.5, International 1.3, Regional 1.0, online 0.5 (open entry, smaller and uneven fields)
-- So 1st of 3,000 at a Regional ≈ 11.6, 1st of 100 online ≈ 3.3, 32nd of 800 at Worlds ≈ 7.0.

create or replace function public.list_score(p_tier text, p_players int, p_place int)
returns numeric language sql immutable set search_path = public as $$
  select round((case p_tier when 'worlds' then 1.5 when 'international' then 1.3 when 'regional' then 1.0 else 0.5 end)
    * log(2::numeric, greatest(coalesce(p_players, 0), coalesce(p_place, 1), 1)::numeric / greatest(coalesce(p_place, 1), 1)), 2)
$$;

drop function if exists public.deck_lists(text, int, int);
create function public.deck_lists(p_deck text, p_days int default 60, p_limit int default 25)
returns table (key text, tier text, event_name text, date date, event_players int, player text, place int,
               wins int, losses int, ties int, score numeric, id bigint)
language sql stable security definer set search_path = public as $$
  with since as (select current_date - least(greatest(p_days, 7), 180) as day0),
  nm as (select lower(a.name) as n from public.archetypes a where a.slug = p_deck),
  r as (
    select 'o' || l.id as key, 'online'::text as tier, e.name as event_name, e.date, e.players as event_players,
           l.name as player, l.place, l.wins, l.losses, l.ties,
           public.list_score('online', coalesce(e.players, 32), coalesce(l.place, 16)) as score,
           (3 * l.wins + l.ties)::numeric / nullif(3 * (l.wins + l.losses + l.ties), 0) as pct, l.id
    from public.mu_lists l
    join public.mu_events e on e.source = l.source and e.event_id = l.event_id
    where l.deck = p_deck and e.status = 'done' and e.date >= (select day0 from since)
      and l.wins + l.losses + l.ties >= 5
    union all
    select 't' || t.id || '-' || d.place, t.kind, t.name, t.date, t.players,
           d.player, d.place, null::int, null::int, null::int,
           public.list_score(t.kind, t.players, d.place), null::numeric, null::bigint
    from public.tournament_decks d
    join public.tournaments t on t.id = d.tournament_id
    where lower(d.archetype) = (select n from nm) and d.cards is not null and t.date >= (select day0 from since)
  )
  select r.key, r.tier, r.event_name, r.date, r.event_players, r.player, r.place, r.wins, r.losses, r.ties, r.score, r.id
  from r
  order by r.score desc, r.pct desc nulls last, r.date desc, r.key
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.deck_lists(text, int, int) to anon, authenticated;

-- (id: the old list number, only so pages opened before this update keep working; remove with the forwarder below.)

-- One list. Online lists come back as text (list); official lists come back already matched to cards (cards).
drop function if exists public.deck_list(bigint); -- recreated below as a forwarder
drop function if exists public.deck_list(text);
create function public.deck_list(p_key text)
returns table (key text, tier text, deck text, event_id text, event_name text, date date, event_players int, player text, place int,
               wins int, losses int, ties int, list text, cards jsonb, missing text[], list_id int)
language plpgsql stable security definer set search_path = public as $$
declare m text[];
begin
  if p_key ~ '^o[0-9]{1,18}$' then
    return query
    select 'o' || l.id, 'online'::text, l.deck, l.event_id, e.name, e.date, e.players, l.name, l.place, l.wins, l.losses, l.ties,
           l.list, null::jsonb, '{}'::text[], null::int
    from public.mu_lists l join public.mu_events e on e.source = l.source and e.event_id = l.event_id
    where l.id = substr(p_key, 2)::bigint and e.status = 'done';
  elsif p_key ~ '^t[0-9]{1,9}-[0-9]{1,4}$' then
    m := regexp_match(p_key, '^t([0-9]+)-([0-9]+)$');
    return query
    select 't' || t.id || '-' || d.place, t.kind, a.slug, t.id::text, t.name, t.date, t.players, d.player, d.place,
           null::int, null::int, null::int, null::text, d.cards, d.missing, d.list_id
    from public.tournament_decks d join public.tournaments t on t.id = d.tournament_id
    left join lateral (select x.slug from public.archetypes x where lower(x.name) = lower(d.archetype) limit 1) a on true
    where d.tournament_id = m[1]::int and d.place = m[2]::int and d.cards is not null;
  end if;
end $$;
grant execute on function public.deck_list(text) to anon, authenticated;

-- Pages opened before this update still ask for a list by number: answer them for now (remove in a later release).
create or replace function public.deck_list(p_id bigint)
returns table (key text, tier text, deck text, event_id text, event_name text, date date, event_players int, player text, place int,
               wins int, losses int, ties int, list text, cards jsonb, missing text[], list_id int)
language sql stable security definer set search_path = public as $$
  select * from public.deck_list('o' || p_id::text)
$$;
grant execute on function public.deck_list(bigint) to anon, authenticated;
