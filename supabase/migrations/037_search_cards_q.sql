-- Advanced card search. The browser parses the query (src/lib/cardquery.ts) into OR-groups of AND-clauses:
--   [[{"f":"hp","op":">=","v":"200","neg":false}, ...], [...]]
-- search_cards_q turns each clause into a plain SQL predicate from a FIXED whitelist of field -> expression
-- mappings (so the planner evaluates them cheaply, once per card), and runs the result with EXECUTE.
-- User text only ever enters the SQL as a quoted literal (format %L); it is never concatenated raw.
-- Limits: 10 OR-groups, 20 clauses in all, 100 characters per value.

-- Retired in favour of inline predicates (the per-clause SQL function could not be inlined and was ~60x slower).
drop function if exists public.card_clause_ok(public.cards, public.sets, jsonb);
drop function if exists public.cmp_num(text, numeric, numeric);

-- Ability and attack names plus all rules text of a card, lower case.
create or replace function public.card_rules_text(effect text, abilities jsonb, attacks jsonb) returns text
language sql immutable parallel safe set search_path = public as $$
  select lower(concat_ws(' ', effect,
    (select string_agg(concat_ws(' ', a->>'name', a->>'effect'), ' ') from jsonb_array_elements(case when jsonb_typeof(abilities) = 'array' then abilities else '[]'::jsonb end) a),
    (select string_agg(concat_ws(' ', a->>'name', a->>'effect'), ' ') from jsonb_array_elements(case when jsonb_typeof(attacks) = 'array' then attacks else '[]'::jsonb end) a)))
$$;

-- Highest damage number and longest energy cost among a card's attacks (null when it has none).
create or replace function public.card_max_damage(attacks jsonb) returns numeric
language sql immutable parallel safe set search_path = public as $$
  select max(nullif(regexp_replace(coalesce(a->>'damage', ''), '\D', '', 'g'), '')::numeric)
  from jsonb_array_elements(case when jsonb_typeof(attacks) = 'array' then attacks else '[]'::jsonb end) a
$$;
create or replace function public.card_max_cost(attacks jsonb) returns numeric
language sql immutable parallel safe set search_path = public as $$
  select max(jsonb_array_length(case when jsonb_typeof(a->'cost') = 'array' then a->'cost' else '[]'::jsonb end))
  from jsonb_array_elements(case when jsonb_typeof(attacks) = 'array' then attacks else '[]'::jsonb end) a
$$;

-- One clause -> SQL predicate over aliases c (cards) and s (sets). Always returns SQL that yields true/false (never null).
create or replace function public.card_clause_sql(cl jsonb) returns text
language plpgsql immutable set search_path = public, extensions as $$
declare
  f text; op text; v text; n numeric; lit text; nlit text; e text; arr text;
