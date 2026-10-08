-- Fixes from the Supabase security and performance advisors. Behavior is unchanged.

-- 1. Pin search_path on the remaining helper functions.
alter function public.card_price(jsonb) set search_path = public;
alter function public.tourney_kind(text) set search_path = public;
alter function public.html_text(text) set search_path = public;

-- 2. Evaluate auth.uid() once per query instead of once per row.
alter policy "Comment as yourself" on public.deck_comments
  with check (user_id = (select auth.uid()) and exists (select 1 from public.decks d
    where d.id = deck_comments.deck_id and (d.is_public or d.owner = (select auth.uid()))));
alter policy "Delete your comments or comments on your deck" on public.deck_comments
  using (user_id = (select auth.uid())
    or exists (select 1 from public.decks d where d.id = deck_comments.deck_id and d.owner = (select auth.uid()))
    or public.is_admin());
alter policy "Read comments on decks you can see" on public.deck_comments
  using (exists (select 1 from public.decks d
    where d.id = deck_comments.deck_id and (d.is_public or d.owner = (select auth.uid()))));
alter policy "Like public decks you don't own" on public.deck_likes
  with check (user_id = (select auth.uid()) and exists (select 1 from public.decks d
    where d.id = deck_likes.deck_id and d.is_public and d.owner <> (select auth.uid())));
alter policy "Remove your own likes" on public.deck_likes using (user_id = (select auth.uid()));
alter policy "Create your own decks" on public.decks with check (owner = (select auth.uid()));
alter policy "Delete your own decks" on public.decks using (owner = (select auth.uid()));
alter policy "Edit your own decks" on public.decks using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy "Read public decks and your own" on public.decks using (is_public or owner = (select auth.uid()));
alter policy "Your folders" on public.folders using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
alter policy "Follow as yourself" on public.follows with check (follower = (select auth.uid()));
alter policy "Unfollow as yourself" on public.follows using (follower = (select auth.uid()));
alter policy "own prefs" on public.printing_prefs using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy "Create your own profile" on public.profiles with check ((select auth.uid()) = id);
alter policy "Edit your own profile" on public.profiles using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- 3. Index foreign keys (faster deletes and per-user lookups).
create index if not exists deck_comments_user on public.deck_comments (user_id);
create index if not exists deck_likes_user on public.deck_likes (user_id);
create index if not exists decks_folder on public.decks (folder_id) where folder_id is not null;
create index if not exists printing_prefs_card on public.printing_prefs (card_id);
create index if not exists set_codes_set on public.set_codes (set_id);

-- 4. Bans and rotations: the admin policy covered SELECT too, overlapping the public read policy.
--    Split it into insert/update/delete so each action has exactly one policy.
do $$
declare t text;
begin
  foreach t in array array['bans', 'rotations'] loop
    execute format('drop policy if exists "Admins edit %s" on public.%I', t, t);
    execute format('drop policy if exists "Admins add %s" on public.%I', t, t);
    execute format('drop policy if exists "Admins change %s" on public.%I', t, t);
    execute format('drop policy if exists "Admins remove %s" on public.%I', t, t);
    execute format('create policy "Admins add %s" on public.%I for insert with check (public.is_admin())', t, t);
    execute format('create policy "Admins change %s" on public.%I for update using (public.is_admin()) with check (public.is_admin())', t, t);
    execute format('create policy "Admins remove %s" on public.%I for delete using (public.is_admin())', t, t);
  end loop;
end $$;

-- 5. Matchup deck list: add up results per deck first, then look up names (same output).
create or replace function public.matchup_decks(p_source text default 'online', p_days int default 30)
returns table (deck text, name text, icons text[], games bigint, wins bigint, losses bigint, ties bigint, win_pct numeric, events bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select r.deck, sum(r.wins + r.losses + r.ties) g, sum(r.wins) w, sum(r.losses) l, sum(r.ties) t, count(distinct r.event_id) ev
    from public.mu_results r
    join public.mu_events e on e.source = r.source and e.event_id = r.event_id
    where r.source = p_source and e.status = 'done' and r.deck <> r.opp and e.date >= current_date - least(greatest(p_days, 7), 180)
    group by r.deck
    having sum(r.wins + r.losses + r.ties) >= 10
  )
  select s.deck, coalesce(a.name, s.deck), coalesce(a.icons, '{}'), s.g, s.w, s.l, s.t,
    round(100.0 * (3 * s.w + s.t) / nullif(3 * s.g, 0), 1), s.ev
  from s left join public.archetypes a on a.slug = s.deck
  order by s.g desc
$$;
grant execute on function public.matchup_decks(text, int) to anon, authenticated;
