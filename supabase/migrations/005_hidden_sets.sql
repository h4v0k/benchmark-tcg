-- TCGdex also lists Pokémon TCG Pocket (digital-only) sets. Keep them out of the site.
alter table public.sets add column if not exists hidden boolean not null default false;
update public.sets set hidden = true, is_classic = true where series = 'Pokémon TCG Pocket';
update public.sets set is_classic = true where id = 'jumbo' or name ilike '%classic collection%';

create or replace function public.cards_needing_detail(lim int, recent_from date)
returns table (id text)
language sql stable security definer set search_path = public as $$
  select q.id from (
    select c.id, 0 as pri, s.release_date as rel
      from public.cards c join public.sets s on s.id = c.set_id where c.detail_at is null and not s.hidden
    union all
    select c.id, 1, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '2 days' and s.release_date >= recent_from and not s.hidden
    union all
    select c.id, 2, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '45 days' and not s.hidden
  ) q
  order by q.pri, q.rel desc nulls first, q.id
  limit greatest(1, least(lim, 400))
$$;

create or replace function public.sets_needing_prices(lim int)
returns table (id text, tcgp_group_id int)
language sql stable security definer set search_path = public as $$
  select s.id, s.tcgp_group_id from public.sets s
  where not s.hidden and (s.prices_at is null or s.prices_at < now() - interval '20 hours')
  order by (s.release_date >= date '2011-04-25') desc nulls last, s.prices_at nulls first, s.release_date desc nulls last
  limit greatest(1, least(lim, 40))
$$;

create or replace function public.search_cards(q text, fmt text default 'unlimited', cat text default '', lim int default 30)
returns table (name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings int, legal boolean)
language sql stable security definer set search_path = public, extensions as $$
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
      count(*) over (partition by h.name) as printings,
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
$$;

create or replace function public.resolve_decklist(lines jsonb, fmt text default 'standard')
returns table (i int, card_id text, how text)
language plpgsql stable security definer set search_path = public as $$
declare l jsonb; nm text; cd text; nk text; sid text; cid text; how_ text; alt text[];
begin
  for l in select * from jsonb_array_elements(lines) loop
    nm := public.norm_name(l->>'name');
    cd := upper(coalesce(l->>'code', ''));
    nk := upper(regexp_replace(split_part(coalesce(l->>'num', ''), '/', 1), '^([A-Z]*)0*(\d+)([A-Z]?)$', '\1\2\3', 'i'));
    cid := null; how_ := null; sid := null;
    alt := array[nm,
      regexp_replace(nm, '^basic ', ''),
      'basic ' || regexp_replace(nm, '^basic ', ''),
      regexp_replace(nm, ' energy energy$', ' energy'),
      regexp_replace(nm, '^basic (\w+) energy energy$', '\1 energy')];
    if cd <> '' then
      select s.id into sid from public.sets s where upper(s.code) = cd and not s.hidden and not s.is_classic order by s.release_date desc nulls last limit 1;
      if sid is null then select sc.set_id into sid from public.set_codes sc join public.sets s on s.id = sc.set_id where upper(sc.code) = cd and not s.hidden; end if;
    end if;
    if sid is not null and nk <> '' then
      select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk and c.name_norm = any(alt) limit 1;
      if cid is not null then how_ := 'exact'; end if;
      if cid is null then
        select c.id into cid from public.cards c where c.set_id = sid and upper(c.num_key) = nk limit 1;
        if cid is not null then how_ := 'number'; end if;
      end if;
    end if;
    if cid is null and sid is not null then
      select c.id into cid from public.cards c where c.set_id = sid and c.name_norm = any(alt)
        order by (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end) limit 1;
      if cid is not null then how_ := 'set'; end if;
    end if;
    if cid is null then
      select c.id into cid from public.cards c join public.sets s on s.id = c.set_id
        where c.name_norm = any(alt) and not s.hidden
        order by (case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end) desc,
          (c.image <> '') desc, s.is_classic, s.release_date desc nulls last,
          (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end)
        limit 1;
      if cid is not null then how_ := 'name'; end if;
    end if;
    i := (l->>'i')::int; card_id := cid; how := how_;
    return next;
  end loop;
end $$;
