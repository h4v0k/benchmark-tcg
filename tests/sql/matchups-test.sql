\set QUIET 1
\o /dev/null
drop schema if exists t cascade;
create schema t;
create table t.results (n serial, name text, ok boolean, detail text);
create table t.override (ord serial, pattern text, status int, body text);
create table t.marker (v bigint);
insert into t.marker values (0);

create function t.check(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as $$
begin
  insert into t.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
  raise notice '% | % %', case when coalesce(p_ok, false) then 'PASS' else 'FAIL' end, p_name,
    case when coalesce(p_ok, false) then '' else '-- ' || p_detail end;
end $$;
create function t.eq(p_name text, actual text, expected text) returns void language sql as $$
  select t.check(p_name, actual is not distinct from expected, 'observed=[' || coalesce(actual, 'NULL') || '] expected=[' || coalesce(expected, 'NULL') || ']')
$$;
create function t.mark() returns void language sql as $$ update t.marker set v = coalesce((select max(id) from net.sent), 0) $$;
create function t.n_new() returns int language sql as $$ select count(*)::int from net.sent where id > (select v from t.marker) $$;
create function t.urls() returns text language sql as $$ select coalesce(string_agg(url, ' ' order by id), '') from net.sent where id > (select v from t.marker) $$;
create function t.n_urls_like(p text) returns int language sql as $$ select count(*)::int from net.sent where id > (select v from t.marker) and url like p $$;
create function t.iso(p_ago interval) returns text language sql as $$ select to_char((now() - p_ago) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- ---------- fixtures (exact upstream shapes) ----------
create function t.online_list() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id','6ac395ae85920e4d253644b0','game','PTCG','format','STANDARD','name','Test Cup','date',t.iso('3 days'),'players',40,'organizerId',1),
    jsonb_build_object('id','ev2short0000000000000002','game','PTCG','format','STANDARD','name','Skip Cup','date',t.iso('3 days'),'players',40,'organizerId',1),
    jsonb_build_object('id','ev3recent000000000000003','game','PTCG','format','STANDARD','name','New Cup','date',t.iso('2 hours'),'players',40,'organizerId',1),
    jsonb_build_object('id','smallsmall0000000000000004','game','PTCG','format','STANDARD','name','Small','date',t.iso('3 days'),'players',12,'organizerId',1),
    jsonb_build_object('id','a/b?c','game','PTCG','format','STANDARD','name','Bad id','date',t.iso('3 days'),'players',40,'organizerId',1),
    jsonb_build_object('id','oldold00000000000000000006','game','PTCG','format','STANDARD','name','Old','date',t.iso('70 days'),'players',40,'organizerId',1),
    jsonb_build_object('id','expanded0000000000000007','game','PTCG','format','EXPANDED','name','Expanded','date',t.iso('3 days'),'players',40,'organizerId',1),
    jsonb_build_object('id','edge31000000000000000008','game','PTCG','format','STANDARD','name','Edge31','date',t.iso('3 days'),'players',31,'organizerId',1))
$$;
create function t.official_list() returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'message', jsonb_build_array(
    jsonb_build_object('id',75,'season',2027,'type','regional','city','Recife','country','BR','date','October 3–4, 2026','utc_start',to_char(now() at time zone 'utc' - interval '10 days','YYYY-MM-DD HH24:MI:SS'),'started',1,'completed',1),
    jsonb_build_object('id',76,'season',2027,'type','regional','city','Notdone','country','US','date','x','utc_start',to_char(now() at time zone 'utc' - interval '10 days','YYYY-MM-DD HH24:MI:SS'),'started',1,'completed',0),
    jsonb_build_object('id',77,'season',2027,'type','special','city','Special','country','US','date','x','utc_start',to_char(now() at time zone 'utc' - interval '10 days','YYYY-MM-DD HH24:MI:SS'),'started',1,'completed',1),
    jsonb_build_object('id',78,'season',2026,'type','regional','city','Ancient','country','US','date','x','utc_start',to_char(now() at time zone 'utc' - interval '200 days','YYYY-MM-DD HH24:MI:SS'),'started',1,'completed',1)))
