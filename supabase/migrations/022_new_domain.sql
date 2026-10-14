-- Benchmark now lives at benchmarktcg.us; point the data-collector contact URL there.

create or replace function public.tourney_get(p_kind text, p_url text, p_tid int default null, p_place int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmarktcg.us; daily cache)'),
    timeout_milliseconds := 20000);
  insert into public.tourney_fetch (net_id, kind, tournament_id, place) values (nid, p_kind, p_tid, p_place);
end $$;

create or replace function public.mu_get(p_kind text, p_url text, p_event text default null, p_round int default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare nid bigint;
begin
  nid := net.http_get(url := p_url,
    headers := jsonb_build_object('User-Agent', 'Benchmark-DeckBuilder/2.0 (+https://benchmarktcg.us; matchup stats, cached)'),
    timeout_milliseconds := 30000);
  insert into public.mu_fetch (net_id, kind, event_id, round) values (nid, p_kind, p_event, p_round);
end $$;
