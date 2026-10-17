-- Deck history: the owner can look back at earlier versions of a deck and restore one.
--
--   * When a deck's cards change, the card list from BEFORE the change is saved as a version.
--   * Quick edits are grouped: if the newest version is under 10 minutes old, nothing new is saved, so a
--     whole editing session keeps one snapshot (the list as it was when the session began).
--   * At most 50 versions are kept per deck; the oldest go first.
--   * Only the deck's owner can read versions or restore one. Restoring saves the current list first
--     (always, even inside the 10 minutes), so a restore can be undone.

create table if not exists public.deck_versions (
  id bigserial primary key,
  deck_id uuid not null references public.decks(id) on delete cascade,
  created_at timestamptz not null default now(),
  cards jsonb not null default '[]'::jsonb,
  card_count int not null default 0,
  note text not null default ''
);
create index if not exists deck_versions_deck_created_idx on public.deck_versions (deck_id, created_at desc);

alter table public.deck_versions enable row level security;
revoke all on public.deck_versions from anon, authenticated;
grant select on public.deck_versions to authenticated;
drop policy if exists "Owner reads deck versions" on public.deck_versions;
create policy "Owner reads deck versions" on public.deck_versions for select to authenticated
  using (exists (select 1 from public.decks d where d.id = deck_id and d.owner = (select auth.uid())));

create or replace function public.snapshot_deck_version() returns trigger
language plpgsql security definer set search_path = public as $$
declare newest public.deck_versions; force boolean := coalesce(current_setting('app.deck_snapshot_force', true), '') = '1';
begin
  if old.cards is not distinct from new.cards then return new; end if;
  if jsonb_typeof(old.cards) is distinct from 'array' or jsonb_array_length(old.cards) = 0 then return new; end if;
  select * into newest from public.deck_versions where deck_id = old.id order by created_at desc, id desc limit 1;
  if found then
    if newest.cards is not distinct from old.cards then return new; end if;
    if not force and newest.created_at > now() - interval '10 minutes' then return new; end if;
  end if;
  insert into public.deck_versions (deck_id, cards, card_count) values (old.id, old.cards, coalesce(old.card_count, 0));
  delete from public.deck_versions where deck_id = old.id
    and id not in (select id from public.deck_versions where deck_id = old.id order by created_at desc, id desc limit 50);
  return new;
end $$;
revoke execute on function public.snapshot_deck_version() from public, anon, authenticated;

drop trigger if exists decks_snapshot_version on public.decks;
create trigger decks_snapshot_version after update of cards on public.decks
  for each row execute function public.snapshot_deck_version();

create or replace function public.restore_deck_version(p_version bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v public.deck_versions; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  select * into v from public.deck_versions where id = p_version;
  if not found or not exists (select 1 from public.decks where id = v.deck_id and owner = uid) then
    raise exception 'Version not found';
  end if;
  perform set_config('app.deck_snapshot_force', '1', true);
  update public.decks set cards = v.cards, card_count = v.card_count where id = v.deck_id;
  perform set_config('app.deck_snapshot_force', '', true);
end $$;
revoke execute on function public.restore_deck_version(bigint) from public, anon;
grant execute on function public.restore_deck_version(bigint) to authenticated;
