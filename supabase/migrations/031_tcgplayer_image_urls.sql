-- Cards with no TCGdex art (e.g. some recent promos) use their TCGplayer product image instead.
-- The site already shows those, but the cover and avatar checks only allowed TCGdex URLs, so picking
-- one of those cards as a deck cover or profile picture failed. Allow TCGplayer product images too
-- (still only card images, never arbitrary URLs).
alter table public.decks drop constraint if exists decks_cover_url;
alter table public.decks add constraint decks_cover_url check (
  cover = ''
  or cover ~ '^https://assets\.tcgdex\.net/[A-Za-z0-9/._-]+$'
  or cover ~ '^https://tcgplayer-cdn\.tcgplayer\.com/product/[0-9]+$');

alter table public.profiles drop constraint if exists profiles_avatar_url;
alter table public.profiles add constraint profiles_avatar_url check (
  avatar_card = ''
  or avatar_card ~ '^https://assets\.tcgdex\.net/[A-Za-z0-9/._-]+$'
  or avatar_card ~ '^https://tcgplayer-cdn\.tcgplayer\.com/product/[0-9]+$');
