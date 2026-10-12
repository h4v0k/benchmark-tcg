-- Run the catalog sync every 15 minutes instead of every 2.
-- At */2 nearly every run found nothing to do (720 runs/day, ~53 did work).
-- Each run prices up to 8 sets; ~220 sets need a refresh every 20 hours (~265/day),
-- and 96 runs/day x 8 sets = 768/day, so prices still keep up with room to spare.
-- Card details (up to 350 per run) and the 12-hour sets check are unaffected.
-- cron.schedule with an existing name updates that job, so re-running this is safe.
select cron.schedule('benchmark-catalog-sync', '*/15 * * * *',
  $$select public.call_edge('catalog-sync', '{"job":"auto","limit":350}'::jsonb)$$);

-- Keep one week of sync logs. The admin page shows the latest 25 and the sync
-- code only looks back 12 hours, so nothing reads older rows.
select cron.schedule('benchmark-sync-runs-cleanup', '33 4 * * *',
  $$delete from public.sync_runs where started_at < now() - interval '7 days'$$);

-- Clear the backlog of old logs now rather than waiting for the first nightly run.
delete from public.sync_runs where started_at < now() - interval '7 days';
