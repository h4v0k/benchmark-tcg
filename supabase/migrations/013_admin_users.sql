-- Admin panel: list of user accounts. Admins only (checked inside; everyone else gets an error).
create or replace function public.admin_users()
returns table (
  id uuid, username text, email text, sign_in text, confirmed boolean,
  created_at timestamptz, last_sign_in_at timestamptz,
  deck_count bigint, public_deck_count bigint, is_admin boolean
)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin) then
    raise exception 'Admins only';
  end if;
  return query
  select u.id, p.username, u.email::text,
    coalesce((select string_agg(distinct i.provider, ', ') from auth.identities i where i.user_id = u.id), ''),
    (u.email_confirmed_at is not null),
    u.created_at, u.last_sign_in_at,
    (select count(*) from public.decks d where d.owner = u.id),
    (select count(*) from public.decks d where d.owner = u.id and d.is_public),
    coalesce(p.is_admin, false)
  from auth.users u left join public.profiles p on p.id = u.id
  order by u.created_at desc;
end $$;
revoke execute on function public.admin_users() from public, anon;
grant execute on function public.admin_users() to authenticated;
