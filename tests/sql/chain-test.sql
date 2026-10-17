\set ON_ERROR_STOP 0
create or replace function pg_temp.ok(name text, cond boolean) returns void language plpgsql as $$
begin raise notice '% | %', case when cond then 'PASS' else 'FAIL' end, name; end $$;

-- ---------- 018: advisor fixes ----------
select pg_temp.ok('no policy calls auth.uid() per row', not exists (
  select 1 from pg_policies where schemaname = 'public'
    and regexp_replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '\(\s*select auth\.uid\(\) as uid\s*\)', '', 'gi') ~ 'auth\.uid\(\)'));
select pg_temp.ok('helpers have a fixed search_path', (select bool_and(proconfig is not null) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and proname in ('card_price', 'tourney_kind', 'html_text')));
select pg_temp.ok('foreign keys indexed', (select count(*) from pg_indexes where schemaname = 'public'
  and indexname in ('deck_likes_user', 'decks_folder', 'printing_prefs_card', 'set_codes_set')) = 4);  -- deck_comments removed in 033
select pg_temp.ok('bans/rotations: one policy per action', not exists (
  select tablename, cmd from pg_policies where tablename in ('bans', 'rotations') and cmd in ('SELECT', 'ALL') group by 1, 2 having count(*) > 1)
  and (select count(*) from pg_policies where tablename in ('bans', 'rotations')) = 8);

-- RLS behavior: two users, one public and one private deck
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
insert into public.profiles (id, username) values ('11111111-1111-1111-1111-111111111111', 'alice'), ('22222222-2222-2222-2222-222222222222', 'bob')
  on conflict (id) do update set username = excluded.username;
insert into public.decks (id, owner, name, is_public) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'alice public', true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'alice private', false);
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

set role anon;
select pg_temp.ok('anon sees only public decks', (select count(*) from public.decks) = 1);
select pg_temp.ok('anon reads bans', (select count(*) >= 0 from public.bans));
reset role;

set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok('bob sees alice''s public deck only', (select count(*) from public.decks) = 1);
do $$ begin
  insert into public.decks (owner, name) values ('11111111-1111-1111-1111-111111111111', 'forged');
  raise notice 'FAIL | bob cannot create a deck as alice';
exception when others then raise notice 'PASS | bob cannot create a deck as alice'; end $$;
do $$ begin
  insert into public.decks (owner, name) values ('22222222-2222-2222-2222-222222222222', 'bob deck');
  raise notice 'PASS | bob can create his own deck';
