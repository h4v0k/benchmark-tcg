-- Card search speed and semantics on 24,000 synthetic printings (migration 037). Production allows anon 3 s, so
-- every search here must finish in under 1 s on a laptop-class box.
\set ON_ERROR_STOP 0
create or replace function pg_temp.ok(name text, cond boolean) returns void language plpgsql as $$
begin raise notice '% | %', case when coalesce(cond,false) then 'PASS' else 'FAIL' end, name; end $$;
insert into public.sets (id, name, code, reg_mark, release_date, legal_date) select 'p'||i, 'Set '||i, 'S'||i, 'H', '2024-01-01', '2024-01-02' from generate_series(1,150) i;
insert into public.cards (id, set_id, local_id, num_key, name, name_norm, category, stage, reg_mark, hp, prices, types, attacks, abilities, weaknesses, retreat, effect)
select 'p'||(i%150+1)||'-'||i, 'p'||(i%150+1), i::text, i::text, 'Mon '||(i%4000), 'mon '||(i%4000), 'Pokemon', 'Basic', 'H', 30+(i%30)*10, jsonb_build_object('normal', (i%50)::numeric/3),
 '{Fire}', '[{"name":"Burn It","damage":"120","cost":["Fire","Colorless"],"effect":"Discard an Energy from this Pokemon. Flip a coin, if heads your opponent is now Burned."},{"name":"Tackle","damage":"20","cost":["Colorless"]}]',
 '[{"name":"Hot Body","effect":"Once during your turn you may search your deck for a card."}]', '[{"type":"Water","value":"x2"}]', 2, ''
from generate_series(1,24000) i;
update public.cards set legal_standard = true;
insert into public.cards (id, set_id, local_id, num_key, name, name_norm, category, stage, suffix, hp) values
  ('p1-x1','p1','x1','x1','Zed ex','zed ex','Pokemon','Basic','ex',200), ('p1-x2','p1','x2','x2','Zed EX','zed ex old','Pokemon','Basic','EX',200),
  ('p1-x3','p1','x3','x3','Zed V','zed v','Pokemon','Basic','V',200), ('p1-x4','p1','x4','x4','Zed VSTAR','zed vstar','Pokemon','VSTAR','',250),
  ('p1-x5','p1','x5','x5','Zed VMAX','zed vmax','Pokemon','VMAX','',300);
analyze;
set role anon;
select pg_temp.ok('is:ex is lowercase ex only', (select array_agg(card_id) from public.search_cards_q('[[{"f":"is","v":"ex"}]]')) = array['p1-x1']);
select pg_temp.ok('is:old-ex is EX only', (select array_agg(card_id) from public.search_cards_q('[[{"f":"is","v":"old-ex"}]]')) = array['p1-x2']);
select pg_temp.ok('is:v covers V, VSTAR, VMAX', (select count(*) from public.search_cards_q('[[{"f":"is","v":"v"}]]')) = 3);
do $$ begin perform * from public.search_cards_q((select jsonb_agg(jsonb_build_array(jsonb_build_object('f','hp','op','>','v','1'))) from generate_series(1,11)));
  raise notice 'FAIL | 11 OR groups rejected'; exception when others then raise notice 'PASS | 11 OR groups rejected'; end $$;
do $$ begin perform * from public.search_cards_q(jsonb_build_array((select jsonb_agg(jsonb_build_object('f','hp','op','>','v','1')) from generate_series(1,21))));
  raise notice 'FAIL | 21 clauses rejected'; exception when others then raise notice 'PASS | 21 clauses rejected'; end $$;
do $$ begin perform * from public.search_cards_q(jsonb_build_array(jsonb_build_array(jsonb_build_object('f','text','v',repeat('a',101)))));
  raise notice 'FAIL | 101-char value rejected'; exception when others then raise notice 'PASS | 101-char value rejected'; end $$;
select pg_temp.ok('quotes in values are inert', (select count(*) from public.search_cards_q('[[{"f":"text","v":"x'' or true --"}]]')) = 0);
create or replace function pg_temp.timed(label text, q jsonb, fmt text default 'unlimited') returns void language plpgsql as $$
declare t0 timestamptz := clock_timestamp(); ms numeric;
begin
  perform count(*) from public.search_cards_q(q, fmt);
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  raise notice '% | search under 1 s: % (% ms)', case when ms < 1000 then 'PASS' else 'FAIL' end, label, ms;
end $$;
select pg_temp.timed('hp>=200', '[[{"f":"hp","op":">=","v":"200"}]]');
select pg_temp.timed('o:"search your deck" damage>=100', '[[{"f":"text","v":"search your deck"},{"f":"damage","op":">=","v":"100"}]]', 'standard');
select pg_temp.timed('3 OR groups', '[[{"f":"name","v":"mon 1"}],[{"f":"weak","v":"water"},{"f":"retreat","op":"<=","v":"1"}],[{"f":"set","v":"set 1"}]]');
select pg_temp.timed('atk + ability + rarity + negation', '[[{"f":"atk","v":"burn"},{"f":"ab","v":"hot"},{"f":"type","v":"fire","neg":true},{"f":"usd","op":">","v":"3"}]]');
select pg_temp.timed('everything (name substring)', '[[{"f":"name","v":"mon"}]]');
reset role;
