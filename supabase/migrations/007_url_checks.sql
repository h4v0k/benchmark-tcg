-- Cover art and profile pictures are card image URLs from TCGdex, never arbitrary URLs.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'decks_cover_url') then
    alter table public.decks add constraint decks_cover_url check (cover = '' or cover ~ '^https://assets\.tcgdex\.net/[A-Za-z0-9/._-]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_url') then
    alter table public.profiles add constraint profiles_avatar_url check (avatar_card = '' or avatar_card ~ '^https://assets\.tcgdex\.net/[A-Za-z0-9/._-]+$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decks_cards_size') then
    alter table public.decks add constraint decks_cards_size check (jsonb_typeof(cards) = 'array' and jsonb_array_length(cards) <= 400);
  end if;
end $$;
