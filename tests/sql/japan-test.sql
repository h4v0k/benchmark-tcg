-- Japan preview (022): parsing of City League / major pages, preview-set flags, the request budget,
-- and that nothing from Japan reaches the Standard views. Fixtures follow the real Limitless markup (Oct 2026).
\set QUIET 1
\o /dev/null
drop schema if exists jt cascade;
create schema jt;
create function jt.check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  raise notice '% | % %', case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_name,
    case when coalesce(p_ok, false) then '' else '-- ' || p_detail end;
end $$;
create function jt.eq(p_name text, actual text, expected text) returns void language sql as $$
  select jt.check(p_name, actual is not distinct from expected, 'observed=[' || coalesce(actual, 'NULL') || '] expected=[' || coalesce(expected, 'NULL') || ']')
$$;
-- answer every request sent so far with the fixture whose pattern matches its URL
create table jt.fx (pattern text, body text);
create function jt.answer() returns void language sql as $$
  insert into net._http_response (id, status_code, content)
  select s.id, 200, (select f.body from jt.fx f where s.url like f.pattern order by length(f.pattern) desc limit 1)
  from net.sent s where not exists (select 1 from net._http_response r where r.id = s.id)
$$;
\o

-- catalog: two legal cards, archetype with icons
insert into public.sets (id, name, code, release_date, legal_date, reg_mark) values
  ('sv9', 'Journey Together', 'JTG', '2025-03-28', '2025-04-11', 'I'),
  ('me01', 'Mega Evolution', 'MEG', '2025-09-26', '2025-10-10', 'I') on conflict do nothing;
insert into public.cards (id, set_id, local_id, num_key, name, name_norm, category, legal_standard) values
  ('sv9-098', 'sv9', '098', '98', 'N''s Zoroark ex', public.norm_name('N''s Zoroark ex'), 'Pokemon', true),
  ('me01-131', 'me01', '131', '131', 'Ultra Ball', 'ultra ball', 'Trainer', true) on conflict do nothing;
insert into public.archetypes (slug, name, icons) values ('n-zoroark', 'N''s Zoroark', '{zoroark}') on conflict (slug) do update set icons = excluded.icons;

insert into jt.fx values
('https://limitlesstcg.com/tournaments/jp?show=100%', $h$<table class="data-table striped completed-tournaments">
 <tr><th>Date</th></tr>
 <tr data-date="DATE1" data-city="Kanagawa" data-shop="【CARDBOX】青馬堂矢向店" data-winner="zoroark">
   <td><a href="https://limitlesstcg.com/tournaments/jp/5063">13 Oct 26</a></td></tr>
 <tr data-date="DATE1" data-city="&Omicron;saka" data-shop="Shop &amp; Co" data-winner="rayquaza-mega">
   <td><a href="https://limitlesstcg.com/tournaments/jp/5071">14 Oct 26</a></td></tr>
</table>$h$),
('https://limitlesstcg.com/tournaments/jp/5063', $h$<h1>City League</h1><table class="data-table striped">
 <tr><th>#</th><th>Player</th><th>Deck</th><th>List</th></tr>
 <tr>
  <td>1</td>
  <td><a href="/players/jp/0036111619">セリヌンティウス</a></td>
  <td><a href="https://limitlesstcg.com/decks/list/jp/75534"><span><img class="pokemon" src="https://r2.limitlesstcg.net/pokemon/gen9/zoroark.png" alt="zoroark"></span></a></td>
  <td><a href="https://limitlesstcg.com/decks/list/jp/75534"><i></i></a></td>
 </tr>
 <tr>
  <td>2</td>
  <td><a href="/players/jp/0076346680">ゆうさく</a></td>
  <td><a href="https://limitlesstcg.com/decks/list/jp/75535"><span><img class="pokemon" src="x" alt="rayquaza-mega"><img class="pokemon" src="y" alt="talonflame"></span></a></td>
  <td><a href="https://limitlesstcg.com/decks/list/jp/75535"><i></i></a></td>
 </tr>
 <tr>
  <td>9</td><td><a href="/players/jp/1">nine</a></td><td></td><td></td>
 </tr>
</table>$h$),
('https://limitlesstcg.com/tournaments/jp/5071', '<table class="data-table striped"><tr><th>#</th></tr></table>'),
('https://limitlesstcg.com/decks/list/jp/75534', $h$<div class="decklist-column-heading">Pokémon (4)</div>
 <div class="decklist-card" data-set="JTG" data-number="98" data-lang="en"><a class="card-link" href="/cards/JTG/98"><span class="card-count">4</span><span class="card-name">N's Zoroark ex</span></a></div>
 <div class="decklist-column-heading">Trainer (5)</div>
 <div class="decklist-card" data-set="MEG" data-number="131" data-lang="en"><a><span class="card-count">4</span><span class="card-name">Ultra Ball</span></a></div>
 <div class="decklist-card" data-set="ZZZ" data-number="1" data-lang="en"><a><span class="card-count">1</span><span class="card-name">Mystery Card</span></a></div>$h$),
