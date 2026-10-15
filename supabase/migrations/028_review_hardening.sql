-- Pre-launch review fixes (Oct 2026).
--  1. Rate limits can't be dodged by backdating created_at; likes get a limit too.
--  2. Decks: id and created_at can't be changed by their owner; counter/profile guards only trust
--     the internal "bump" switch when it comes from our own server-side functions.
--  3. Anonymous view counting is capped per deck per day (no more inflating view counts).
--  4. Table permissions trimmed to what the site uses; RLS stays as the second line of defence.
--  5. A set with no legal date yet is not Standard legal (it used to count as legal right away).
--  6. Tournament and Japan collectors stop retrying a failing page after 3 tries; old stuck events close.
--  7. Decklist matching rejects absurdly long inputs; small hardening (jp_points search_path, report policy).

create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; lim int; win interval; who uuid := auth.uid();
begin
  -- The server's clock decides when a row was made; a client-sent created_at would dodge the limits below.
  new.created_at := now();
  if who is null then return new; end if;
  if tg_table_name = 'deck_comments' then
    select count(*) into n from public.deck_comments where user_id = who and created_at > now() - interval '1 minute';
    if n >= 6 then raise exception 'You''re commenting too fast. Wait a minute and try again.'; end if;
    select count(*) into n from public.deck_comments where user_id = who and created_at > now() - interval '1 day';
    if n >= 300 then raise exception 'Daily comment limit reached.'; end if;
  elsif tg_table_name = 'decks' then
    select count(*) into n from public.decks where owner = who and created_at > now() - interval '1 hour';
    if n >= 40 then raise exception 'You''ve made a lot of decks in the last hour. Try again later.'; end if;
  elsif tg_table_name = 'deck_likes' then
    select count(*) into n from public.deck_likes where user_id = who and created_at > now() - interval '1 minute';
    if n >= 30 then raise exception 'You''re liking too fast. Wait a minute and try again.'; end if;
  elsif tg_table_name = 'follows' then
    select count(*) into n from public.follows where follower = who and created_at > now() - interval '1 hour';
    if n >= 100 then raise exception 'Follow limit reached for now. Try again later.'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.rate_limit() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'deck_likes_rate') then
    create trigger deck_likes_rate before insert on public.deck_likes for each row execute function public.rate_limit();
  end if;
end $$;

create or replace function public.guard_like_count() returns trigger
language plpgsql set search_path = public as $$
-- The bump switch is only honoured inside our own server-side functions, never for the site's own roles.
declare bump boolean := coalesce(current_setting('benchmark.counter_bump', true), '') = 'on' and current_user not in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    new.like_count := 0; new.view_count := 0; new.comment_count := 0; new.featured := false;
    if current_user in ('anon', 'authenticated') then new.created_at := now(); new.updated_at := now(); end if;
  elsif not bump then
    new.like_count := old.like_count;
    new.view_count := old.view_count;
    new.comment_count := old.comment_count;
    new.featured := old.featured;
    new.owner := old.owner;
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  -- Always derived from cards, whatever the browser sent.
  begin
    new.card_names := coalesce((select array_agg(distinct x->>'name') from jsonb_array_elements(new.cards) x where x->>'name' is not null), '{}');
    select coalesce(sum(least(greatest((x->>'qty')::int, 0), 60)), 0),
           coalesce(round(sum(least(greatest((x->>'qty')::int, 0), 60) * coalesce(
             (c.prices->>coalesce(nullif(x->>'variant', ''), 'normal'))::numeric,
             (c.prices->>'normal')::numeric, (c.prices->>'holo')::numeric, (c.prices->>'reverse')::numeric, 0)), 2), 0)
      into new.card_count, new.price
      from jsonb_array_elements(new.cards) x
      left join public.cards c on c.id = x->>'cid'
      where coalesce(x->>'board', 'main') = 'main' and (x->>'qty') ~ '^\d{1,3}$';
  end;
  new.tags := coalesce((select array_agg(distinct lower(btrim(t))) from unnest(new.tags) t where btrim(t) <> '' and char_length(btrim(t)) <= 24), '{}');
  if new.folder_id is not null and not exists (select 1 from public.folders f where f.id = new.folder_id and f.owner = new.owner) then
    new.folder_id := null;
  end if;
  if tg_op = 'UPDATE' and (new.cards is distinct from old.cards or new.name is distinct from old.name) then
    new.updated_at := now();
  end if;
  return new;