$$;
create function t.standings(p_full boolean) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('player', pl, 'name', upper(coalesce(pl,'x')), 'country','US','placing', n,
      'record', jsonb_build_object('wins',1,'losses',0,'ties',0), 'decklist','{}'::jsonb,
      'deck', case d when 'D' then '{"id":"dragapult-ex","name":"Dragapult","icons":["dragapult"]}'::jsonb
                     when 'Z' then '{"id":"n-zoroark","name":"N''s Zoroark","icons":["zoroark"]}'::jsonb
                     when 'G' then '{"id":"gholdengo","name":"Gholdengo","icons":["gholdengo"]}'::jsonb
                     when 'O' then '{"id":"other","name":"Other","icons":[]}'::jsonb end,
      'drop', null) order by n)
  from (values (1,'u1','D'),(2,'u2','D'),(3,'u3','D'),(4,'u4','D'),(5,'u5','D'),(6,'u6','D'),
               (7,'u7','Z'),(8,'u8','Z'),(9,'u9','Z'),(10,'u10','Z'),
               (11,'u11','Z'),(12,'u12','Z'),(13,'u13','G'),(14,'u14','G'),(15,'u15','G'),(16,'u16','G'),
               (17,'u17','O'),(18,'u18','O'),(19,null,'D'),(20,'u20',null)) v(n, pl, d)
  where p_full or n <= 10
$$;
create function t.pairings() returns jsonb language sql as $$
  select ('[
   {"round":1,"phase":1,"table":1,"player1":"u1","player2":"u7","winner":"u1"},
   {"round":1,"phase":1,"table":2,"player1":"u2","player2":"u8","winner":"u8"},
   {"round":1,"phase":1,"table":3,"player1":"u3","player2":"u9","winner":"u3"},
   {"round":1,"phase":1,"table":4,"player1":"u4","player2":"u10","winner":0},
   {"round":1,"phase":1,"table":5,"player1":"u5","player2":"u11","winner":-1},
   {"round":1,"phase":1,"table":null,"winner":-1,"player1":"u9"},
   {"round":2,"phase":1,"table":1,"player1":"u1","player2":"u2","winner":"u1"},
   {"round":2,"phase":1,"table":2,"player1":"u13","player2":"u1","winner":"u13"},
   {"round":2,"phase":1,"table":3,"player1":"u17","player2":"u3","winner":"u17"},
   {"round":2,"phase":1,"table":4,"player1":"u6","player2":"u12","winner":"u12"},
   {"round":2,"phase":1,"table":5,"player1":"u7","player2":"u8","winner":"u8"},
   {"round":2,"phase":1,"table":6,"player1":"u99","player2":"u1","winner":"u1"},
   {"round":2,"phase":1,"table":7,"player1":"u3","player2":"u10","winner":null}]')::jsonb
  || (select jsonb_agg('{"round":3,"phase":1,"table":1,"player1":"u2","player2":"u8","winner":"u2"}'::jsonb) from generate_series(1,6))
$$;
create function t.off_round(n int) returns jsonb language sql as $$
  select jsonb_build_object('ok', true, 'message', case n
    when 1 then '[{"table":1,"completed":1,"player1":475,"player2":342,"winner":475,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"n-zoroark","p2_deck_name":"N''s Zoroark","p2_icons":"zoroark"},
      {"table":2,"completed":1,"player1":100,"player2":200,"winner":0,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"n-zoroark","p2_deck_name":"N''s Zoroark","p2_icons":"zoroark"},
      {"table":3,"completed":1,"player1":475,"player2":null,"winner":475,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":null,"p2_deck_name":null,"p2_icons":null}]'::jsonb
    when 2 then '[{"table":1,"completed":1,"player1":475,"player2":342,"winner":342,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"n-zoroark","p2_deck_name":"N''s Zoroark","p2_icons":"zoroark"},
      {"table":2,"completed":1,"player1":300,"player2":301,"winner":300,"p1_deck":"gholdengo","p1_deck_name":"Gholdengo","p1_icons":"gholdengo","p2_deck":"gholdengo","p2_deck_name":"Gholdengo","p2_icons":"gholdengo"}]'::jsonb
    else '[{"table":1,"completed":1,"player1":475,"player2":342,"winner":475,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"n-zoroark","p2_deck_name":"N''s Zoroark","p2_icons":"zoroark"},
      {"table":2,"completed":0,"player1":500,"player2":501,"winner":500,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"n-zoroark","p2_deck_name":"N''s Zoroark","p2_icons":"zoroark"},
      {"table":3,"completed":1,"player1":475,"player2":600,"winner":600,"p1_deck":"dragapult-ex","p1_deck_name":"Dragapult","p1_icons":"dragapult","p2_deck":"gholdengo","p2_deck_name":"Gholdengo","p2_icons":"gholdengo"}]'::jsonb
  end)