begin
  if jsonb_typeof(cl) <> 'object' then return 'false'; end if;
  f := cl->>'f';
  op := case coalesce(cl->>'op', ':') when ':' then '=' when '=' then '=' when '!=' then '<>' when '>' then '>' when '>=' then '>='
          when '<' then '<' when '<=' then '<=' else null end;
  v := lower(btrim(coalesce(cl->>'v', '')));
  if btrim(coalesce(cl->>'v', '')) ~ '^-?\d+(\.\d+)?$' then n := btrim(cl->>'v')::numeric; end if;
  lit := quote_literal(v);
  nlit := case when n is null then null else quote_literal(n::text) || '::numeric' end;
  arr := 'case when jsonb_typeof(%s) = ''array'' then %s else ''[]''::jsonb end';

  if f in ('hp', 'retreat', 'damage', 'cost', 'usd') then
    if op is null or n is null then return 'false'; end if;
    e := case f
      when 'hp' then 'c.hp' when 'retreat' then 'c.retreat'
      when 'damage' then 'public.card_max_damage(c.attacks)' when 'cost' then 'public.card_max_cost(c.attacks)'
      else 'coalesce((c.prices->>''normal'')::numeric, (c.prices->>''holo'')::numeric, (c.prices->>''reverse'')::numeric)' end;
    return format('coalesce(%s %s %s, false)', e, op, nlit);
  end if;

  e := case f
    when 'name' then format('strpos(c.name_norm, %L) > 0', public.norm_name(v))
    when 'exact' then format('c.name_norm = %L', public.norm_name(v))
    when 'text' then format('strpos(public.card_rules_text(c.effect, c.abilities, c.attacks), %s) > 0', lit)
    when 'atk' then format('exists (select 1 from jsonb_array_elements(%s) a where strpos(lower(coalesce(a->>''name'', '''')), %s) > 0)', format(arr, 'c.attacks', 'c.attacks'), lit)
    when 'ab' then format('exists (select 1 from jsonb_array_elements(%s) a where strpos(lower(coalesce(a->>''name'', '''')), %s) > 0)', format(arr, 'c.abilities', 'c.abilities'), lit)
    when 'type' then format('exists (select 1 from unnest(c.types) x where lower(x) = %s)', lit)
    when 'cat' then format('lower(c.category) = %s', lit)
    when 'stage' then format('lower(c.stage) = %s', lit)
    -- modern lowercase "ex" and the old uppercase "EX" are different mechanics: "ex" is matched case-sensitively
    when 'suffix' then case v when 'ex' then 'c.suffix = ''ex''' else format('lower(c.suffix) = %s', lit) end
    when 'tt' then format('lower(c.trainer_type) = %s', lit)
    when 'weak' then format('exists (select 1 from jsonb_array_elements(%s) w where lower(w->>''type'') = %s)', format(arr, 'c.weaknesses', 'c.weaknesses'), lit)
    when 'res' then format('exists (select 1 from jsonb_array_elements(%s) w where lower(w->>''type'') = %s)', format(arr, 'c.resistances', 'c.resistances'), lit)
    when 'set' then format('(lower(s.id) = %s or lower(coalesce(s.code, '''')) = %s', lit, lit)
      || case when char_length(v) >= 3 then format(' or strpos(lower(s.name), %s) > 0', lit) else '' end || ')'
    when 'num' then case when n is not null and op is not null then
        format('(case when c.num_key ~ ''^\d+$'' then c.num_key::numeric %s %s else lower(c.local_id) = %s or lower(c.num_key) = %s end)', op, nlit, lit, lit)
      else format('(lower(c.local_id) = %s or lower(c.num_key) = %s)', lit, lit) end
    when 'reg' then format('lower(c.reg_mark) = %s', lit)
    when 'rarity' then format('strpos(lower(c.rarity), %s) > 0', lit)
    when 'artist' then format('strpos(lower(c.illustrator), %s) > 0', lit)
    when 'legal' then case v when 'standard' then 'c.legal_standard' when 'expanded' then 'c.legal_expanded' else 'false' end
    when 'banned' then format('%s = any (c.banned_in)', lit)
    when 'is' then case v
      when 'ace' then 'c.is_ace' when 'radiant' then 'c.is_radiant' when 'prism' then 'c.is_prism'
      when 'basic-energy' then 'c.is_basic_energy'
      when 'special-energy' then '(c.category = ''Energy'' and c.energy_type = ''Special'')'
      when 'basic' then '(c.category = ''Pokemon'' and c.stage = ''Basic'')'
      when 'rotating' then 'c.rotating'
      when 'ex' then 'c.suffix = ''ex''' when 'old-ex' then 'c.suffix = ''EX'''
      when 'gx' then 'lower(c.suffix) = ''gx'''
      when 'v' then '(lower(c.suffix) = ''v'' or lower(c.stage) in (''vstar'', ''vmax''))'
      else 'false' end
    else 'false' end;
  return format('coalesce(%s, false)', e);
end $$;

create or replace function public.search_cards_q(p_clauses jsonb, p_fmt text default 'unlimited', p_sort text default 'relevance', p_limit int default 60, p_offset int default 0)
 returns table(name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings integer, legal boolean)
 language plpgsql
 stable
 set search_path to 'public', 'extensions'
as $function$
declare
  grp jsonb; cl jsonb; ors text[] := '{}'; ands text[]; ncl int := 0; ngrp int := 0; t text;
  sql text;
begin
  if jsonb_typeof(p_clauses) is distinct from 'array' then return; end if;
  if jsonb_array_length(p_clauses) > 10 then
    raise exception 'Search is too complex: use at most 10 OR groups, 20 conditions in all, and values up to 100 characters.';
  end if;
  for grp in select * from jsonb_array_elements(p_clauses) loop
    if jsonb_typeof(grp) <> 'array' then continue; end if;
    ngrp := ngrp + 1;
    ands := '{}';
    for cl in select * from jsonb_array_elements(grp) loop
      ncl := ncl + 1;
      if ncl > 20 or (jsonb_typeof(cl) = 'object' and char_length(coalesce(cl->>'v', '')) > 100) then
        raise exception 'Search is too complex: use at most 10 OR groups, 20 conditions in all, and values up to 100 characters.';
      end if;
      ands := ands || (case when coalesce(cl->>'neg', 'false') in ('true', 't') then 'not ' else '' end || public.card_clause_sql(cl));
    end loop;
    if cardinality(ands) > 0 then ors := ors || ('(' || array_to_string(ands, ' and ') || ')'); end if;
  end loop;
  if cardinality(ors) = 0 then return; end if;

  -- relevance: the first positive name clause of the first group
  if jsonb_typeof(p_clauses->0) = 'array' then
    select public.norm_name(x->>'v') into t from jsonb_array_elements(p_clauses->0) x
      where jsonb_typeof(x) = 'object' and x->>'f' = 'name' and coalesce(x->>'neg', 'false') not in ('true', 't') limit 1;
  end if;

  sql := $q$
  with hits as (
    select c.name, c.id, c.image, c.set_id, s.name as s_name, c.category, c.trainer_type, c.stage, c.energy_type,
      c.name_norm, c.hp, c.num_key, s.release_date,
      case when $1 = 'standard' then c.legal_standard when $1 = 'expanded' then c.legal_expanded else true end as ok,
      coalesce((c.prices->>'normal')::numeric, (c.prices->>'holo')::numeric, (c.prices->>'reverse')::numeric) as px
    from public.cards c join public.sets s on s.id = c.set_id
    where not s.hidden and ( $q$ || array_to_string(ors, ' or ') || $q$ )
  ),
  grouped as (
    select distinct on (h.name) h.name, h.id, h.image, h.set_id, h.s_name, h.category,
      coalesce(nullif(h.trainer_type, ''), nullif(h.stage, ''), h.energy_type) as sub,
      count(*) filter (where $1 not in ('standard', 'expanded') or h.ok) over (partition by h.name) as printings,
      bool_or(h.ok) over (partition by h.name) as any_ok,
      h.name_norm, h.hp, h.px, h.release_date
    from hits h
    order by h.name, h.ok desc, (h.image <> '') desc, h.release_date desc nulls last,
      (case when h.num_key ~ '^\d+$' then h.num_key::int else 9999 end)
  )
  select g.name, g.id, g.image, g.set_id, g.s_name, g.category, g.sub, g.printings::int, g.any_ok
  from grouped g
  where $1 not in ('standard', 'expanded') or g.any_ok
  order by
    case when $2 = 'relevance' and $3 is not null then (g.name_norm = $3)::int end desc nulls last,
    case when $2 = 'relevance' and $3 is not null then (g.name_norm like $3 || '%')::int end desc nulls last,
    case when $2 = 'hp' then g.hp end desc nulls last,
    case when $2 = 'price' then g.px end desc nulls last,
    case when $2 = 'newest' then g.release_date end desc nulls last,
    g.name
  limit greatest(1, least($4, 120)) offset greatest($5, 0)
  $q$;
  return query execute sql using p_fmt, p_sort, t, p_limit, p_offset;
end
$function$;

grant execute on function public.card_clause_sql(jsonb) to anon, authenticated;
revoke all on function public.search_cards_q(jsonb, text, text, int, int) from public;
grant execute on function public.search_cards_q(jsonb, text, text, int, int) to anon, authenticated;