('https://limitlesstcg.com/decks/list/jp/75535', $h$<div class="decklist-column-heading">Pokémon (5)</div>
 <div class="decklist-card" data-set="M6" data-number="58" data-lang="en" data-translation ><a class="card-link" href="/cards/jp/M6/58?translate=en"><span class="card-count">2</span><span class="card-name">Mega Rayquaza ex</span></a></div>
 <div class="decklist-card" data-set="M6" data-number="62" data-lang="en" data-translation ><a><span class="card-count">2</span><span class="card-name">Talonflame ex</span></a></div>
 <div class="decklist-card" data-set="M6" data-number="113" data-lang="en" data-translation ><a><span class="card-count">1</span><span class="card-name">Mega Rayquaza ex</span></a></div>
 <div class="decklist-column-heading">Trainer (4)</div>
 <div class="decklist-card" data-set="MEG" data-number="131" data-lang="en"><a><span class="card-count">4</span><span class="card-name">Ultra Ball</span></a></div>
 <div class="decklist-column-heading">Energy (2)</div>
 <div class="decklist-card" data-set="M6" data-number="64" data-lang="en" data-translation ><a><span class="card-count">2</span><span class="card-name">Adventuring Lantern</span></a></div>$h$),
('https://limitlesstcg.com/tournaments/29', $h$<tr data-rank="1" data-name="Yu &amp; Me" data-country="JP" data-deck="Mega Rayquaza"><img class="pokemon" alt="rayquaza-mega"><a href="/decks/list/29455">list</a></tr>$h$);
update jt.fx set body = replace(body, 'DATE1', (current_date - 1)::text);

-- 1. first tick: one index request, nothing else
select public.jp_tick() \gset
select jt.eq('first tick: City League index and the weekly main list', (select string_agg(url, ' ' order by id) from net.sent), 'https://limitlesstcg.com/tournaments/jp?show=100 https://limitlesstcg.com/tournaments?show=100');
select jt.answer();

-- 2. reading the index adds events; next tick sends a look-back page and standings (budget 3)
select public.jp_tick() \gset
select jt.eq('index read: 2 City Leagues', (select count(*)::text from public.jp_tournaments where kind = 'city_league'), '2');
select jt.eq('city name decoded', (select shop from public.jp_tournaments where id = 'c5071'), 'Shop & Co');
select jt.check('second tick: at most 3 more requests', (select count(*) from net.sent) <= 5);
select jt.check('look-back page requested', exists (select 1 from net.sent where url like '%show=100&page=2'));
select jt.answer();

select public.jp_tick() \gset
select jt.answer();
select public.jp_tick() \gset
select jt.answer();
select public.jp_tick() \gset
select jt.answer();
select public.jp_tick() \gset

select jt.eq('standings: every place up to 32', (select string_agg(place::text, ',' order by place) from public.jp_decks where tournament_id = 'c5063'), '1,2,9');
select jt.eq('archetype from icons matches catalog archetype', (select archetype from public.jp_decks where tournament_id = 'c5063' and place = 1), 'N''s Zoroark');
select jt.eq('archetype from icons fallback', (select archetype from public.jp_decks where tournament_id = 'c5063' and place = 2), 'Mega Rayquaza Talonflame');
select jt.eq('list ref keeps jp path', (select list_ref from public.jp_decks where tournament_id = 'c5063' and place = 2), 'jp/75535');