$$;
create function t.respond(p_url text, out status int, out body text) language plpgsql as $$
declare o record;
begin
  select * into o from t.override where p_url like pattern order by ord desc limit 1;
  if found then status := o.status; body := o.body; return; end if;
  status := 200;
  body := case
    when p_url like '%/api/tournaments?%page=1' then t.online_list()::text
    when p_url like '%/api/tournaments?%page=%' then '[]'
    when p_url like '%/standings' then t.standings(p_url not like '%ev2short%')::text
    when p_url like '%/pairings' then t.pairings()::text
    when p_url like '%labs/data/tcg/tournaments' then t.official_list()::text
    when p_url like '%tournament?id=%' then '{"ok":true,"message":{"round":3,"players":120,"completed":1}}'
    when p_url like '%pairings?tournamentId=%' then t.off_round(substring(p_url from 'round=(\d+)')::int)::text
  end;
end $$;
-- answer every unanswered request (timeouts: status null)
create function t.answer() returns int language plpgsql as $$
declare s record; r record; n int := 0;
begin
  for s in select * from net.sent where id not in (select id from net._http_response) order by id loop
    select * into r from t.respond(s.url);
    insert into net._http_response (id, status_code, content, timed_out, error_msg)
      values (s.id, r.status, r.body, r.status is null, case when r.status is null then 'timeout' end);
    n := n + 1;
  end loop;
  return n;
end $$;
create function t.reset(p_fresh_lists boolean default true) returns void language plpgsql as $$
begin
  truncate public.mu_fetch, public.mu_players, public.mu_results, public.mu_events, public.archetypes, net.sent, net._http_response, t.override restart identity cascade;
  delete from public.app_settings;
  update t.marker set v = 0;
  if p_fresh_lists then
    insert into public.app_settings values ('mu_online_index_at', now()::text), ('mu_official_index_at', now()::text);
  end if;
end $$;
create function t.seed_online(p_id text, p_status text, p_ago interval default '3 days', p_tries int default 0) returns void language sql as $$
  insert into public.mu_events (source, event_id, name, date, starts_at, players, status, tries)
  values ('online', p_id, 'Seed ' || p_id, (now() - p_ago)::date, now() - p_ago, 40, p_status, p_tries) $$;
create function t.seed_official(p_id text, p_status text, p_rounds int, p_done int[] default '{}') returns void language sql as $$
  insert into public.mu_events (source, event_id, name, date, players, rounds, rounds_done, status)
  values ('official', p_id, 'Seed ' || p_id, current_date, 100, p_rounds, p_done, p_status) $$;
create function t.res(p_event text) returns text language sql as $$
  select coalesce(string_agg(deck || '>' || opp || ':' || wins || '-' || losses || '-' || ties, ' ' order by deck, opp), '') from public.mu_results where event_id = p_event $$;

-- ================= 0. install state =================
select t.reset(false);
select t.eq('install: 2 cron jobs after applying twice', (select count(*) from cron.job)::text, '2');
select t.eq('install: cron benchmark-matchups', (select schedule || '|' || command from cron.job where jobname = 'benchmark-matchups'), '17 */6 * * *|select public.mu_tick()');
select t.eq('install: cron benchmark-matchups-read', (select schedule || '|' || command from cron.job where jobname = 'benchmark-matchups-read'), '22 */6 * * *|select public.mu_tick(0, false)');

-- ================= A. first send run: lists =================
select t.mark();
select public.mu_tick() as r \gset
select t.eq('A1 first run sends 2 online pages + official list', (:'r')::jsonb->>'sent', '3');
select t.check('A2 list URLs', t.urls() like '%api/tournaments?game=PTCG&format=STANDARD&limit=200&page=1%' and t.urls() like '%limit=200&page=2%' and t.urls() like '%mew.limitlesstcg.com/labs/data/tcg/tournaments', t.urls());
select public.mu_tick() as r \gset
select t.eq('A3 second run while unanswered returns waiting=3', (:'r')::jsonb->>'waiting', '3');
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('A4 read-only pass returns read=true', (:'r')::jsonb->>'read', 'true');
select t.eq('A5 online list filtering (>=32 players, STANDARD, <=60d, valid id)',
  (select string_agg(event_id, ',' order by event_id) from public.mu_events where source = 'online'),
  '6ac395ae85920e4d253644b0,ev2short0000000000000002,ev3recent000000000000003');
