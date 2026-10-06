-- Tournament results: Regionals, Internationals and Worlds, top 32 with deck lists, from Limitless.
-- Everything is stored here; Limitless is only contacted for things we don't have yet:
--   * the tournament list, once a day
--   * an event's standings, once when it first appears (and once a day while lists are still missing, up to 14 days)
--   * each deck list, once (a few per run, so requests are spread out)

create table if not exists public.tournaments (
  id int primary key,                    -- Limitless tournament id
  name text not null,
  date date not null,
  country text not null default '',
  players int,
  kind text not null check (kind in ('regional', 'international', 'worlds')),
  format text not null default 'standard',
  status text not null default 'new' check (status in ('new', 'lists', 'done')),
  first_seen timestamptz not null default now(),
  standings_at timestamptz,
  done_at timestamptz
);
create index if not exists tournaments_date on public.tournaments (date desc);

create table if not exists public.tournament_decks (
  tournament_id int not null references public.tournaments(id) on delete cascade,
  place int not null,
  player text not null default '',
  country text not null default '',
  archetype text not null default '',
  list_id int,                           -- Limitless deck list id (null until posted)
  cards jsonb,                           -- same shape as decks.cards; null until fetched
  missing text[] not null default '{}',  -- list lines we couldn't match to a card
  card_count int,
  price numeric,
  fetched_at timestamptz,
  attempts int not null default 0,
  primary key (tournament_id, place)
);
create index if not exists tournament_decks_archetype on public.tournament_decks (archetype);

alter table public.tournaments enable row level security;
alter table public.tournament_decks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'tournaments' and policyname = 'Tournaments are public') then
    create policy "Tournaments are public" on public.tournaments for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tournament_decks' and policyname = 'Tournament decks are public') then
    create policy "Tournament decks are public" on public.tournament_decks for select using (true);
  end if;
end $$;
grant select on public.tournaments, public.tournament_decks to anon, authenticated;

-- Requests sent with pg_net; handled_at is set once the response has been read.
-- (Note: 'place', not 'placing', which is a reserved word.)
create table if not exists public.tourney_fetch (
  net_id bigint primary key,
  kind text not null check (kind in ('index', 'standings', 'list')),
  tournament_id int,
  place int,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);
alter table public.tourney_fetch enable row level security;
revoke all on public.tourney_fetch from anon, authenticated;

create or replace function public.tourney_kind(n text) returns text
language sql immutable as $$
  select case
    when n ~* '^world championships' then 'worlds'
    when n ~* '(international championship|^(naic|euic|laic|ocic|maic)\M)' then 'international'
    when n ~* '^regional\M' then 'regional'
  end
$$;

create or replace function public.tourney_get(p_kind text, p_url text, p_tid int default null, p_place int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmark-tcg.mpr0317.workers.dev; daily cache)'),
    timeout_milliseconds := 20000);
  insert into public.tourney_fetch (net_id, kind, tournament_id, place) values (nid, p_kind, p_tid, p_place);
end $$;