end $$;
create or replace function public.guard_profile_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('benchmark.profile_bump', true), '') = 'on' and current_user not in ('anon', 'authenticated') then return new; end if;
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.is_admin := false; new.follower_count := 0; new.following_count := 0;
    else
      new.is_admin := old.is_admin;
      new.follower_count := old.follower_count;
      new.following_count := old.following_count;
      new.username := old.username;
      new.id := old.id;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
create or replace function public.record_view(p_deck uuid, p_viewer text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := coalesce(auth.uid()::text, 'a:' || left(coalesce(p_viewer, ''), 64));
begin
  if v = 'a:' then return; end if;
  if not exists (select 1 from public.decks where id = p_deck and (is_public or owner = auth.uid())) then return; end if;
  -- Signed-out viewers are identified by a browser-made id, so cap how many of them one deck can count per day.
  if auth.uid() is null and (select count(*) from public.deck_views where deck_id = p_deck and day = current_date and viewer like 'a:%') >= 50 then return; end if;
  insert into public.deck_views (deck_id, viewer) values (p_deck, v) on conflict do nothing;
  if found then
    perform set_config('benchmark.counter_bump', 'on', true);
    update public.decks set view_count = view_count + 1 where id = p_deck and owner is distinct from auth.uid();
    perform set_config('benchmark.counter_bump', 'off', true);
  end if;
end $$;

-- Never needed through the API.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t);
    -- Signed-out visitors only read; every anonymous write goes through a checked function.
    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;
-- Internal tables: no API access at all (the jobs and functions that use them run as the owner).
revoke all on public.app_settings, public.deck_views, public.import_requests, public.tourney_fetch,
  public.tcgp_groups, public.tcgp_group_sync, public.tcgp_products from anon, authenticated;
-- Data only the sync jobs write: readable, not writable, by signed-in users.
revoke insert, update, delete on public.cards, public.sets, public.set_codes, public.tournaments,
  public.tournament_decks, public.archetypes, public.format_rules, public.rule_changes, public.sync_runs
  from authenticated;
-- New tables start without the unneeded privileges too.
do $$ begin
  alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
exception when others then raise notice 'default privileges unchanged: %', sqlerrm;
end $$;

create or replace function public.recompute_legality()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  std_mark text;
  exp_from date;
  nxt record;
  res jsonb;
  newest_date date;
  newest_mark text;
