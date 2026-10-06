-- Helpers used by the catalog-sync and rules-sync Edge Functions.
alter table public.cards add column if not exists tcgp jsonb not null default '{}'::jsonb; -- TCGplayer product per finish

-- Cards to fetch next: never-fetched (newest sets first), recent sets every 2 days, everything else every 45 days.
create or replace function public.cards_needing_detail(lim int, recent_from date)
returns table (id text)
language sql stable security definer set search_path = public as $$
  select q.id from (
    select c.id, 0 as pri, s.release_date as rel
      from public.cards c join public.sets s on s.id = c.set_id where c.detail_at is null
    union all
    select c.id, 1, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '2 days' and s.release_date >= recent_from
    union all
    select c.id, 2, s.release_date
      from public.cards c join public.sets s on s.id = c.set_id
      where c.detail_at < now() - interval '45 days'
  ) q
  order by q.pri, q.rel desc nulls first, q.id
  limit greatest(1, least(lim, 400))
$$;

-- Sets whose prices are older than 20 hours; tournament-era sets first.
create or replace function public.sets_needing_prices(lim int)
returns table (id text, tcgp_group_id int)
language sql stable security definer set search_path = public as $$
  select s.id, s.tcgp_group_id from public.sets s
  where s.prices_at is null or s.prices_at < now() - interval '20 hours'
  order by (s.release_date >= date '2011-04-25') desc nulls last, s.prices_at nulls first, s.release_date desc nulls last
  limit greatest(1, least(lim, 40))
$$;

create or replace function public.apply_prices(rows jsonb) returns int
language sql security definer set search_path = public as $$
  with u as (
    update public.cards c set
      tcgp_product_id = coalesce((r->>'tcgp_product_id')::int, c.tcgp_product_id),
      prices = coalesce(r->'prices', c.prices),
      prices_at = coalesce((r->>'prices_at')::timestamptz, c.prices_at)
    from jsonb_array_elements(rows) r
    where c.id = r->>'id'
    returning 1
  ) select count(*)::int from u
$$;

-- Each set's usual regulation mark, used for cards TCGdex hasn't tagged yet.
create or replace function public.refresh_set_marks() returns void
language sql security definer set search_path = public as $$
  update public.sets s set reg_mark = m.mark
  from (
    select set_id, mode() within group (order by reg_mark) as mark
    from public.cards where reg_mark ~ '^[A-Z]$' and not is_basic_energy group by set_id
  ) m
  where m.set_id = s.id and s.reg_mark is distinct from m.mark
$$;

revoke execute on function public.cards_needing_detail(int, date) from public, anon, authenticated;
revoke execute on function public.sets_needing_prices(int) from public, anon, authenticated;
revoke execute on function public.apply_prices(jsonb) from public, anon, authenticated;
revoke execute on function public.refresh_set_marks() from public, anon, authenticated;
