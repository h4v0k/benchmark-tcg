-- TCGdex has no art for some printings (SVE/MEE basic Energy, MEP promos, Trainer Kits, Shining Legends...).
-- fallback_image(card) returns art from another printing of the same card so those tiles aren't blank.
-- It's a PostgREST computed field: the site asks for it with select=...,fallback_image.
-- Basic Energy is matched with or without the "Basic " prefix; Pokémon prefer a printing with the same
-- HP and attacks (a reprint of the same card) before falling back to any printing of that name.
create or replace function public.fallback_image(c public.cards)
returns text language sql stable set search_path = public as $$
  select c2.image
  from public.cards c2 join public.sets s on s.id = c2.set_id
  where coalesce(c.image, '') = ''
    and c2.name_norm in (regexp_replace(c.name_norm, '^basic ', ''), 'basic ' || regexp_replace(c.name_norm, '^basic ', ''))
    and c2.category = c.category
    and coalesce(c2.image, '') <> ''
    and not coalesce(s.hidden, false)
  order by (c2.hp is not distinct from c.hp) desc,
           (c2.attacks is not distinct from c.attacks) desc,
           s.release_date desc nulls last
  limit 1
$$;
grant execute on function public.fallback_image(public.cards) to anon, authenticated;