-- Reads one finished response and stores what it contains.
create or replace function public.tourney_read(f public.tourney_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_name text; v_kind text; v_id int; lines jsonb := '[]'; i int := 0;
  v_cards jsonb; v_miss text[]; v_cnt int; v_pr numeric;
begin
  if f.kind = 'index' then
    for ch in select x from regexp_split_to_table(body, '<tr data-date=') x offset 1 loop
      v_name := substring(ch from 'data-name="([^"]+)"');
      v_kind := public.tourney_kind(v_name);
      v_id := substring(ch from 'href="/tournaments/(\d+)"')::int;
      continue when v_kind is null or v_id is null or coalesce(substring(ch from 'data-format="([^"]*)"'), '') <> 'standard';
      insert into public.tournaments (id, name, date, country, players, kind, format)
      values (v_id, replace(v_name, '&amp;', '&'), substring(ch from '^"(\d{4}-\d{2}-\d{2})"')::date,
              coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
              nullif(substring(ch from 'data-players="(\d+)"'), '')::int, v_kind, 'standard')
      on conflict (id) do update set players = excluded.players;
    end loop;

  elsif f.kind = 'standings' then
    for ch in select x from regexp_split_to_table(body, '<tr data-rank=') x offset 1 loop
      i := substring(ch from '^"(\d+)"')::int;
      exit when i is null or i > 32;
      insert into public.tournament_decks (tournament_id, place, player, country, archetype, list_id)
      values (f.tournament_id, i,
        replace(coalesce(substring(ch from 'data-name="([^"]*)"'), ''), '&amp;', '&'),
        coalesce(substring(ch from 'data-country="([^"]*)"'), ''),
        replace(coalesce(substring(ch from 'data-deck="([^"]*)"'), ''), '&amp;', '&'),
        substring(ch from 'href="/decks/list/(\d+)"')::int)
      on conflict (tournament_id, place) do update set
        player = excluded.player, country = excluded.country, archetype = excluded.archetype,
        list_id = coalesce(excluded.list_id, tournament_decks.list_id);
    end loop;
    update public.tournaments set standings_at = now(), status = case when status = 'new' then 'lists' else status end
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
  end if;
end $$;

-- Runs every 10 minutes. Reads finished responses, then sends at most a handful of new requests.
create or replace function public.tourney_tick() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.tourney_fetch; resp record; sent int := 0; budget int := 6; ev record; dl record; last_index timestamptz;
begin
  -- 1. read finished responses
  for f in select * from public.tourney_fetch where handled_at is null order by created_at loop
    select status_code, content, timed_out, error_msg into resp from net._http_response where id = f.net_id;
    if not found then
      if f.created_at < now() - interval '1 hour' then update public.tourney_fetch set handled_at = now() where net_id = f.net_id; end if;
      continue;
    end if;
    begin
      if resp.status_code = 200 and resp.content is not null then perform public.tourney_read(f, resp.content);
      elsif f.kind = 'list' then update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      end if;
    exception when others then raise warning 'tourney_read % failed: %', f.kind, sqlerrm;
    end;
    update public.tourney_fetch set handled_at = now() where net_id = f.net_id;
  end loop;

  -- nothing new while requests are still out
  if exists (select 1 from public.tourney_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.tourney_fetch where handled_at is null));
  end if;

  -- 2. the tournament list, once a day
  select value::timestamptz into last_index from public.app_settings where key = 'tourney_index_at';
  if last_index is null or last_index < now() - interval '23 hours' then
    perform public.tourney_get('index', 'https://limitlesstcg.com/tournaments');
    insert into public.app_settings (key, value) values ('tourney_index_at', now()::text)
      on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 3. standings: new events (only recent ones), and once a day for events still missing lists (up to 14 days)
  for ev in select * from public.tournaments
           where date >= current_date - 120
             and (status = 'new'
               or (status = 'lists' and standings_at < now() - interval '23 hours' and date >= current_date - 14
                   and exists (select 1 from public.tournament_decks d where d.tournament_id = tournaments.id and d.list_id is null)))
           order by date desc limit greatest(0, 2 - sent) loop
    perform public.tourney_get('standings', 'https://limitlesstcg.com/tournaments/' || ev.id, ev.id);
    sent := sent + 1;
  end loop;

  -- 4. deck lists we don't have yet (a few per run); give up on a list after 3 failed tries
  for dl in select dd.* from public.tournament_decks dd join public.tournaments tt on tt.id = dd.tournament_id
           where dd.list_id is not null and dd.cards is null and dd.attempts < 3
           order by tt.date desc, dd.place limit greatest(0, budget - sent) loop
    perform public.tourney_get('list', 'https://limitlesstcg.com/decks/list/' || dl.list_id, dl.tournament_id, dl.place);
    sent := sent + 1;
  end loop;

  -- 5. events with every top-32 list in hand, or past their 14-day window, are done
  update public.tournaments t set status = 'done', done_at = now()
   where status = 'lists'
     and (not exists (select 1 from public.tournament_decks d where d.tournament_id = t.id and (d.list_id is null or (d.cards is null and d.attempts < 3)))
          or (t.date < current_date - 14 and not exists (select 1 from public.tournament_decks d where d.tournament_id = t.id and d.list_id is not null and d.cards is null and d.attempts < 3)));

  return jsonb_build_object('sent', sent);
end $$;
revoke execute on function public.tourney_tick() from public, anon, authenticated;
revoke execute on function public.tourney_read(public.tourney_fetch, text) from public, anon, authenticated;
revoke execute on function public.tourney_get(text, text, int, int) from public, anon, authenticated;

-- What's winning: archetypes across top-32s of events in the last N days.
create or replace function public.tourney_meta(days int default 60)
returns table (archetype text, top32 bigint, top8 bigint, wins bigint, events bigint, best_tournament int, best_place int)
language sql stable set search_path = public as $$
  with d as (
    select d.*, t.date from public.tournament_decks d join public.tournaments t on t.id = d.tournament_id
    where t.date >= current_date - least(greatest(days, 7), 400) and d.archetype <> ''
  ), best as (
    select distinct on (archetype) archetype, tournament_id, place from d
    where cards is not null order by archetype, place, date desc
  )
  select d.archetype, count(*), count(*) filter (where d.place <= 8), count(*) filter (where d.place = 1),
         count(distinct d.tournament_id), b.tournament_id, b.place
  from d left join best b using (archetype)
  group by d.archetype, b.tournament_id, b.place
  order by count(*) desc, count(*) filter (where d.place <= 8) desc
$$;
grant execute on function public.tourney_meta(int) to anon, authenticated;

create or replace function public.html_text(s text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(replace(coalesce(s, ''),
    '&#039;', ''''), '&#39;', ''''), '&quot;', '"'), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
$$;
create or replace function public.tourney_decks_text() returns trigger
language plpgsql set search_path = public as $$
begin
  new.player := public.html_text(new.player);
  new.archetype := public.html_text(new.archetype);
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tournament_decks_text') then
    create trigger tournament_decks_text before insert or update on public.tournament_decks
      for each row execute function public.tourney_decks_text();
  end if;
end $$;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'benchmark-tournaments') then
    perform cron.schedule('benchmark-tournaments', '*/10 * * * *', 'select public.tourney_tick()');
  end if;
end $$;