select t.eq('A6 official list filtering (completed, type, <=180d), id padded',
  (select string_agg(event_id || '|' || name || '|' || (date = current_date - 10)::text, ',') from public.mu_events where source = 'official'),
  '0075|Regional Championship Recife|true');
select t.eq('A7 new events have status new', (select string_agg(distinct status, ',') from public.mu_events), 'new');

-- ================= B. second send run: standings + official info =================
select t.mark();
select public.mu_tick() as r \gset
select t.eq('B1 sends 2 standings + 1 official info (recent online event not fetched <24h)', (:'r')::jsonb->>'sent', '3');
select t.check('B2 urls', t.urls() like '%tournaments/6ac395ae85920e4d253644b0/standings%' and t.urls() like '%tournaments/ev2short0000000000000002/standings%' and t.urls() like '%tournament?id=0075&division=MA%' and t.urls() not like '%ev3recent%', t.urls());
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('B3 E1 -> standings, 18 players kept (incl. other, excl. null player/deck)',
  (select status from public.mu_events where event_id = '6ac395ae85920e4d253644b0') || '|' || (select count(*) from public.mu_players where event_id = '6ac395ae85920e4d253644b0'), 'standings|18');
select t.eq('B4 E2 (10 decked) skipped, players cleared',
  (select status || '|' || (done_at is not null)::text from public.mu_events where event_id = 'ev2short0000000000000002') || '|' || (select count(*) from public.mu_players where event_id = 'ev2short0000000000000002'), 'skip|true|0');
select t.eq('B5 official info -> rounds=3 players=120 status rounds',
  (select status || '|' || rounds || '|' || players from public.mu_events where event_id = '0075'), 'rounds|3|120');
select t.eq('B6 archetypes recorded (name/icons)', (select name || '|' || icons::text from public.archetypes where slug = 'dragapult-ex'), 'Dragapult|{dragapult}');

-- ================= C. third send run: pairings + all 3 rounds in ONE run =================
select t.mark();
select public.mu_tick() as r \gset
select t.eq('C1 one run sends E1 pairings + 3 official rounds', (:'r')::jsonb->>'sent', '4');
select t.check('C2 round urls 1..3', t.n_urls_like('%pairings?tournamentId=0075&division=MA&round=_') = 3 and t.urls() like '%round=1%' and t.urls() like '%round=2%' and t.urls() like '%round=3%' and t.urls() like '%tournaments/6ac395ae85920e4d253644b0/pairings%', t.urls());
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('C3 online E1 done, players emptied',
  (select status from public.mu_events where event_id = '6ac395ae85920e4d253644b0') || '|' || (select count(*) from public.mu_players where event_id = '6ac395ae85920e4d253644b0'), 'done|0');
select t.eq('C4 online E1 exact W-L-T (both directions; ties counted; double-loss/bye/other/unknown/null-winner ignored; mirrors 1-1)',
  t.res('6ac395ae85920e4d253644b0'),
  'dragapult-ex>dragapult-ex:1-1-0 dragapult-ex>gholdengo:0-1-0 dragapult-ex>n-zoroark:8-2-1 gholdengo>dragapult-ex:1-0-0 n-zoroark>dragapult-ex:2-8-1 n-zoroark>n-zoroark:1-1-0');
select t.eq('C5 no results rows for other', (select count(*) from public.mu_results where deck = 'other' or opp = 'other')::text, '0');
select t.eq('C6 official 0075 exact W-L-T (3 rounds, tie, bye, uncompleted ignored, mirror)',
  t.res('0075'), 'dragapult-ex>gholdengo:0-1-0 dragapult-ex>n-zoroark:2-1-1 gholdengo>dragapult-ex:1-0-0 gholdengo>gholdengo:1-1-0 n-zoroark>dragapult-ex:1-2-1');
select t.eq('C7 official done after all rounds',
  (select status || '|' || rounds_done::text || '|' || (done_at is not null)::text || '|' || tries from public.mu_events where event_id = '0075'), 'done|{1,2,3}|true|0');
select t.eq('C8 online tries reset to 0 on success', (select tries::text from public.mu_events where event_id = '6ac395ae85920e4d253644b0'), '0');