select jt.eq('legal list: no preview cards', (select has_preview::text || '/' || preview_qty from public.jp_decks where tournament_id = 'c5063' and place = 1), 'false/0');
select jt.eq('legal list: cards matched', (select string_agg(x->>'cid', ',' order by (x->>'i')::int) from public.jp_decks d, jsonb_array_elements(d.cards) x where tournament_id = 'c5063' and place = 1), 'sv9-098,me01-131');
select jt.eq('unknown legal card lands in missing', (select array_to_string(missing, ',') from public.jp_decks where tournament_id = 'c5063' and place = 1), 'Mystery Card');
select jt.eq('preview list: flagged with copies', (select has_preview::text || '/' || preview_qty || '/' || card_count from public.jp_decks where tournament_id = 'c5063' and place = 2), 'true/7/11');
select jt.eq('preview cards not reported missing', (select array_to_string(missing, ',') from public.jp_decks where tournament_id = 'c5063' and place = 2), '');
select jt.eq('sections read from headings', (select string_agg(distinct x->>'sec', ',') from public.jp_decks d, jsonb_array_elements(d.cards) x where tournament_id = 'c5063' and place = 2), 'energy,pokemon,trainer');
select jt.eq('preview lines never get a catalog card', (select count(*)::text from public.jp_decks d, jsonb_array_elements(d.cards) x where (x->>'preview')::boolean and x->>'cid' is not null), '0');

select jt.eq('event done once its lists are in', (select status from public.jp_tournaments where id = 'c5063'), 'done');
select jt.eq('empty standings: retried later, not done', (select status || '/' || standings_tries from public.jp_tournaments where id = 'c5071'), 'new/1');

-- 3. majors come from the main index response (no extra request)
insert into public.tourney_fetch (net_id, kind, handled_at) values (900001, 'index', now());
insert into net._http_response (id, status_code, content) values (900001, 200,
  '<tr data-date="' || (current_date - 2) || '" data-name="Champions League Yokohama" data-country="JP" data-players="4000" data-format="standard-jp"><a href="/tournaments/29">x</a></tr>'
  || '<tr data-date="' || (current_date - 2) || '" data-name="Regional Louisville" data-country="US" data-players="2000" data-format="standard"><a href="/tournaments/580">x</a></tr>');
select jt.answer();
select public.jp_tick() \gset
select jt.answer();
select max(id) as before_n from net.sent \gset
select public.jp_tick() as t3 \gset
\echo :t3
select jt.eq('Champions League picked up from main index', (select name || '/' || players from public.jp_tournaments where id = 'm29'), 'Champions League Yokohama/4000');
select jt.check('Regionals are not copied into Japan', not exists (select 1 from public.jp_tournaments where name like 'Regional%'));
select jt.check('majors standings requested first', exists (select 1 from net.sent where url = 'https://limitlesstcg.com/tournaments/29'));
select jt.answer();
select public.jp_tick() \gset
select jt.eq('major standings: archetype from data-deck', (select archetype || '/' || player || '/' || list_ref from public.jp_decks where tournament_id = 'm29'), 'Mega Rayquaza/Yu & Me/29455');

-- 4. page data
select jt.eq('jp_meta preview-only', (select string_agg(archetype, ',') from public.jp_meta(14, true)), 'Mega Rayquaza Talonflame');
select jt.eq('jp_meta all', (select count(*)::text from public.jp_meta(14, false)), '3');
select jt.eq('preview cards: printings merged per list', (select avg_copies::text || '/' || lists from public.jp_preview_cards(14) where name = 'Mega Rayquaza ex'), '3.0/1');
select jt.eq('preview cards: share of fetched lists', (select share::text from public.jp_preview_cards(14) where name = 'Talonflame ex'), '50.0');
select jt.eq('events list counts preview lists', (select lists || '/' || preview_lists from public.jp_events(30, 80) where id = 'c5063'), '2/1');
select jt.eq('preview info', (select public.jp_preview_info()->>'name'), 'Delta Reign');

-- 5. isolation: Standard views see nothing from Japan
select jt.check('tourney_meta has no Japan archetypes', not exists (select 1 from public.tourney_meta(60) where archetype like 'Mega Rayquaza%'));
select jt.check('tournaments table untouched', not exists (select 1 from public.tournaments where id in (29, 5063)));

