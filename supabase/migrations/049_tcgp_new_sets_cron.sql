-- New sets reach TCG Live and TCGplayer days before TCGdex: catalog-tcgp fills them in from TCGplayer's listings.
-- Every 3 hours is plenty (TCGCSV refreshes daily) and it does nothing when no recent set is missing.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'benchmark-catalog-tcgp') then
    perform cron.unschedule('benchmark-catalog-tcgp');
  end if;
  perform cron.schedule('benchmark-catalog-tcgp', '7 */3 * * *', $c$select public.call_edge('catalog-tcgp', '{}'::jsonb)$c$);
end $$;
