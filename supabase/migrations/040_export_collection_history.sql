-- Download my data: also include the collection (035) and saved deck versions (034), added after 033.
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
    'collection', coalesce((select jsonb_agg(jsonb_build_object('card_id', c.card_id, 'qty', c.qty, 'updated_at', c.updated_at) order by c.card_id) from public.collection c where c.user_id = me), '[]'),
    'deck_versions', coalesce((select jsonb_agg(jsonb_build_object('deck_id', v.deck_id, 'created_at', v.created_at, 'card_count', v.card_count, 'cards', v.cards) order by v.deck_id, v.created_at)
                               from public.deck_versions v join public.decks d on d.id = v.deck_id where d.owner = me), '[]'),
    'issue_reports', coalesce((select jsonb_agg(jsonb_build_object('created_at', r.created_at, 'message', r.message, 'contact_email', r.contact_email, 'page_url', r.page_url) order by r.created_at) from public.issue_reports r where r.user_id = me), '[]')
  ) into out;
  return out;
end $fn$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