-- 6. permissions
set role anon;
select count(*) as anon_events from public.jp_events(30, 80) \gset
select count(*) as anon_decks from public.jp_decks \gset
reset role;
select jt.check('anon reads Japan events', :anon_events > 0);
select jt.check('anon reads jp_decks', :anon_decks > 0);
select jt.check('anon cannot run jp_tick', not has_function_privilege('anon', 'public.jp_tick(int)', 'execute'));
select jt.check('anon cannot read jp_fetch', not has_table_privilege('anon', 'public.jp_fetch', 'select'));
select jt.check('cron job scheduled', exists (select 1 from cron.job where jobname = 'benchmark-japan' and schedule = '5-59/10 * * * *'));

-- 7. round 2 (024): catch-up, ordering, card pages
select jt.check('catch-up job scheduled', exists (select 1 from cron.job where jobname = 'benchmark-japan-catchup' and schedule = '* * * * *'));
select jt.check('normal job passes its budget', exists (select 1 from cron.job where jobname = 'benchmark-japan' and command like '%jp_tick(3)%'));
-- three more events with lists waiting: 1st places must be fetched before a 2nd place
insert into public.jp_tournaments (id, src_id, kind, name, date, status) values
  ('c901', 901, 'city_league', 'City League A', current_date - 3, 'lists'),
  ('c902', 902, 'city_league', 'City League B', current_date - 2, 'lists');
insert into public.jp_decks (tournament_id, place, list_ref) values
  ('c901', 2, 'jp/1002'), ('c901', 1, 'jp/1001'), ('c902', 17, 'jp/2017'), ('c902', 1, 'jp/2001'), ('c902', 3, 'jp/2003');
update public.app_settings set value = now()::text where key in ('jp_index_at', 'jp_majors_at');
insert into public.app_settings (key, value) values ('jp_majors_at', now()::text) on conflict (key) do update set value = excluded.value;
update public.app_settings set value = '12' where key = 'jp_index_back';
update net._http_response set status_code = 200 where false;
select jt.answer();
select max(id) as m0 from net.sent \gset
select public.jp_catchup_tick() as ct \gset
select jt.eq('catch-up sends 4, best placings first (majors first within a place)', (select string_agg(url, ' ' order by id) from net.sent where id > :m0),
  'https://limitlesstcg.com/decks/list/29455 https://limitlesstcg.com/decks/list/jp/2001 https://limitlesstcg.com/decks/list/jp/1001 https://limitlesstcg.com/decks/list/jp/1002');
select jt.check('backlog reported', (:'ct'::jsonb->'backlog'->>'lists')::int >= 4, :'ct');
select jt.eq('card finishes list the deck', (select place || ' ' || archetype || ' x' || qty from public.jp_card_finishes('Mega Rayquaza ex', 30, 50) limit 1), '2 Mega Rayquaza Talonflame x3');
select jt.eq('card partners include other preview cards', (select string_agg(name || (case when preview then '*' else '' end), ',' order by name) from public.jp_card_partners('Mega Rayquaza ex', 30, 50)), 'Adventuring Lantern*,Talonflame ex*,Ultra Ball');
select jt.eq('winningest sort uses finish points', (select string_agg(name || ':' || points, ',') from public.jp_preview_cards(30, 'wins')), 'Adventuring Lantern:6,Mega Rayquaza ex:6,Talonflame ex:6');
select jt.check('jp_meta has points and placings', (select points > 0 and placings >= top8 from public.jp_meta(30, false) limit 1));
-- catch-up turns itself off once nothing is left
update public.jp_decks set attempts = 3 where cards is null;
update public.jp_tournaments set standings_tries = 3 where status = 'new';
select jt.answer();
select public.jp_tick(3) \gset
select public.jp_catchup_tick() as ct2 \gset
select jt.check('catch-up unschedules itself when done', not exists (select 1 from cron.job where jobname = 'benchmark-japan-catchup'), :'ct2');
select jt.check('anon cannot run catch-up', not has_function_privilege('anon', 'public.jp_catchup_tick()', 'execute'));
