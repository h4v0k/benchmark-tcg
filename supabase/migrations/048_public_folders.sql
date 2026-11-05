-- Public folders: an owner can make a folder public and share its link (/folders/<id>). Anyone with the link sees
-- the folder's name, its owner and every deck in it, including decks that are private on their own (sharing the
-- folder shares what's in it). Those decks still stay out of Browse, search and profiles, which only list public decks.

alter table public.folders add column if not exists is_public boolean not null default false;

-- Owners keep full access through "Your folders"; everyone can also read public folders.
drop policy if exists "Read public folders" on public.folders;
create policy "Read public folders" on public.folders for select using (is_public);

create index if not exists folders_public on public.folders (id) where is_public;
create index if not exists decks_folder on public.decks (folder_id) where folder_id is not null;

-- A deck can be read if it's public, it's yours, or it sits in a public folder.
alter policy "Read public decks and your own" on public.decks
  using (is_public or owner = (select auth.uid())
         or (folder_id is not null and exists (select 1 from public.folders f where f.id = decks.folder_id and f.is_public)));

-- Views on decks opened from a public folder count the same as views on public decks.
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_view' limit 1;
  if src is not null and position('(is_public or owner = auth.uid())' in src) > 0 then
    execute replace(src, '(is_public or owner = auth.uid())',
      '(is_public or owner = auth.uid() or (folder_id is not null and exists (select 1 from public.folders f where f.id = decks.folder_id and f.is_public)))');
  end if;
end $$;