-- ================= D. re-delivery doesn't double count =================
create temp table snap as select * from public.mu_results where event_id = '0075';
update public.mu_events set status = 'rounds', rounds_done = '{1,2}', done_at = null where event_id = '0075';
insert into net._http_response (id, status_code, content) values (900001, 200, t.off_round(2)::text);
insert into public.mu_fetch (net_id, kind, event_id, round) values (900001, 'official_round', '0075', 2);
select public.mu_tick(0, false) as r \gset
select t.eq('D1 re-delivered round 2 (already in rounds_done) not double counted',
  (select count(*) from public.mu_results m join snap s using (source, event_id, deck, opp) where m.wins = s.wins and m.losses = s.losses and m.ties = s.ties)::text || '/' || (select count(*) from snap), '5/5');
select t.eq('D2 rounds_done unchanged by re-delivery', (select rounds_done::text from public.mu_events where event_id = '0075'), '{1,2}');
insert into net._http_response (id, status_code, content) values (900002, 200, t.off_round(3)::text);
insert into public.mu_fetch (net_id, kind, event_id, round) values (900002, 'official_round', '0075', 3);
select public.mu_tick(0, false) as r \gset
select t.eq('D3 genuine last round counts once and completes event',
  t.res('0075') || '|' || (select status from public.mu_events where event_id = '0075'),
  'dragapult-ex>gholdengo:0-2-0 dragapult-ex>n-zoroark:3-1-1 gholdengo>dragapult-ex:2-0-0 gholdengo>gholdengo:1-1-0 n-zoroark>dragapult-ex:1-3-1|done');
-- (D3 deliberately delivers round 3 a second time since 0075 had round 3 counted already: only {1,2} were in rounds_done, so this is the "lost rounds_done" case)
delete from public.mu_results where event_id = '0075';
insert into public.mu_results select * from snap;
update public.mu_events set status = 'done', rounds_done = '{1,2,3}' where event_id = '0075';
insert into net._http_response (id, status_code, content) values (900003, 200, t.off_round(1)::text);
insert into public.mu_fetch (net_id, kind, event_id, round) values (900003, 'official_round', '0075', 1);
select public.mu_tick(0, false) as r \gset
select t.eq('D4 round delivered for event already done is ignored', t.res('0075'), 'dragapult-ex>gholdengo:0-1-0 dragapult-ex>n-zoroark:2-1-1 gholdengo>dragapult-ex:1-0-0 gholdengo>gholdengo:1-1-0 n-zoroark>dragapult-ex:1-2-1');

-- ================= E. read functions =================
select t.eq('E1 matchup_decks online (mirrors excluded, >=10 games, win_pct tie=1/3)',
  (select string_agg(deck || ':' || games || ':' || wins || '-' || losses || '-' || ties || ':' || win_pct || ':' || events, ',' order by games desc) from public.matchup_decks('online', 30)),
  'dragapult-ex:12:8-3-1:69.4:1,n-zoroark:11:2-8-1:21.2:1');
select t.eq('E2 matchups(dragapult-ex, online)',
  (select string_agg(opp || ':' || name || ':' || games || ':' || wins || '-' || losses || '-' || ties || ':' || win_pct, ',' order by games desc) from public.matchups('dragapult-ex', 'online', 30)),
  'n-zoroark:N''s Zoroark:11:8-2-1:75.8,gholdengo:Gholdengo:1:0-1-0:0.0');
select t.eq('E3 matchups(dragapult-ex, official)',
  (select string_agg(opp || ':' || games || ':' || wins || '-' || losses || '-' || ties || ':' || win_pct, ',' order by games desc) from public.matchups('dragapult-ex', 'official', 30)),
  'n-zoroark:4:2-1-1:58.3,gholdengo:1:0-1-0:0.0');
select t.eq('E4 matchup_decks official empty (<10 games)', (select count(*) from public.matchup_decks('official', 30))::text, '0');
select t.eq('E5 p_days clamps to >=7: official event 10d old excluded at p_days=1, online 3d kept',
  (select count(*) from public.matchups('dragapult-ex', 'official', 1))::text || '/' || (select count(*) from public.matchups('dragapult-ex', 'online', 1)), '0/2');
