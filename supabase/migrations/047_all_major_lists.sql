-- Every published list from official majors, not just the top 32 (Oct 2026).
-- Limitless posts far more than 32 lists for a major (Regional Nice: 429 of 2,336 players), so the old
-- top-32 cap made archetype shares reflect only the very top. Standings are now read in full, and this
-- season's events are re-read once to pick up the rest. The request pace is unchanged (6 per 10 minutes,
-- 6-hour pause on a 429): about 3,000 extra lists, roughly 4 days to catch up.
-- "What's winning" now ranks by share of all lists; top 32 / top 8 / wins are kept as their own columns.

create or replace function public.tourney_read(f public.tourney_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_name text; v_kind text; v_id int; v_fmt text; lines jsonb := '[]'; i int := 0; n int := 0;
  v_cards jsonb; v_miss text[]; v_cnt int; v_pr numeric;
begin
  if f.kind = 'index' then
    for ch in select x from regexp_split_to_table(body, '<tr data-date=') x offset 1 loop
      v_name := substring(ch from 'data-name="([^"]+)"');
      v_kind := public.tourney_kind(v_name);
      v_id := substring(ch from 'href="/tournaments/(\d+)"')::int;
      v_fmt := coalesce(substring(ch from 'data-format="([^"]*)"'), '');
      continue when v_kind is null or v_id is null or v_fmt not in ('standard', 'standard-jp');
      insert into public.tournaments (id, name, date, country, players, kind, format)
      values (v_id, replace(v_name, '&amp;', '&'), substring(ch from '^"(\d{4}-\d{2}-\d{2})"')::date,
              coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
              nullif(substring(ch from 'data-players="(\d+)"'), '')::int, v_kind, v_fmt)
      on conflict (id) do update set players = excluded.players;
    end loop;

  elsif f.kind = 'standings' then
    for ch in select x from regexp_split_to_table(body, '<tr data-rank=') x offset 1 loop
      i := substring(ch from '^"(\d+)"')::int;
      exit when i is null or i > 5000;  -- every row Limitless shows; 5000 is only a sanity stop
      insert into public.tournament_decks (tournament_id, place, player, country, archetype, list_id)
      values (f.tournament_id, i,
        replace(coalesce(substring(ch from 'data-name="([^"]*)"'), ''), '&amp;', '&'),
        coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
        replace(coalesce(substring(ch from 'data-deck="([^"]*)"'), ''), '&amp;', '&'),
        substring(ch from 'href="/decks/list/(\d+)"')::int)
      on conflict (tournament_id, place) do update set
        player = excluded.player, country = excluded.country, archetype = excluded.archetype,
        list_id = coalesce(excluded.list_id, tournament_decks.list_id);
      n := n + 1;
    end loop;
    -- Only move on once standings actually had rows; an empty page counts as a try.
    update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1,
      status = case when status = 'new' and n > 0 then 'lists' else status end
      where id = f.tournament_id;

  elsif f.kind = 'list' then
    i := 0;
    for ch in select x from regexp_split_to_table(body, 'class="decklist-card"') x offset 1 loop
      lines := lines || jsonb_build_object('i', i,
        'qty', coalesce(substring(ch from 'class="card-count">\s*(\d+)'), '0')::int,
        'name', replace(replace(trim(coalesce(substring(ch from 'class="card-name">([^<]*)<'), '')), '&amp;', '&'), '&#039;', ''''),
        'code', coalesce(substring(ch from 'data-set="([^"]*)"'), ''),
        'num', coalesce(substring(ch from 'data-number="([^"]*)"'), ''));
      i := i + 1;
    end loop;
    if jsonb_array_length(lines) = 0 then
      update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      return;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('cid', r.card_id, 'qty', (l->>'qty')::int, 'board', 'main', 'name', c.name, 'cat', c.category)) filter (where r.card_id is not null), '[]'),
           coalesce(array_agg(l->>'name') filter (where r.card_id is null), '{}'),
           coalesce(sum((l->>'qty')::int), 0),
           round(coalesce(sum((l->>'qty')::int * coalesce(public.card_price(c.prices), 0)) filter (where r.card_id is not null), 0), 2)
      into v_cards, v_miss, v_cnt, v_pr
      from jsonb_array_elements(lines) l
      join public.resolve_decklist_v2(lines, 'standard', 'exact') r on r.i = (l->>'i')::int
      left join public.cards c on c.id = r.card_id;
    update public.tournament_decks set cards = v_cards, missing = v_miss, card_count = v_cnt, price = v_pr, fetched_at = now(), attempts = attempts + 1
      where tournament_id = f.tournament_id and place = f.place;
    perform public.tourney_set_non_us(f.tournament_id);
  end if;
end $$;
revoke execute on function public.tourney_read(public.tourney_fetch, text) from public, anon, authenticated;

-- Meta: share of all lists (archetype comes with the standings, so shares are right as soon as standings
-- are read, before each list is fetched), plus top 32 / top 8 / wins as before.
drop function if exists public.tourney_meta(int);
create function public.tourney_meta(days int default 60)
returns table (archetype text, lists bigint, share numeric, top32 bigint, top8 bigint, wins bigint, events bigint, best_tournament int, best_place int)
language sql stable set search_path = public as $$
  with d as (
    select d.*, t.date from public.tournament_decks d join public.tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(days, 7), 400) and d.archetype <> ''
  ), best as (
    select distinct on (archetype) archetype, tournament_id, place from d
    where cards is not null order by archetype, place, date desc
  )
  select d.archetype, count(*), round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1),
         count(*) filter (where d.place <= 32), count(*) filter (where d.place <= 8), count(*) filter (where d.place = 1),
         count(distinct d.tournament_id), b.tournament_id, b.place
  from d left join best b using (archetype)
  group by d.archetype, b.tournament_id, b.place
  order by count(*) desc, count(*) filter (where d.place <= 8) desc
$$;
grant execute on function public.tourney_meta(int) to anon, authenticated;

-- Re-read this season's standings once to pick up places past 32. Existing rows and fetched lists are kept.
update public.tournaments set status = 'new', standings_tries = 0, standings_at = null
 where date >= public.season_start() and status = 'done';
