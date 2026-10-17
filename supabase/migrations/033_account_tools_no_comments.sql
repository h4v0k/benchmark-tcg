-- 033: remove deck comments for good; account tools (change username, export my data, delete my account).

-- 1. Comments. The two shared trigger functions mentioned them, so they are rewritten without that part first.
create or replace function public.rate_limit() returns trigger language plpgsql security definer set search_path = public as $fn$
declare n int; who uuid := auth.uid();
begin
  if who is null then return new; end if;
  -- For people using the site, the server's clock decides when a row was made; a client-sent created_at
  -- would dodge the limits below. (Server jobs and restores, which have no signed-in user, keep their own.)
  new.created_at := now();
  if tg_table_name = 'decks' then
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
end $fn$;

create or replace function public.guard_like_count() returns trigger language plpgsql set search_path = public as $fn$
-- The bump switch is only honoured inside our own server-side functions, never for the site's own roles.
declare bump boolean := coalesce(current_setting('benchmark.counter_bump', true), '') = 'on' and current_user not in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    new.like_count := 0; new.view_count := 0; new.featured := false;
    if current_user in ('anon', 'authenticated') then new.created_at := now(); new.updated_at := now(); end if;
  elsif not bump then
    new.like_count := old.like_count;
    new.view_count := old.view_count;
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
  -- People can't set updated_at themselves (it orders the 'recently updated' list); it moves only when the list or name changes.
  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then new.updated_at := old.updated_at; end if;
  if tg_op = 'UPDATE' and (new.cards is distinct from old.cards or new.name is distinct from old.name) then
    new.updated_at := now();
  end if;
  return new;
end $fn$;

drop trigger if exists deck_comments_bump on public.deck_comments;
drop trigger if exists deck_comments_rate on public.deck_comments;
drop table if exists public.deck_comments cascade;
drop function if exists public.bump_comment_count();
alter table public.decks drop column if exists comment_count;

-- 2. Username changes: once every 7 days.
alter table public.profiles add column if not exists username_changed_at timestamptz;

create or replace function public.change_username(p_new text) returns text language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); last timestamptz; cur text;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_new is null or p_new !~ '^[A-Za-z0-9_]{3,20}$' then raise exception '3 to 20 letters, numbers or underscores.'; end if;
  select username, username_changed_at into cur, last from public.profiles where id = me for update;
  if not found then raise exception 'No profile yet.'; end if;
  if cur = p_new then return cur; end if;
  if last is not null and last > now() - interval '7 days' then
    raise exception 'You can change your username once every 7 days. Try again on %.', to_char(last + interval '7 days', 'Mon DD');
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_new) and id <> me) then raise exception 'That username is taken.'; end if;
  update public.profiles set username = p_new, username_changed_at = now() where id = me;
  return p_new;
end $fn$;
revoke execute on function public.change_username(text) from public, anon;
grant execute on function public.change_username(text) to authenticated;

-- 3. Download my data. Only the caller's own rows; ip_hash is left out of issue reports.
create or replace function public.export_my_data() returns jsonb language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid(); out jsonb;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at) from auth.users u where u.id = me),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = me),
    'decks', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.decks d where d.owner = me), '[]'),
    'folders', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.folders f where f.owner = me), '[]'),
    'liked_decks', coalesce((select jsonb_agg(jsonb_build_object('deck_id', l.deck_id, 'created_at', l.created_at) order by l.created_at) from public.deck_likes l where l.user_id = me), '[]'),
    'following', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'created_at', f.created_at)) from public.follows f join public.profiles p on p.id = f.followee where f.follower = me), '[]'),
    'followers', coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'created_at', f.created_at)) from public.follows f join public.profiles p on p.id = f.follower where f.followee = me), '[]'),
    'printing_preferences', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'card_id', x.card_id, 'created_at', x.created_at)) from public.printing_prefs x where x.user_id = me), '[]'),
    'tournament_registration', (select jsonb_build_object('player_name', i.player_name, 'player_id', i.player_id, 'updated_at', i.updated_at) from public.player_info i where i.user_id = me),
    'issue_reports', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'message', r.message, 'contact_email', r.contact_email, 'page_url', r.page_url) order by r.created_at) from public.issue_reports r where r.user_id = me), '[]')
  ) into out;
  return out;
end $fn$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- 4. Delete my account. Profiles, decks, folders, likes, follows, preferences and registration details cascade
-- from auth.users; issue reports are kept without the link to the person.
create or replace function public.delete_my_account() returns void language plpgsql security definer set search_path = public as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first.'; end if;
  update public.issue_reports set user_id = null where user_id = me;
  delete from auth.users where id = me;
end $fn$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