select t.eq('E6 matchup_coverage online', (public.matchup_coverage('online', 30)->>'events') || '|' || (public.matchup_coverage('online', 30)->>'pending') || '|' || (public.matchup_coverage('online', 30)->'event_names')::text, '1|1|["Test Cup"]');
select t.eq('E7 matchup_coverage official', (public.matchup_coverage('official', 30)->>'events') || '|' || (public.matchup_coverage('official', 30)->>'pending') || '|' || (public.matchup_coverage('official', 30)->'event_names')::text, '1|0|["Regional Championship Recife"]');
-- non-done events must be ignored
insert into public.mu_events (source, event_id, name, date, status) values ('online','pend1','Pending',current_date,'standings'), ('online','skip1','Skipped',current_date,'skip'), ('online','rnds1','Rounds',current_date,'new');
insert into public.mu_results values ('online','pend1','dragapult-ex','n-zoroark',50,0,0), ('online','skip1','dragapult-ex','n-zoroark',50,0,0), ('online','rnds1','dragapult-ex','n-zoroark',50,0,0);
select t.eq('E8 non-done events ignored by matchup_decks', (select string_agg(deck || ':' || games, ',' order by games desc) from public.matchup_decks('online', 30)), 'dragapult-ex:12,n-zoroark:11');
select t.eq('E9 non-done events ignored by matchups', (select games::text from public.matchups('dragapult-ex', 'online', 30) where opp = 'n-zoroark'), '11');
select t.eq('E10 coverage counts: events=1, pending=2 (standings,new; skip excluded)', (public.matchup_coverage('online', 30)->>'events') || '|' || (public.matchup_coverage('online', 30)->>'pending'), '1|3');
delete from public.mu_events where event_id in ('pend1','skip1','rnds1');

-- ================= F. time: 24h gate, index refresh, 180-day purge =================
update public.mu_events set starts_at = now() - interval '25 hours' where event_id = 'ev3recent000000000000003';
update public.app_settings set value = (now() - interval '6 hours')::text where key = 'mu_online_index_at';
insert into public.mu_events (source, event_id, name, date, status) values ('online','oldev','Old',current_date - 200,'done');
insert into public.mu_results values ('online','oldev','a','b',1,0,0);
select t.mark();
select public.mu_tick() as r \gset
select t.eq('F1 after 25h the recent event is fetched; online index refreshed (1 page, not 2) after 5h', (:'r')::jsonb->>'sent', '2');
select t.check('F2 urls', t.urls() like '%tournaments/ev3recent000000000000003/standings%' and t.urls() like '%limit=200&page=1%' and t.urls() not like '%page=2%', t.urls());
select t.eq('F3 events older than 180 days purged (results cascade)', (select count(*) from public.mu_events where event_id = 'oldev')::text || '/' || (select count(*) from public.mu_results where event_id = 'oldev'), '0/0');

-- ================= G. failure handling =================
-- G1: 500/timeout -> backoff + tries+1, blocks sending in same run
select t.reset(true);
select t.seed_online('x1','new'), t.seed_online('x2','new');
select public.mu_tick() as r \gset
select t.eq('G1 setup: 2 standings sent', (:'r')::jsonb->>'sent', '2');
insert into t.override (pattern, status, body) values ('%/x1/standings', 500, 'oops'), ('%/x2/standings', null, null);
select t.answer();
select t.mark();
select public.mu_tick() as r \gset
select t.check('G2 500 response sets mu_backoff_until and blocks sending in the same run', (:'r')::jsonb ? 'backoff_until' and t.n_new() = 0, 'r=' || :'r' || ' new=' || t.n_new());
select t.eq('G3 tries +1 for 500 and for timeout (null status)', (select string_agg(event_id || '=' || tries, ',' order by event_id) from public.mu_events), 'x1=1,x2=1');
select t.check('G4 backoff is ~20 min for 5xx', (select value::timestamptz - now() between interval '19 minutes' and interval '20 minutes 5 seconds' from public.app_settings where key = 'mu_backoff_until'), (select value from public.app_settings where key = 'mu_backoff_until'));
select t.mark();
select public.mu_tick() as r \gset
select t.check('G5 still blocked while backoff active (no read pending)', (:'r')::jsonb ? 'backoff_until' and t.n_new() = 0, :'r');
update public.app_settings set value = (now() - interval '1 minute')::text where key = 'mu_backoff_until';
select public.mu_tick() as r \gset
select t.eq('G6 sending resumes after backoff expires', (:'r')::jsonb->>'sent', '2');

-- G7: failed list deletes its freshness marker
select t.reset(false);
select public.mu_tick() as r \gset
insert into t.override (pattern, status, body) values ('%', 500, 'down');
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('G7 failed list fetches delete mu_*_index_at so they retry', (select string_agg(key, ',' order by key) from public.app_settings), 'mu_backoff_until');

