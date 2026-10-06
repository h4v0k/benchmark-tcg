-- Card search: in Standard or Expanded, "N printings" counts only the printings legal in that format.
create or replace function public.search_cards(q text, fmt text default 'unlimited', cat text default '', lim integer default 30)
 returns table(name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings integer, legal boolean)
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  with term as (select public.norm_name(q) t),
  hits as (
    select c.*, s.name as s_name, s.release_date,
      case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end as ok
    from public.cards c join public.sets s on s.id = c.set_id, term
    where not s.hidden and char_length(term.t) >= 2
      and (c.name_norm like '%' || term.t || '%' or (char_length(term.t) >= 4 and c.name_norm % term.t))
      and (cat = '' or c.category = cat)
  ),
  grouped as (
    select distinct on (h.name) h.name, h.id, h.image, h.set_id, h.s_name, h.category,
      coalesce(nullif(h.trainer_type, ''), nullif(h.stage, ''), h.energy_type) as sub,
      count(*) filter (where fmt = 'unlimited' or h.ok) over (partition by h.name) as printings,
      bool_or(h.ok) over (partition by h.name) as any_ok,
      h.name_norm
    from hits h
    order by h.name, h.ok desc, (h.image <> '') desc, h.release_date desc nulls last,
      (case when h.num_key ~ '^\d+$' then h.num_key::int else 9999 end)
  )
  select g.name, g.id, g.image, g.set_id, g.s_name, g.category, g.sub, g.printings::int, g.any_ok
  from grouped g, term
  where fmt = 'unlimited' or g.any_ok
  order by (g.name_norm = term.t) desc, (g.name_norm like term.t || '%') desc,
    (g.name_norm like '% ' || term.t || '%') desc, extensions.similarity(g.name_norm, term.t) desc, char_length(g.name), g.name
  limit greatest(1, least(lim, 60))
$function$;