exception when others then raise notice 'FAIL | bob can create his own deck: %', sqlerrm; end $$;
update public.decks set name = 'hacked' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role; reset request.jwt.claim.sub;
select pg_temp.ok('bob cannot edit alice''s deck', (select name from public.decks where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'alice public');
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select pg_temp.ok('alice sees both her decks', (select count(*) from public.decks where owner = '11111111-1111-1111-1111-111111111111') = 2);
do $$ begin
  insert into public.bans (card_name, format) values ('x', 'standard');
  raise notice 'FAIL | non-admin cannot add a ban';
exception when others then raise notice 'PASS | non-admin cannot add a ban'; end $$;
reset role; reset request.jwt.claim.sub;

-- ---------- matchup_decks (rewritten in 018) ----------
insert into public.archetypes (slug, name) values ('dragapult-ex', 'Dragapult ex'), ('n-zoroark', 'N''s Zoroark ex') on conflict do nothing;
insert into public.mu_events (source, event_id, name, date, players, status) values
 ('online', 'on1', 'Small online', current_date - 3, 100, 'done'), ('online', 'on2', 'Big online', current_date - 5, 512, 'done'),
 ('online', 'old', 'Old online', current_date - 100, 300, 'done'), ('online', 'nd', 'Running', current_date - 1, 300, 'rounds');
insert into public.mu_results (source, event_id, deck, opp, wins, losses, ties) values
 ('online', 'on1', 'dragapult-ex', 'n-zoroark', 6, 3, 1), ('online', 'on2', 'dragapult-ex', 'n-zoroark', 2, 1, 0),
 ('online', 'on1', 'n-zoroark', 'dragapult-ex', 3, 6, 1), ('online', 'on2', 'n-zoroark', 'dragapult-ex', 1, 2, 0),
 ('online', 'on1', 'dragapult-ex', 'dragapult-ex', 5, 5, 0), ('online', 'nd', 'dragapult-ex', 'n-zoroark', 9, 0, 0);
select pg_temp.ok('matchup_decks: totals, names, mirrors and unfinished events excluded',
  (select row(deck, name, games, wins, losses, ties, win_pct, events)::text from public.matchup_decks('online', 30) where deck = 'dragapult-ex')
  = row('dragapult-ex', 'Dragapult ex', 13::bigint, 8::bigint, 4::bigint, 1::bigint, 64.1, 2::bigint)::text);

-- ---------- 019: weighted winning lists ----------
insert into public.mu_lists (source, event_id, player, name, deck, place, wins, losses, ties, list) values
 ('online', 'on1', 'a', 'Alice', 'dragapult-ex', 1, 7, 0, 0, '4 Dreepy SV6 128'),
 ('online', 'on2', 'b', 'Bob', 'dragapult-ex', 3, 6, 1, 1, '4 Dreepy SV6 128'),
 ('online', 'on2', 'c', 'Cy', 'dragapult-ex', null, 2, 1, 0, 'x'),
 ('online', 'old', 'd', 'Dee', 'dragapult-ex', 1, 8, 0, 0, 'x'),
 ('online', 'nd', 'e', 'Eve', 'dragapult-ex', 1, 8, 0, 0, 'x');
insert into public.tournaments (id, name, date, players, kind, status) values
 (900, 'Regional Big', current_date - 10, 3000, 'regional', 'done'), (901, 'World Championships', current_date - 40, 800, 'worlds', 'done');
insert into public.tournament_decks (tournament_id, place, player, archetype, cards, list_id) values
 (900, 1, 'Rex', 'Dragapult ex', '[{"cid":"sv6-128","qty":4,"board":"main"}]', 55),
 (900, 20, 'Ray', 'dragapult EX', '[]', 56),
 (900, 2, 'Zed', 'N''s Zoroark ex', '[]', 57),
 (901, 32, 'Wil', 'Dragapult ex', '[]', 58),
 (900, 5, 'Nol', 'Dragapult ex', null, 59);
select pg_temp.ok('deck_lists: majors first, ranked by weighted finish; small/unfinished/old/unlisted left out',
  (select string_agg(key || '=' || score, ' ' order by ord) from (select *, row_number() over () ord from public.deck_lists('dragapult-ex', 60, 25, true)) x)
  = 't900-1=11.55 t900-20=7.23 t901-32=6.97 o2=3.71 o1=3.32');
select pg_temp.ok('deck_lists: period honored', (select count(*) from public.deck_lists('dragapult-ex', 30, 25, true)) = 4);
select pg_temp.ok('deck_lists: official rows have no record, online rows do',
  (select bool_and((tier = 'online') = (wins is not null)) from public.deck_lists('dragapult-ex', 60, 25, true)));
select pg_temp.ok('deck_list: official returns stored cards, slug and list id',
  (select row(tier, deck, event_id, cards ->> 0 is not null, list is null, list_id)::text from public.deck_list('t900-1'))
  = row('regional', 'dragapult-ex', '900', true, true, 55)::text);
select pg_temp.ok('deck_list: online returns text', (select list from public.deck_list('o1')) = '4 Dreepy SV6 128');
select pg_temp.ok('deck_list: bad keys and lists without cards return nothing',
  (select count(*) from public.deck_list('t900-5')) + (select count(*) from public.deck_list('x; drop'))
  + (select count(*) from public.deck_list('o99999999999999999999')) + (select count(*) from public.deck_list('o5')) = 0);
set role anon;
select pg_temp.ok('anon can call deck_lists/deck_list', (select count(*) from public.deck_lists('dragapult-ex', 60, 25, true)) = 5 and (select count(*) from public.deck_list('t900-1')) = 1);
reset role;
select pg_temp.ok('deck_list(bigint) forwards for pages opened before the update', (select list from public.deck_list(1::bigint)) = '4 Dreepy SV6 128');
select pg_temp.ok('deck_lists without p_majors (pages from before 019) stays online-only with ids', (select string_agg(id::text, ',' order by id) from public.deck_lists('dragapult-ex', 60)) = '1,2');

-- ---------- 028: pre-launch hardening ----------
grant usage on schema auth to anon, authenticated;
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
-- (the backdated-comments rate-limit check went away with comments in 033)
insert into public.decks (id, owner, name, created_at) values ('aaaaaaaa-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'backdated', '2000-01-01');
set benchmark.counter_bump = 'on';
update public.decks set like_count = 999, view_count = 999, featured = true, created_at = '2001-01-01',
  id = 'aaaaaaaa-0000-0000-0000-0000000000b2' where id = 'aaaaaaaa-0000-0000-0000-0000000000b1';
reset benchmark.counter_bump;
reset role; reset request.jwt.claim.sub;
select pg_temp.ok('server sets created_at on insert', (select created_at > now() - interval '1 hour' from public.decks where id = 'aaaaaaaa-0000-0000-0000-0000000000b1'));
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update public.decks set updated_at = '2099-01-01', description = 'x' where id = 'aaaaaaaa-0000-0000-0000-0000000000b1';
reset role; reset request.jwt.claim.sub;
select pg_temp.ok('owners cannot set updated_at', (select updated_at < now() + interval '1 minute' from public.decks where id = 'aaaaaaaa-0000-0000-0000-0000000000b1'));
select pg_temp.ok('bump switch ignored for site roles; id/created_at pinned',
  (select like_count = 0 and view_count = 0 and not featured and created_at > now() - interval '1 hour' from public.decks where id = 'aaaaaaaa-0000-0000-0000-0000000000b1'));

set role anon;
do $$ declare k int; begin for k in 1..60 loop perform public.record_view('aaaaaaaa-0000-0000-0000-000000000001', 'v' || k); end loop; end $$;
reset role;
select pg_temp.ok('anonymous views capped per deck per day', (select view_count from public.decks where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 50);

select pg_temp.ok('anon cannot write or truncate tables', not has_table_privilege('anon', 'public.decks', 'insert')
  and not has_table_privilege('anon', 'public.cards', 'update') and not has_table_privilege('authenticated', 'public.decks', 'truncate'));
select pg_temp.ok('internal tables closed to the API', not has_table_privilege('anon', 'public.app_settings', 'select')
  and not has_table_privilege('authenticated', 'public.app_settings', 'select') and not has_table_privilege('authenticated', 'public.deck_views', 'select'));
select pg_temp.ok('signed-in users still write decks, comments, likes, follows, bans (RLS decides)',
  has_table_privilege('authenticated', 'public.decks', 'insert') and has_table_privilege('authenticated', 'public.deck_likes', 'insert')
  and has_table_privilege('authenticated', 'public.follows', 'delete') and has_table_privilege('authenticated', 'public.bans', 'insert'));
select pg_temp.ok('catalog read-only for signed-in users', has_table_privilege('authenticated', 'public.cards', 'select')
  and not has_table_privilege('authenticated', 'public.cards', 'insert'));
do $$ begin
  perform public.resolve_decklist_v2((select jsonb_agg(jsonb_build_object('i', g, 'qty', 1, 'name', 'x')) from generate_series(1, 151) g), 'standard', 'exact');
  raise notice 'FAIL | decklist matcher rejects > 150 lines';
exception when others then raise notice 'PASS | decklist matcher rejects > 150 lines'; end $$;

-- legality: an undated new set is not legal yet; an undated set we've had for months is
insert into public.sets (id, name, code, reg_mark, release_date, legal_date) values ('zz-new', 'Undated New', 'ZZN', 'J', null, null);
insert into public.cards (id, set_id, local_id, num_key, name, name_norm, category, stage, reg_mark)
  values ('zz-new-1', 'zz-new', '1', '1', 'Testmon', 'testmon', 'Pokemon', 'Basic', 'J');
update public.cards set legal_standard = true where id = 'zz-new-1';
select public.recompute_legality();
select pg_temp.ok('undated new set is not Standard legal', not (select legal_standard from public.cards where id = 'zz-new-1'));
update public.sets set legal_date = current_date - 1 where id = 'zz-new';
select public.recompute_legality();
select pg_temp.ok('the set goes live once it has a legal date', (select legal_standard from public.cards where id = 'zz-new-1'));


-- tournaments: an empty standings page counts as a try; old stuck events close
insert into public.tournaments (id, name, date, kind, status) values (990001, 'Regional Empty', current_date - 2, 'regional', 'new'),
  (990002, 'Regional Ancient', current_date - 200, 'regional', 'new');
insert into public.tourney_fetch (net_id, kind, tournament_id) values (990001, 'standings', 990001);
insert into net._http_response (id, status_code, content) values (990001, 200, '<html>no standings yet</html>');
select public.tourney_tick();
select pg_temp.ok('empty standings: still new, one try counted', (select status = 'new' and standings_tries = 1 from public.tournaments where id = 990001));
select pg_temp.ok('events older than the window are closed', (select status from public.tournaments where id = 990002) = 'done');

select pg_temp.ok('no age data on the server', not exists (select 1 from information_schema.columns where table_name = 'player_info' and column_name in ('division', 'birth_date', 'dob')));
-- ---------- 029: player_info (private tournament details) ----------
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.player_info (player_name, player_id) values ('Alice A', '1234567');
select pg_temp.ok('alice saves her player info and reads it back', (select player_name = 'Alice A' and player_id = '1234567'
  and user_id = '11111111-1111-1111-1111-111111111111' from public.player_info));
reset role; reset request.jwt.claim.sub;
set role authenticated; set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select pg_temp.ok('bob cannot read alice''s player info', (select count(*) from public.player_info) = 0);
update public.player_info set player_name = 'hacked' where user_id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  insert into public.player_info (user_id, player_name, player_id) values ('11111111-1111-1111-1111-111111111111', 'Forged', '999');
  raise notice 'PASS | forged user_id is coerced or rejected';
exception when others then raise notice 'PASS | forged user_id is coerced or rejected'; end $$;
do $$ begin
  insert into public.player_info (player_name, player_id) values ('Bob', 'abc123');
  raise notice 'FAIL | player_id with letters is rejected';
exception when others then raise notice 'PASS | player_id with letters is rejected'; end $$;
reset role; reset request.jwt.claim.sub;
select pg_temp.ok('bob cannot update alice''s player info', (select player_name from public.player_info where user_id = '11111111-1111-1111-1111-111111111111') = 'Alice A');
select pg_temp.ok('forged insert never lands on alice''s row', (select player_id from public.player_info where user_id = '11111111-1111-1111-1111-111111111111') = '1234567'
  and (select count(*) from public.player_info where user_id = '22222222-2222-2222-2222-222222222222') in (0, 1));
select pg_temp.ok('bob has at most his own row', not exists (select 1 from public.player_info where player_name = 'Forged' and user_id <> '22222222-2222-2222-2222-222222222222'));
select pg_temp.ok('anon has no privileges on player_info', not has_table_privilege('anon', 'public.player_info', 'select')
  and not has_table_privilege('anon', 'public.player_info', 'insert') and not has_table_privilege('anon', 'public.player_info', 'update')
  and not has_table_privilege('anon', 'public.player_info', 'delete'));
select pg_temp.ok('authenticated cannot truncate or reference player_info', not has_table_privilege('authenticated', 'public.player_info', 'truncate')
  and not has_table_privilege('authenticated', 'public.player_info', 'references') and not has_table_privilege('authenticated', 'public.player_info', 'trigger'));
select pg_temp.ok('player_info: one policy per action', (select count(*) from pg_policies where tablename = 'player_info') = 4);