begin
  select greatest(fr.min_mark, coalesce((select max(r.new_min_mark) from public.rotations r where r.effective_date <= current_date), fr.min_mark))
    into std_mark from public.format_rules fr where fr.format = 'standard';
  select min_release into exp_from from public.format_rules where format = 'expanded';
  select * into nxt from public.rotations r
    where r.new_min_mark > std_mark and (r.effective_date is null or r.effective_date > current_date)
    order by r.new_min_mark limit 1;
  select s.release_date, s.reg_mark into newest_date, newest_mark from public.sets s
    where s.reg_mark ~ '^[A-Z]$' and not s.hidden and not s.is_classic
    order by s.release_date desc nulls last, s.reg_mark desc limit 1;

  with base as (
    select c.id, c.name, c.sig, c.category, c.is_basic_energy, s.is_classic, s.legal_date,
           coalesce(nullif(c.reg_mark, ''),
                    case when not c.is_basic_energy then nullif(s.reg_mark, '') end,
                    case when not c.is_basic_energy and not s.hidden and not s.is_classic
                              and s.release_date >= newest_date then newest_mark end,
                    '') as mark,
           -- A set with no legal date yet isn't live (it used to be, so an undated new set went legal at once).
           -- Sets we've had for 60+ days without a date are old sets and count as live.
           (coalesce(s.legal_date <= current_date, false) or (s.legal_date is null and s.created_at < now() - interval '60 days')) as live,
           (s.release_date is not null and s.release_date >= exp_from) as exp_era,
           c.legal_standard as old_std
    from public.cards c join public.sets s on s.id = c.set_id
  ), f as (
    select base.*,
           (mark ~ '^[A-Z]$' and mark >= std_mark) as mark_ok,
           (nxt.new_min_mark is null or (mark ~ '^[A-Z]$' and mark >= nxt.new_min_mark)) as mark_next
    from base
  ), g as (
    select sig, bool_or(live and mark_ok) as a_std, bool_or(mark_ok and mark_next) as a_next, bool_or(live and exp_era) as a_exp
    from f where sig <> '' group by sig
  ), bn as (
    select x.card_id, array_agg(distinct b.format order by b.format) as formats
    from public.bans b cross join lateral unnest(b.card_ids) as x(card_id)
    where b.active and (b.effective_date is null or b.effective_date <= current_date)
    group by x.card_id
  ), r0 as (
    select f.id, f.name, f.old_std, coalesce(bn.formats, '{}') as banned,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.mark_ok and (f.live or coalesce(g.a_std, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_std, false) or (f.live and f.mark_ok)))
      ) as std_raw,
      (not f.is_classic) and (
        f.is_basic_energy
        or (f.category = 'Pokemon' and f.mark_ok and f.mark_next)
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_next, false) or (f.mark_ok and f.mark_next)))
      ) as std_next,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.exp_era and (f.live or coalesce(g.a_exp, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_exp, false) or (f.live and f.exp_era)))
      ) as exp_raw,
      f.live, f.mark_ok, f.is_classic, f.legal_date
    from f left join g on g.sig = f.sig left join bn on bn.card_id = f.id
  ), r as (
    select r0.*,
      (r0.std_raw and not ('standard' = any(r0.banned))) as std,
      (r0.exp_raw and not ('expanded' = any(r0.banned))) as exp,
      (r0.std_raw and not r0.std_next) as rot,
      case when not r0.std_raw and not r0.live and r0.mark_ok and not r0.is_classic then r0.legal_date end as std_from
    from r0
  ), upd as (
    update public.cards c set
      legal_standard = r.std,
      legal_expanded = r.exp,
      rotating = r.rot,
      rotating_on = case when r.rot then nxt.effective_date end,
      standard_from = r.std_from,
      banned_in = r.banned
    from r
    where r.id = c.id and (
      c.legal_standard is distinct from r.std
      or c.legal_expanded is distinct from r.exp
      or c.rotating is distinct from r.rot
      or c.rotating_on is distinct from (case when r.rot then nxt.effective_date end)
      or c.standard_from is distinct from r.std_from
      or c.banned_in is distinct from r.banned)
    returning c.id
  )
  select jsonb_build_object(
    'updated', (select count(*) from upd),
    'standard_legal', (select count(*) from r where r.std),
    'standard_min_mark', std_mark,
    'next_rotation', case when nxt.id is null then null else jsonb_build_object('mark', nxt.new_min_mark, 'date', nxt.effective_date) end,
    'became_legal', coalesce((select jsonb_agg(distinct r.name) from r where r.std and not r.old_std), '[]'),
    'became_illegal', coalesce((select jsonb_agg(distinct r.name) from r where not r.std and r.old_std), '[]'))
  into res;
  return res;
end $function$;
alter table public.tournaments add column if not exists standings_tries int not null default 0;

create or replace function public.tourney_read(f public.tourney_fetch, body text)
returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_name text; v_kind text; v_id int; lines jsonb := '[]'; i int := 0; n int := 0;
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
  end if;
