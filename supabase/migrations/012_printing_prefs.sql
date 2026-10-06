-- Preferred printings, and "cheapest legal printing" as the default when importing or adding cards.

create table if not exists public.printing_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  card_id text not null references public.cards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.printing_prefs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'printing_prefs' and policyname = 'own prefs') then
    create policy "own prefs" on public.printing_prefs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
revoke all on public.printing_prefs from anon;
grant select, insert, update, delete on public.printing_prefs to authenticated;

-- Keep name in step with the card, so a preference always belongs to that card's name.
create or replace function public.printing_prefs_fill() returns trigger
language plpgsql set search_path = public as $$
begin
  new.user_id := auth.uid();
  select c.name into new.name from public.cards c where c.id = new.card_id;
  if new.name is null then raise exception 'Unknown card'; end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'printing_prefs_fill') then
    create trigger printing_prefs_fill before insert or update on public.printing_prefs
      for each row execute function public.printing_prefs_fill();
  end if;
end $$;

-- Price used to compare printings: market price of the plain version, else holo, else reverse.
create or replace function public.card_price(p jsonb) returns numeric
language sql immutable as $$
  select coalesce((p->>'normal')::numeric, (p->>'holo')::numeric, (p->>'reverse')::numeric)
$$;

-- The printing to use for a card in a format:
--   the user's preferred printing if it is legal, else the cheapest legal printing.
-- With p_sig set, only printings of that exact card (same text) are considered.
create or replace function public.pick_printing(p_name text, p_fmt text, p_sig text default null)
returns text
language sql stable set search_path = public as $$
  select c.id
  from public.cards c join public.sets s on s.id = c.set_id
  left join public.printing_prefs pp on pp.user_id = auth.uid() and pp.card_id = c.id
  where c.name = p_name and not s.hidden and not s.is_classic
    and (p_sig is null or c.sig = p_sig)
  order by
    (case when p_fmt = 'standard' then c.legal_standard when p_fmt = 'expanded' then c.legal_expanded else true end) desc,
    (pp.card_id is not null) desc,
    public.card_price(c.prices) asc nulls last,
    (c.image <> '') desc,
    s.is_promo,
    s.release_date desc nulls last,
    (case when c.num_key ~ '^\d+$' then c.num_key::int else 9999 end)
  limit 1
$$;
grant execute on function public.pick_printing(text, text, text) to anon, authenticated;

-- Deck list import (v2; the old resolve_decklist stays for cached pages). p_mode 'cheapest' (default): each card becomes the user's preferred or the
-- cheapest legal printing of that same card. 'exact': keep the printing the list names.
create or replace function public.resolve_decklist_v2(lines jsonb, fmt text default 'standard', p_mode text default 'cheapest')
 returns table(i integer, card_id text, how text)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
declare l jsonb; nm text; cd text; nk text; sid text; cid text; how_ text; alt text[]; better text; cname text; csig text;
begin
  for l in select * from jsonb_array_elements(lines) loop
    nm := public.norm_name(l->>'name');
    cd := upper(coalesce(l->>'code', ''));
    nk := upper(regexp_replace(split_part(coalesce(l->>'num', ''), '/', 1), '^([A-Z]*)0*(\d+)([A-Z]?)$', '\1\2\3', 'i'));
    cid := null; how_ := null; sid := null; cname := null;
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
      -- No set given (or not found): any printing with this name.
      select c.name into cname from public.cards c join public.sets s on s.id = c.set_id
        where c.name_norm = any(alt) and not s.hidden
        order by (case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end) desc,
          s.is_classic, s.release_date desc nulls last
        limit 1;
      if cname is not null then
        cid := public.pick_printing(cname, fmt, null);
        if cid is not null then how_ := 'name'; end if;
      end if;
    elsif p_mode = 'cheapest' then
      -- Same card (same name and text), preferred or cheapest legal printing.
      select c.name, c.sig into cname, csig from public.cards c where c.id = cid;
      better := public.pick_printing(cname, fmt, nullif(csig, ''));
      if better is not null and better <> cid then cid := better; how_ := 'cheapest'; end if;
    end if;
    i := (l->>'i')::int; card_id := cid; how := how_;
    return next;
  end loop;
end $function$;
grant execute on function public.resolve_decklist_v2(jsonb, text, text) to anon, authenticated;

-- Card search: the card offered for each name is the preferred or cheapest legal printing.
create or replace function public.search_cards(q text, fmt text default 'unlimited', cat text default '', lim integer default 30)
 returns table(name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings integer, legal boolean)
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  with term as (select public.norm_name(q) t),
  hits as (
    select c.*, s.name as s_name, s.release_date, s.is_promo,
      case when fmt = 'standard' then c.legal_standard when fmt = 'expanded' then c.legal_expanded else true end as ok,
      exists (select 1 from public.printing_prefs pp where pp.user_id = auth.uid() and pp.card_id = c.id) as pref
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
    order by h.name, h.ok desc, h.pref desc, (h.image <> '') desc, public.card_price(h.prices) asc nulls last,
      h.is_promo, h.release_date desc nulls last,
      (case when h.num_key ~ '^\d+$' then h.num_key::int else 9999 end)
  )
  select g.name, g.id, g.image, g.set_id, g.s_name, g.category, g.sub, g.printings::int, g.any_ok
  from grouped g, term
  where fmt = 'unlimited' or g.any_ok
  order by (g.name_norm = term.t) desc, (g.name_norm like term.t || '%') desc,
    (g.name_norm like '% ' || term.t || '%') desc, extensions.similarity(g.name_norm, term.t) desc, char_length(g.name), g.name
  limit greatest(1, least(lim, 60))
$function$;
