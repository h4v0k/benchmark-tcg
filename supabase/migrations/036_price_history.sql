-- 036: daily price history. One "main" price per card per day (the one the site shows: normal, then holo,
-- then reverse, then any other finish), kept for a year, plus the lookups for charts and price movers.

create table if not exists public.card_prices_daily (
  card_id text not null references public.cards(id) on delete cascade,
  day date not null,
  market numeric(10,2) not null,
  primary key (card_id, day)
);
create index if not exists card_prices_daily_day_idx on public.card_prices_daily (day);
alter table public.card_prices_daily enable row level security;
drop policy if exists "prices public read" on public.card_prices_daily;
create policy "prices public read" on public.card_prices_daily for select to anon, authenticated using (true);
revoke all on public.card_prices_daily from anon, authenticated;
grant select on public.card_prices_daily to anon, authenticated;

-- Same order as linePrice() in src/lib/cards.ts.
create or replace function public.card_main_price(p jsonb) returns numeric
language sql immutable set search_path = public as $$
  select coalesce(
    case when jsonb_typeof(p->'normal') = 'number' then (p->>'normal')::numeric end,
    case when jsonb_typeof(p->'holo') = 'number' then (p->>'holo')::numeric end,
    case when jsonb_typeof(p->'reverse') = 'number' then (p->>'reverse')::numeric end,
    (select (e.value)::numeric from jsonb_each_text(p) e where jsonb_typeof(p->e.key) = 'number' order by e.key limit 1))
$$;

create or replace function public.snapshot_card_prices() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.card_prices_daily (card_id, day, market)
  select c.id, (now() at time zone 'utc')::date, public.card_main_price(c.prices)
  from public.cards c
  -- Only cards worth $1 or more: cheaper cards rarely matter for buying decisions, and this keeps the table
  -- small enough for the database's size limit (about 9-10k cards a day instead of ~20k).
  where jsonb_typeof(c.prices) = 'object' and public.card_main_price(c.prices) >= 1
  on conflict (card_id, day) do update set market = excluded.market;
  get diagnostics n = row_count;
  -- Daily prices for the last 31 days, then one a week (Sundays) up to a year: ~75 rows per card a year.
  delete from public.card_prices_daily
   where day < (now() at time zone 'utc')::date - 365
      or (day < (now() at time zone 'utc')::date - 31 and extract(dow from day) <> 0);
  return n;
end $$;
revoke execute on function public.snapshot_card_prices() from public, anon, authenticated;

create or replace function public.card_price_history(p_card text, p_days int default 90)
returns table (day date, market numeric)
language sql stable security invoker set search_path = public as $$
  select h.day, h.market from public.card_prices_daily h
  where h.card_id = p_card and h.day >= current_date - least(greatest(coalesce(p_days, 90), 1), 365)
  order by h.day
$$;

-- Biggest risers and fallers over the last p_days (compared with the closest snapshot on or just before
-- that day). Only cards priced $1 or more at both ends; p_standard limits to Standard-legal cards.
create or replace function public.price_movers(p_days int default 7, p_limit int default 20, p_standard boolean default true)
returns jsonb
language sql stable security invoker set search_path = public as $$
  with b as (
    select (select max(day) from public.card_prices_daily) as last_day
  ), base as (
    select (select max(day) from public.card_prices_daily, b where day <= b.last_day - least(greatest(coalesce(p_days, 7), 1), 90) and day >= b.last_day - least(greatest(coalesce(p_days, 7), 1), 90) - 3) as base_day
  ), moves as (
    select c.id as card_id, c.name, c.image, c.tcgp_product_id, s.name as set_name, s.code as set_code, c.local_id,
           a.market as from_price, z.market as to_price,
           round((z.market - a.market) / a.market * 100, 1) as pct
    from base cross join b
    join public.card_prices_daily z on z.day = b.last_day
    join public.card_prices_daily a on a.card_id = z.card_id and a.day = base.base_day
    join public.cards c on c.id = z.card_id
    join public.sets s on s.id = c.set_id and not s.hidden
    where base.base_day is not null and base.base_day < b.last_day
      and a.market >= 1 and z.market >= 1 and z.market <> a.market
      and (not coalesce(p_standard, true) or c.legal_standard)
  ), lim as (select least(greatest(coalesce(p_limit, 20), 1), 100) as n)
  select jsonb_build_object(
    'last_day', (select last_day from b),
    'base_day', (select base_day from base),
    'risers', coalesce((select jsonb_agg(to_jsonb(r)) from (select * from moves where pct > 0 order by pct desc, to_price desc limit (select n from lim)) r), '[]'::jsonb),
    'fallers', coalesce((select jsonb_agg(to_jsonb(r)) from (select * from moves where pct < 0 order by pct asc, to_price desc limit (select n from lim)) r), '[]'::jsonb))
$$;
grant execute on function public.card_price_history(text, int) to anon, authenticated;
grant execute on function public.price_movers(int, int, boolean) to anon, authenticated;

select cron.schedule('benchmark-price-snapshot', '40 6 * * *', 'select public.snapshot_card_prices()');