-- G8: 429 doesn't cost a try
select t.reset(true);
select t.seed_online('x1','new');
select public.mu_tick() as r \gset
insert into t.override (pattern, status, body) values ('%', 429, 'slow down');
select t.answer();
select t.mark();
select public.mu_tick() as r \gset
select t.eq('G8 429: tries unchanged', (select tries::text from public.mu_events where event_id = 'x1'), '0');
select t.check('G9 429: backoff ~30 min, run blocked, fetch marked handled', (:'r')::jsonb ? 'backoff_until' and t.n_new() = 0
  and (select value::timestamptz - now() between interval '29 minutes' and interval '30 minutes 5 seconds' from public.app_settings where key = 'mu_backoff_until')
  and (select count(*) from public.mu_fetch where handled_at is null) = 0, :'r');

-- G10: 5 consecutive failures -> skip, results deleted
select t.reset(true);
select t.seed_official('0075','rounds',2,'{1}');
insert into public.mu_results values ('official','0075','dragapult-ex','n-zoroark',1,0,0);
insert into t.override (pattern, status, body) values ('%', 404, null);
do $$ declare i int; tr int; st text; begin
  for i in 1..5 loop
    perform public.mu_tick(); perform t.answer(); perform public.mu_tick(0, false);
    select tries into tr from public.mu_events where event_id = '0075';
    perform t.check('G10.' || i || ' tries after failure cycle ' || i, tr = i, 'tries=' || tr);
  end loop;
  select status into st from public.mu_events where event_id = '0075';
  perform t.check('G11 still pending at 5 tries until next send run', st = 'rounds' and (select count(*) from public.mu_results) = 1, st);
  perform public.mu_tick();
  select status into st from public.mu_events where event_id = '0075';
  perform t.check('G12 next send run: status skip, partial results deleted, done_at set',
    st = 'skip' and (select count(*) from public.mu_results) = 0 and (select done_at is not null from public.mu_events where event_id = '0075'), st);
end $$;

-- G13: {"ok":true} without message is a failure; empty pairings is a failure
select t.reset(true);
select t.seed_official('0075','new',null), t.seed_official('0076','rounds',2), t.seed_online('x9','standings');
-- (one try per event per run, however many of its requests failed)
insert into t.override (pattern, status, body) values ('%tournament?id=%', 200, '{"ok":true}'), ('%pairings?tournamentId=%', 200, '{"ok":true}'), ('%/x9/pairings', 200, '[]');
select public.mu_tick() as r \gset
select t.eq('G13 setup: info + 2 rounds + pairings sent', (:'r')::jsonb->>'sent', '4');
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('G14 {"ok":true} (no message) counts as failure for info/round; [] pairings failure; no state advanced',
  (select string_agg(event_id || '=' || status || '/' || tries || '/' || rounds_done::text, ' ' order by event_id) from public.mu_events),
  '0075=new/1/{} 0076=rounds/1/{} x9=standings/1/{}');

-- G15: lost response (no row after 3h) is just marked handled, no try counted
select t.reset(true);
select t.seed_online('x1','new');
insert into public.mu_fetch (net_id, kind, event_id, created_at) values (9001, 'online_standings', 'x1', now() - interval '4 hours'), (9002, 'online_standings', 'x1', now() - interval '1 hour');
select public.mu_tick(0, false) as r \gset
select t.eq('G15 unanswered >3h marked handled (no try), <3h left waiting',
  (select string_agg(net_id || '=' || (handled_at is not null)::text, ',' order by net_id) from public.mu_fetch) || '|' || (select tries from public.mu_events), '9001=true,9002=false|0');

-- G16: success after failures resets tries
select t.reset(true);
select t.seed_online('x1','new','3 days', 3);
select public.mu_tick() as r \gset
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('G16 success resets tries (3 -> 0) and advances to standings', (select tries || '|' || status from public.mu_events), '0|standings');

