-- Pages built before 019 call deck_lists without knowing about official (major) lists, and show their rows
-- as "null-null-null" with nothing selected. Keep the old online-only answer for them; the current page asks
-- for majors explicitly with p_majors => true. Ranking is the same as 019.
drop function if exists public.deck_lists(text, int, int);
drop function if exists public.deck_lists(text, int, int, boolean);
create function public.deck_lists(p_deck text, p_days int default 60, p_limit int default 25, p_majors boolean default false)
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
    where p_majors and lower(d.archetype) = (select n from nm) and d.cards is not null and t.date >= (select day0 from since)
  )
  select r.key, r.tier, r.event_name, r.date, r.event_players, r.player, r.place, r.wins, r.losses, r.ties, r.score, r.id
  from r
  order by r.score desc, r.pct desc nulls last, r.date desc, r.key
  limit least(greatest(p_limit, 1), 50)
$$;
grant execute on function public.deck_lists(text, int, int, boolean) to anon, authenticated;
