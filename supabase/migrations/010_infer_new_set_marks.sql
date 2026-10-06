-- New sets sometimes reach the card database before their regulation marks do
-- (30th Celebration arrived with none). Until the marks show up, a set released
-- on or after the newest set that has a mark takes that set's mark, so its cards
-- become Standard legal on schedule. Real marks replace the guess as soon as they sync.
create or replace function public.recompute_legality()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  std_mark text;
  exp_from date;
  nxt record;
  res jsonb;
  newest_date date;
  newest_mark text;
begin
  select greatest(fr.min_mark, coalesce((select max(r.new_min_mark) from public.rotations r where r.effective_date <= current_date), fr.min_mark))
    into std_mark from public.format_rules fr where fr.format = 'standard';
  select min_release into exp_from from public.format_rules where format = 'expanded';
  select * into nxt from public.rotations r
    where r.new_min_mark > std_mark and (r.effective_date is null or r.effective_date > current_date)
    order by r.new_min_mark limit 1;
  select s.release_date, s.reg_mark into newest_date, newest_mark from public.sets s
    where s.reg_mark ~ '^[A-Z]$' and not s.hidden and not s.is_classic
    order by s.release_date desc nulls last, s.reg_mark desc limit 1;

  with base as (
    select c.id, c.name, c.sig, c.category, c.is_basic_energy, s.is_classic, s.legal_date,
           coalesce(nullif(c.reg_mark, ''),
                    case when not c.is_basic_energy then nullif(s.reg_mark, '') end,
                    case when not c.is_basic_energy and not s.hidden and not s.is_classic
                              and s.release_date >= newest_date then newest_mark end,
                    '') as mark,
           (s.legal_date is null or s.legal_date <= current_date) as live,
           (s.release_date is not null and s.release_date >= exp_from) as exp_era,
           c.legal_standard as old_std
    from public.cards c join public.sets s on s.id = c.set_id
  ), f as (
    select base.*,
           (mark ~ '^[A-Z]$' and mark >= std_mark) as mark_ok,
           (nxt.new_min_mark is null or (mark ~ '^[A-Z]$' and mark >= nxt.new_min_mark)) as mark_next
    from base
  ), g as (
    select sig, bool_or(live and mark_ok) as a_std, bool_or(mark_ok and mark_next) as a_next, bool_or(live and exp_era) as a_exp
    from f where sig <> '' group by sig
  ), bn as (
    select x.card_id, array_agg(distinct b.format order by b.format) as formats
    from public.bans b cross join lateral unnest(b.card_ids) as x(card_id)
    where b.active and (b.effective_date is null or b.effective_date <= current_date)
    group by x.card_id
  ), r0 as (
    select f.id, f.name, f.old_std, coalesce(bn.formats, '{}') as banned,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.mark_ok and (f.live or coalesce(g.a_std, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_std, false) or (f.live and f.mark_ok)))
      ) as std_raw,
      (not f.is_classic) and (
        f.is_basic_energy
        or (f.category = 'Pokemon' and f.mark_ok and f.mark_next)
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_next, false) or (f.mark_ok and f.mark_next)))
      ) as std_next,
      (not f.is_classic) and (
        (f.is_basic_energy and f.live)
        or (f.category = 'Pokemon' and f.exp_era and (f.live or coalesce(g.a_exp, false)))
        or (f.category <> 'Pokemon' and not f.is_basic_energy and (coalesce(g.a_exp, false) or (f.live and f.exp_era)))
      ) as exp_raw,
      f.live, f.mark_ok, f.is_classic, f.legal_date
    from f left join g on g.sig = f.sig left join bn on bn.card_id = f.id
  ), r as (
    select r0.*,
      (r0.std_raw and not ('standard' = any(r0.banned))) as std,
      (r0.exp_raw and not ('expanded' = any(r0.banned))) as exp,
      (r0.std_raw and not r0.std_next) as rot,
      case when not r0.std_raw and not r0.live and r0.mark_ok and not r0.is_classic then r0.legal_date end as std_from
    from r0
  ), upd as (
    update public.cards c set
      legal_standard = r.std,
      legal_expanded = r.exp,
      rotating = r.rot,
      rotating_on = case when r.rot then nxt.effective_date end,
      standard_from = r.std_from,
      banned_in = r.banned
    from r
    where r.id = c.id and (
      c.legal_standard is distinct from r.std
      or c.legal_expanded is distinct from r.exp
      or c.rotating is distinct from r.rot
      or c.rotating_on is distinct from (case when r.rot then nxt.effective_date end)
      or c.standard_from is distinct from r.std_from
      or c.banned_in is distinct from r.banned)
    returning c.id
  )
  select jsonb_build_object(
    'updated', (select count(*) from upd),
    'standard_legal', (select count(*) from r where r.std),
    'standard_min_mark', std_mark,
    'next_rotation', case when nxt.id is null then null else jsonb_build_object('mark', nxt.new_min_mark, 'date', nxt.effective_date) end,
    'became_legal', coalesce((select jsonb_agg(distinct r.name) from r where r.std and not r.old_std), '[]'),
    'became_illegal', coalesce((select jsonb_agg(distinct r.name) from r where not r.std and r.old_std), '[]'))
  into res;
  return res;
end $function$;

select public.recompute_legality();
