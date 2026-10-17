-- Advanced card search. The browser parses the query (src/lib/cardquery.ts) into OR-groups of AND-clauses:
--   [[{"f":"hp","op":">=","v":"200","neg":false}, ...], [...]]
-- Every clause is applied with a fixed condition below; user text is only ever compared as a value, never run as SQL.

create or replace function public.cmp_num(op text, a numeric, b numeric) returns boolean
language sql immutable parallel safe set search_path = public as $$
  select case op when ':' then a = b when '=' then a = b when '!=' then a <> b when '>' then a > b
    when '>=' then a >= b when '<' then a < b when '<=' then a <= b else false end
$$;

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

-- Does one printing satisfy one clause? (negation is applied by the caller)
create or replace function public.card_clause_ok(c public.cards, s public.sets, cl jsonb) returns boolean
language sql stable set search_path = public, extensions as $$
  with k as (
    select cl->>'f' as f, coalesce(cl->>'op', ':') as op, lower(btrim(coalesce(cl->>'v', ''))) as v,
      case when btrim(coalesce(cl->>'v', '')) ~ '^-?\d+(\.\d+)?$' then btrim(cl->>'v')::numeric end as n
  )
  select coalesce(case k.f
    when 'name' then strpos(c.name_norm, public.norm_name(k.v)) > 0
    when 'exact' then c.name_norm = public.norm_name(k.v)
    when 'text' then strpos(public.card_rules_text(c.effect, c.abilities, c.attacks), k.v) > 0
    when 'atk' then exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.attacks) = 'array' then c.attacks else '[]'::jsonb end) a where strpos(lower(coalesce(a->>'name', '')), k.v) > 0)
    when 'ab' then exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.abilities) = 'array' then c.abilities else '[]'::jsonb end) a where strpos(lower(coalesce(a->>'name', '')), k.v) > 0)
    when 'type' then k.v = any (select lower(x) from unnest(c.types) x)
    when 'cat' then lower(c.category) = k.v
    when 'stage' then lower(c.stage) = k.v
    when 'suffix' then lower(c.suffix) = k.v
    when 'tt' then lower(c.trainer_type) = k.v
    when 'hp' then public.cmp_num(k.op, c.hp, k.n)
    when 'retreat' then public.cmp_num(k.op, c.retreat, k.n)
    when 'damage' then public.cmp_num(k.op, public.card_max_damage(c.attacks), k.n)
    when 'cost' then public.cmp_num(k.op, public.card_max_cost(c.attacks), k.n)
    when 'weak' then exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.weaknesses) = 'array' then c.weaknesses else '[]'::jsonb end) w where lower(w->>'type') = k.v)
    when 'res' then exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.resistances) = 'array' then c.resistances else '[]'::jsonb end) w where lower(w->>'type') = k.v)
    when 'set' then lower(s.id) = k.v or lower(coalesce(s.code, '')) = k.v or (char_length(k.v) >= 3 and strpos(lower(s.name), k.v) > 0)
    when 'num' then case when k.n is not null and c.num_key ~ '^\d+$' then public.cmp_num(k.op, c.num_key::numeric, k.n) else lower(c.local_id) = k.v or lower(c.num_key) = k.v end
    when 'reg' then lower(c.reg_mark) = k.v
    when 'rarity' then strpos(lower(c.rarity), k.v) > 0
    when 'artist' then strpos(lower(c.illustrator), k.v) > 0
    when 'legal' then case k.v when 'standard' then c.legal_standard when 'expanded' then c.legal_expanded else false end
    when 'banned' then k.v = any (c.banned_in)
    when 'usd' then public.cmp_num(k.op, coalesce((c.prices->>'normal')::numeric, (c.prices->>'holo')::numeric, (c.prices->>'reverse')::numeric), k.n)
    when 'is' then case k.v
      when 'ace' then c.is_ace when 'radiant' then c.is_radiant when 'prism' then c.is_prism
      when 'basic-energy' then c.is_basic_energy
      when 'special-energy' then c.category = 'Energy' and c.energy_type = 'Special'
      when 'basic' then c.category = 'Pokemon' and c.stage = 'Basic'
      when 'rotating' then c.rotating
      when 'ex' then lower(c.suffix) = 'ex' when 'gx' then lower(c.suffix) = 'gx' when 'v' then lower(c.suffix) = 'v'
      else false end
    else false end, false)
  from k
$$;

create or replace function public.search_cards_q(p_clauses jsonb, p_fmt text default 'unlimited', p_sort text default 'relevance', p_limit int default 60, p_offset int default 0)
 returns table(name text, card_id text, image text, set_id text, set_name text, category text, sub text, printings integer, legal boolean)
 language sql
 stable
 set search_path to 'public', 'extensions'
as $function$
  with q as (
    select case when jsonb_typeof(p_clauses) = 'array' then p_clauses else '[]'::jsonb end as g,
      (select public.norm_name(cl->>'v') from jsonb_array_elements(case when jsonb_typeof(p_clauses) = 'array' and jsonb_typeof(p_clauses->0) = 'array' then p_clauses->0 else '[]'::jsonb end) cl
        where cl->>'f' = 'name' and not coalesce((cl->>'neg')::boolean, false) limit 1) as t
  ),
  hits as (
    select c.*, s.name as s_name, s.release_date,
      case when p_fmt = 'standard' then c.legal_standard when p_fmt = 'expanded' then c.legal_expanded else true end as ok,
      coalesce((c.prices->>'normal')::numeric, (c.prices->>'holo')::numeric, (c.prices->>'reverse')::numeric) as px
    from public.cards c join public.sets s on s.id = c.set_id, q
    where not s.hidden and jsonb_array_length(q.g) > 0
      and exists (
        select 1 from jsonb_array_elements(q.g) grp
        where jsonb_typeof(grp) = 'array' and jsonb_array_length(grp) > 0
          and not exists (
            select 1 from jsonb_array_elements(grp) cl
            where public.card_clause_ok(c, s, cl) = coalesce((cl->>'neg')::boolean, false)))
  ),
  grouped as (
    select distinct on (h.name) h.name, h.id, h.image, h.set_id, h.s_name, h.category,
      coalesce(nullif(h.trainer_type, ''), nullif(h.stage, ''), h.energy_type) as sub,
      count(*) filter (where p_fmt not in ('standard', 'expanded') or h.ok) over (partition by h.name) as printings,
      bool_or(h.ok) over (partition by h.name) as any_ok,
      h.name_norm, h.hp, h.px, h.release_date
    from hits h
    order by h.name, h.ok desc, (h.image <> '') desc, h.release_date desc nulls last,
      (case when h.num_key ~ '^\d+$' then h.num_key::int else 9999 end)
  )
  select g.name, g.id, g.image, g.set_id, g.s_name, g.category, g.sub, g.printings::int, g.any_ok
  from grouped g, q
  where p_fmt not in ('standard', 'expanded') or g.any_ok
  order by
    case when p_sort = 'relevance' and q.t is not null then (g.name_norm = q.t)::int end desc nulls last,
    case when p_sort = 'relevance' and q.t is not null then (g.name_norm like q.t || '%')::int end desc nulls last,
    case when p_sort = 'hp' then g.hp end desc nulls last,
    case when p_sort = 'price' then g.px end desc nulls last,
    case when p_sort = 'newest' then g.release_date end desc nulls last,
    g.name
  limit greatest(1, least(p_limit, 120)) offset greatest(p_offset, 0)
$function$;

revoke all on function public.search_cards_q(jsonb, text, text, int, int) from public;
grant execute on function public.search_cards_q(jsonb, text, text, int, int) to anon, authenticated;
