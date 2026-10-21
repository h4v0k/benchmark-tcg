-- The Tournaments page drops a finished event's live card once its final lists are posted (Oct 2026).
-- The card stayed for 3 days after an event ended, so once Limitless posted the top 32 the page showed the
-- same event twice: the real lists below, and above them a live card saying "final lists post soon" with
-- "Deck not listed yet" on every row. A finished event now leaves the card as soon as its tournament has
-- lists (matched by country and date, as tourney_awaiting does). Live events and the standings page are unchanged.
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
      and (e.status = 'live'
           or (e.finished_at >= now() - interval '3 days'
               and not exists (select 1 from public.tournaments t
                                where t.country = e.country and t.date between e.date - 1 and e.date + 2
                                  and exists (select 1 from public.tournament_decks d where d.tournament_id = t.id and d.cards is not null))))
  ) q
$$;
grant execute on function public.live_events(int) to anon, authenticated;
