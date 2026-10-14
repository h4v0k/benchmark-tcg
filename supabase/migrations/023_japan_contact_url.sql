-- The Japan collector (022) was written before the move to benchmarktcg.us; use the new contact URL.
create or replace function public.jp_get(p_kind text, p_url text, p_tid text default null, p_place int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmarktcg.us; Japan preview, daily cache)'),
    timeout_milliseconds := 20000);
  insert into public.jp_fetch (net_id, kind, tournament_id, place) values (nid, p_kind, p_tid, p_place);
end $$;
revoke execute on function public.jp_get(text, text, text, int) from public, anon, authenticated;
