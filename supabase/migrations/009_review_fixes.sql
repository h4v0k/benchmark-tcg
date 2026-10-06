-- Review council follow-ups.

-- Card count and price are worked out by the database, not trusted from the browser.
create or replace function public.guard_like_count() returns trigger
language plpgsql set search_path = public as $$
declare bump boolean := coalesce(current_setting('benchmark.counter_bump', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.like_count := 0; new.view_count := 0; new.comment_count := 0; new.featured := false;
  elsif not bump then
    new.like_count := old.like_count;
    new.view_count := old.view_count;
    new.comment_count := old.comment_count;
    new.featured := old.featured;
    new.owner := old.owner;
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

-- Fill card_names, card_count and price for decks saved before the rebuild.
-- (Setting cards to itself re-runs the trigger without touching updated_at.)
update public.decks set cards = cards;

-- Simple per-user write limits.
create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; lim int; win interval; who uuid := auth.uid();
begin
  if who is null then return new; end if;
  if tg_table_name = 'deck_comments' then
    select count(*) into n from public.deck_comments where user_id = who and created_at > now() - interval '1 minute';
    if n >= 6 then raise exception 'You''re commenting too fast. Wait a minute and try again.'; end if;
    select count(*) into n from public.deck_comments where user_id = who and created_at > now() - interval '1 day';
    if n >= 300 then raise exception 'Daily comment limit reached.'; end if;
  elsif tg_table_name = 'decks' then
    select count(*) into n from public.decks where owner = who and created_at > now() - interval '1 hour';
    if n >= 40 then raise exception 'You''ve made a lot of decks in the last hour. Try again later.'; end if;
  elsif tg_table_name = 'follows' then
    select count(*) into n from public.follows where follower = who and created_at > now() - interval '1 hour';
    if n >= 100 then raise exception 'Follow limit reached for now. Try again later.'; end if;
  end if;
  return new;
end $$;
revoke execute on function public.rate_limit() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'deck_comments_rate') then
    create trigger deck_comments_rate before insert on public.deck_comments for each row execute function public.rate_limit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'decks_rate') then
    create trigger decks_rate before insert on public.decks for each row execute function public.rate_limit();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'follows_rate') then
    create trigger follows_rate before insert on public.follows for each row execute function public.rate_limit();
  end if;
end $$;

-- YouTube imports: signed-in users only, and the count-then-insert is serialized.
create or replace function public.youtube_request(p_video text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare rid uuid; nid bigint;
begin
  if auth.uid() is null then raise exception 'Sign in to import from YouTube.'; end if;
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'That is not a YouTube video id'; end if;
  perform pg_advisory_xact_lock(hashtext('benchmark.youtube_request'));
  if (select count(*) from public.import_requests where created_at > now() - interval '1 hour' and requested_by = auth.uid()) >= 30
     or (select count(*) from public.import_requests where created_at > now() - interval '1 hour') >= 300 then
    raise exception 'Too many imports right now. Try again in a little while.';
  end if;
  nid := net.http_get(
    url := 'https://www.youtube.com/watch?v=' || p_video || '&hl=en',
    headers := jsonb_build_object('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
                                  'Accept-Language', 'en-US,en;q=0.9', 'Cookie', 'SOCS=CAI; CONSENT=YES+1'),
    timeout_milliseconds := 15000);
  insert into public.import_requests (video_id, net_id) values (p_video, nid) returning id into rid;
  return rid;
end $$;
revoke execute on function public.youtube_request(text) from public, anon;
grant execute on function public.youtube_request(text) to authenticated;

-- Cards used in decks get their details first during the catalog backfill.
create or replace function public.cards_needing_detail(lim int, recent_from date)
returns table (id text)
language sql stable security definer set search_path = public as $$
  select q.id from (
    select c.id, -1 as pri, s.release_date as rel
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at is null and not s.hidden
        and exists (select 1 from public.decks d where d.cards @> jsonb_build_array(jsonb_build_object('cid', c.id)))
    union all
    select c.id, 0, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id where c.detail_at is null and not s.hidden
    union all
    select c.id, 1, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '2 days' and s.release_date >= recent_from and not s.hidden
    union all
    select c.id, 2, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '45 days' and not s.hidden
  ) q
  group by q.id
  order by min(q.pri), max(q.rel) desc nulls first, q.id
  limit greatest(1, least(lim, 400))
$$;