end $$;
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
      elsif f.kind = 'standings' then update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
      if resp.status_code = 429 then
        insert into public.app_settings (key, value) values ('tourney_pause_until', (now() + interval '6 hours')::text) on conflict (key) do update set value = excluded.value;
      end if;
    exception when others then
      raise warning 'tourney_read % failed: %', f.kind, sqlerrm;
      -- a page we can't read counts as a try, so it isn't fetched again forever
      if f.kind = 'list' then update public.tournament_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
    end;
    update public.tourney_fetch set handled_at = now() where net_id = f.net_id;
  end loop;

  -- nothing new while requests are still out
  if exists (select 1 from public.tourney_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.tourney_fetch where handled_at is null));
  end if;

  -- Limitless asked us to slow down (429): send nothing until the pause is over.
  if coalesce((select value::timestamptz from public.app_settings where key = 'tourney_pause_until'), '-infinity') > now() then
    return jsonb_build_object('paused', true);
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
             and ((status = 'new' and standings_tries < 3 and (standings_at is null or standings_at < now() - interval '23 hours'))
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

  -- events that never yield standings (3 tries) or are too old to fetch are closed
  update public.tournaments set status = 'done', done_at = now()
   where status = 'new' and (standings_tries >= 3 or date < current_date - 120);

  return jsonb_build_object('sent', sent);
end $$;
create or replace function public.jp_tick(budget int default 3) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare f public.jp_fetch; resp record; sent int := 0; ev record; dl record; since date := public.jp_since();
  last_index timestamptz; last_majors timestamptz; back int; seen timestamptz; ix record; majors int := 0; oldest date;
begin
  -- one run at a time (the normal job and the catch-up can land on the same minute)
  if not pg_try_advisory_xact_lock(hashtext('benchmark-jp-tick')) then return jsonb_build_object('busy', true); end if;
  budget := least(greatest(budget, 1), 6);

  -- 1. read finished responses
  for f in select * from public.jp_fetch where handled_at is null order by created_at loop
    select status_code, content into resp from net._http_response where id = f.net_id;
    if not found then
      if f.created_at < now() - interval '1 hour' then update public.jp_fetch set handled_at = now() where net_id = f.net_id; end if;
      continue;
    end if;
    begin
      if resp.status_code = 200 and resp.content is not null then perform public.jp_read(f, resp.content);
      elsif f.kind = 'list' then update public.jp_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.jp_tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
      if resp.status_code = 429 then
        insert into public.app_settings (key, value) values ('jp_pause_until', (now() + interval '6 hours')::text) on conflict (key) do update set value = excluded.value;
      end if;
    exception when others then
      raise warning 'jp_read % failed: %', f.kind, sqlerrm;
      if f.kind = 'list' then update public.jp_decks set attempts = attempts + 1 where tournament_id = f.tournament_id and place = f.place;
      elsif f.kind = 'standings' then update public.jp_tournaments set standings_at = now(), standings_tries = standings_tries + 1 where id = f.tournament_id;
      end if;
    end;
    update public.jp_fetch set handled_at = now() where net_id = f.net_id;
  end loop;

  -- 2. majors from the main tournament list the other job downloaded (no request of our own)
  select value::timestamptz into seen from public.app_settings where key = 'jp_majors_seen';
  for ix in select tf.created_at, r.content from public.tourney_fetch tf join net._http_response r on r.id = tf.net_id
            where tf.kind = 'index' and tf.handled_at is not null and r.status_code = 200
              and tf.created_at > coalesce(seen, '-infinity'::timestamptz)
            order by tf.created_at loop
    begin majors := majors + public.jp_read_majors(ix.content);
    exception when others then raise warning 'jp_read_majors failed: %', sqlerrm;
    end;
    insert into public.app_settings (key, value) values ('jp_majors_seen', ix.created_at::text)
      on conflict (key) do update set value = excluded.value;
  end loop;

  if exists (select 1 from public.jp_fetch where handled_at is null) then
    return jsonb_build_object('waiting', (select count(*) from public.jp_fetch where handled_at is null));
  end if;

  if coalesce((select value::timestamptz from public.app_settings where key = 'jp_pause_until'), '-infinity') > now() then
    return jsonb_build_object('paused', true);
  end if;

  -- 3. City League list: newest 100 daily; step back a page at a time until we reach jp_since
  select value::timestamptz into last_index from public.app_settings where key = 'jp_index_at';
  select value::int into back from public.app_settings where key = 'jp_index_back';
  back := coalesce(back, 1);
  select min(date) into oldest from public.jp_tournaments where kind = 'city_league';
  if last_index is null or last_index < now() - interval '23 hours' then
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100');
    insert into public.app_settings (key, value) values ('jp_index_at', now()::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  elsif back < 12 and (oldest is null or oldest >= since) then
    back := back + 1;
    perform public.jp_get('index', 'https://limitlesstcg.com/tournaments/jp?show=100&page=' || back);
    insert into public.app_settings (key, value) values ('jp_index_back', back::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 4. main tournament list once a week, for Champions League events
  select value::timestamptz into last_majors from public.app_settings where key = 'jp_majors_at';
  if sent < budget and (last_majors is null or last_majors < now() - interval '7 days') then
    perform public.jp_get('majors', 'https://limitlesstcg.com/tournaments?show=100');
    insert into public.app_settings (key, value) values ('jp_majors_at', now()::text) on conflict (key) do update set value = excluded.value;
    sent := sent + 1;
  end if;

  -- 5. standings: events since jp_since, majors first, newest first; retry a day later, 3 tries
  for ev in select * from public.jp_tournaments
           where status = 'new' and date >= since and standings_tries < 3
             and (standings_at is null or standings_at < now() - interval '23 hours')
           order by (kind = 'major') desc, date desc limit greatest(0, least(2, budget - sent)) loop
    perform public.jp_get('standings',
      case when ev.kind = 'major' then 'https://limitlesstcg.com/tournaments/' || ev.src_id
           else 'https://limitlesstcg.com/tournaments/jp/' || ev.src_id end, ev.id);
    sent := sent + 1;
  end loop;

  -- 6. deck lists up to 32nd: best placings first across all events (wins, then 2nds...), majors and newer first within a place
  for dl in select d.tournament_id, d.place, d.list_ref from public.jp_decks d join public.jp_tournaments t on t.id = d.tournament_id
           where t.date >= since and d.list_ref is not null and d.cards is null and d.attempts < 3 and d.place <= 32
           order by public.jp_points(d.place) desc, (t.kind = 'major') desc, t.date desc, d.place
           limit greatest(0, budget - sent) loop
    perform public.jp_get('list', 'https://limitlesstcg.com/decks/list/' || dl.list_ref, dl.tournament_id, dl.place);
    sent := sent + 1;
  end loop;

  -- 7. finished events
  update public.jp_tournaments t set status = 'done', done_at = now()
   where status <> 'done' and (
     (status = 'lists' and not exists (select 1 from public.jp_decks d where d.tournament_id = t.id and d.list_ref is not null
        and d.cards is null and d.attempts < 3 and d.place <= 32))
     or (status = 'new' and (standings_tries >= 3 or date < since)));
  delete from public.jp_fetch where handled_at < now() - interval '7 days';

  return jsonb_build_object('sent', sent, 'majors', majors);
end $$;
revoke execute on function public.jp_tick(int) from public, anon, authenticated;

create or replace function public.resolve_decklist_v2(lines jsonb, fmt text default 'standard', p_mode text default 'cheapest')
 returns table(i integer, card_id text, how text)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare l jsonb; nm text; cd text; nk text; sid text; cid text; how_ text; alt text[]; better text; cname text; csig text;
begin
  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) > 150 then raise exception 'A decklist can have at most 150 lines.'; end if;
  for l in select * from jsonb_array_elements(lines) loop
    nm := public.norm_name(l->>'name');
    cd := upper(coalesce(l->>'code', ''));
    nk := upper(regexp_replace(split_part(coalesce(l->>'num', ''), '/', 1), '^([A-Z]*)0*(\d+)([A-Z]?)$', '\1\2\3', 'i'));
    cid := null; how_ := null; sid := null; cname := null;
    alt := array[nm,
      regexp_replace(nm, '^basic ', ''),
      'basic ' || regexp_replace(nm, '^basic ', ''),
      regexp_replace(nm, ' energy energy$', ' energy'),
      regexp_replace(nm, '^basic (\w+) energy energy$', '\1 energy')];
    if cd <> '' then
      select s.id into sid from public.sets s where upper(s.code) = cd and not s.hidden and not s.is_classic order by s.release_date desc nulls last limit 1;
      if sid is null then select sc.set_id into sid from public.set_codes sc join public.sets s on s.id = sc.set_id where upper(sc.code) = cd and not s.hidden; end if;
    end if;
    if sid is not null and nk <> '' then
      select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk and c.name_norm = any(alt) limit 1;
      if cid is not null then how_ := 'exact'; end if;
      if cid is null then
        select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk limit 1;
        if cid is not null then how_ := 'number'; end if;
      end if;
    end if;
    if cid is null and sid is not null then
      select c.id into cid from public.cards c where c.set_id = sid and c.name_norm = any(alt)
        order by (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end) limit 1;
      if cid is not null then how_ := 'set'; end if;
    end if;
    if cid is null then
      -- No set given (or not found): any printing with this name.
      select c.name into cname from public.cards c join public.sets s on s.id = c.set_id
        where c.name_norm = any(alt) and not s.hidden
        order by (case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end) desc,
          s.is_classic, s.release_date desc nulls last
        limit 1;
      if cname is not null then
        cid := public.pick_printing(cname, fmt, null);
        if cid is not null then how_ := 'name'; end if;
      end if;
    elsif p_mode = 'cheapest' then
      -- Same card (same name and text), preferred or cheapest legal printing.
      select c.name, c.sig into cname, csig from public.cards c where c.id = cid;
      better := public.pick_printing(cname, fmt, nullif(csig, ''));
      if better is not null and better <> cid then cid := better; how_ := 'cheapest'; end if;
    end if;
    i := (l->>'i')::int; card_id := cid; how := how_;
    return next;
  end loop;
end $function$;
grant execute on function public.resolve_decklist_v2(jsonb, text, text) to anon, authenticated;
-- The old matcher isn't used by the site any more (pages call resolve_decklist_v2).
revoke execute on function public.resolve_decklist(jsonb, text) from public, anon, authenticated;
alter function public.jp_points(int) set search_path = public;
drop policy if exists issue_reports_admin_update on public.issue_reports;
create policy issue_reports_admin_update on public.issue_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