-- ================= H. budget / read-only =================
select t.reset(true);
select t.seed_official('0075','rounds',6), t.seed_online('x1','new'), t.seed_online('x2','new'), t.seed_online('x3','new');
select t.mark();
select public.mu_tick(3) as r \gset
select t.check('H1 budget 3: exactly 3 event requests (rounds 1-3 of the 6-round event, newest/official first)', (:'r')::jsonb->>'sent' = '3' and t.n_new() = 3 and t.n_urls_like('%round=_') = 3 and t.urls() like '%round=3%' and t.urls() not like '%round=4%', t.urls());
select public.mu_tick(3) as r \gset
select t.eq('H2 unanswered batch -> waiting', (:'r')::jsonb->>'waiting', '3');
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.mark();
select public.mu_tick(3) as r \gset
select t.check('H3 next run sends rounds 4-6 only (3 requests)', t.n_new() = 3 and t.urls() like '%round=4%' and t.urls() like '%round=5%' and t.urls() like '%round=6%', t.urls());
select t.answer();
select public.mu_tick(0, false) as r \gset
select t.eq('H4 6-round event done after two runs', (select status || '|' || rounds_done::text from public.mu_events where event_id = '0075'), 'done|{1,2,3,4,5,6}');
select t.mark();
select public.mu_tick(3) as r \gset
select t.check('H5 then online standings (3 requests, budget respected)', t.n_new() = 3 and t.n_urls_like('%/standings') = 3, t.urls());
-- read-only pass sends nothing
select t.reset(true);
select t.seed_official('0075','rounds',6), t.seed_online('x1','new');
select t.mark();
select public.mu_tick(0, false) as r \gset
select t.check('H6 read-only pass sends nothing', t.n_new() = 0 and (:'r')::jsonb->>'read' = 'true', :'r');
select public.mu_tick(0, true) as r \gset
select t.check('H7 budget 0 with send sends no event requests', t.n_new() = 0, t.urls());
-- budget vs list fetches (spec + comment at line ~205: "at most budget event requests (plus the event lists)")
select t.reset(false);
select t.seed_official('0075','rounds',6), t.seed_online('x1','new'), t.seed_online('x2','new'), t.seed_online('x3','new');
select t.mark();
select public.mu_tick(3) as r \gset
select t.check('H8 list fetches are outside the event budget (expect 3 lists + 3 event requests = 6)', t.n_new() = 6, 'sent=' || t.n_new() || ' urls: lists=' || t.n_urls_like('%tournaments') + t.n_urls_like('%page=%') || ' round/standings=' || t.n_urls_like('%round=%'));

-- ================= I. privileges =================
select t.check('I1 anon/authenticated cannot execute mu_tick/mu_read/mu_get/mu_add/mu_archetype',
  not has_function_privilege('anon', 'public.mu_tick(int,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.mu_tick(int,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.mu_read(public.mu_fetch,text)', 'execute') and not has_function_privilege('authenticated', 'public.mu_read(public.mu_fetch,text)', 'execute')
  and not has_function_privilege('anon', 'public.mu_get(text,text,text,int)', 'execute') and not has_function_privilege('authenticated', 'public.mu_get(text,text,text,int)', 'execute')
  and not has_function_privilege('anon', 'public.mu_add(text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.mu_archetype(text,text,text[])', 'execute'), 'privileges');
select t.check('I2 anon/authenticated can execute matchup_decks/matchups/matchup_coverage',
  has_function_privilege('anon', 'public.matchup_decks(text,int)', 'execute') and has_function_privilege('anon', 'public.matchups(text,text,int)', 'execute') and has_function_privilege('anon', 'public.matchup_coverage(text,int)', 'execute')
  and has_function_privilege('authenticated', 'public.matchup_decks(text,int)', 'execute') and has_function_privilege('authenticated', 'public.matchups(text,text,int)', 'execute') and has_function_privilege('authenticated', 'public.matchup_coverage(text,int)', 'execute'), 'privileges');
select t.check('I3 service_role cannot execute mu_tick via grant (informational; owner/cron only)', not has_function_privilege('service_role', 'public.mu_tick(int,boolean)', 'execute'), 'service_role can execute');
do $$ declare a boolean; b boolean; c boolean; begin
  set local role anon;
  begin perform public.mu_tick(); a := false; exception when insufficient_privilege then a := true; end;
  begin perform count(*) from public.mu_results; b := false; exception when insufficient_privilege then b := true; end;
  begin perform count(*) from public.matchup_decks(); perform public.matchup_coverage(); perform count(*) from public.matchups('x'); c := true; exception when others then c := false; end;
  reset role;
  perform t.check('I4 real anon session: mu_tick denied, mu_results denied, read RPCs work', a and b and c, a::text || b::text || c::text);
end $$;

-- ================= summary =================
\o
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from t.results \gset
\echo SUMMARY: :pass passed, :fail failed
\if :fail
\echo FAIL | one or more checks failed
\quit 3
\endif
