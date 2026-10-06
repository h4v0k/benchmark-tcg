-- YouTube description import. YouTube rate-limits the Edge Function servers, so the database
-- fetches the watch page with pg_net and the site polls for the result.
create table if not exists public.import_requests (
  id uuid primary key default gen_random_uuid(),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  requested_by uuid default auth.uid(),
  net_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists import_requests_recent on public.import_requests (created_at desc);
alter table public.import_requests enable row level security;
-- no policies: only the functions below touch it

create or replace function public.youtube_request(p_video text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare rid uuid; nid bigint; per_hour int := 40;
begin
  if p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'That is not a YouTube video id'; end if;
  if auth.uid() is null then per_hour := 10; end if;
  if (select count(*) from public.import_requests where created_at > now() - interval '1 hour'
        and requested_by is not distinct from auth.uid()) >= per_hour
     or (select count(*) from public.import_requests where created_at > now() - interval '1 hour') >= 600 then
    raise exception 'Too many imports right now. Try again in a little while.';
  end if;
  nid := net.http_get(
    url := 'https://www.youtube.com/watch?v=' || p_video || '&hl=en',
    headers := jsonb_build_object('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
                                  'Accept-Language', 'en-US,en;q=0.9', 'Cookie', 'SOCS=CAI; CONSENT=YES+1'),
    timeout_milliseconds := 15000);
  insert into public.import_requests (video_id, net_id) values (p_video, nid) returning id into rid;
  return rid;
end $$;

-- Returns {pending:true} until the page arrives, then {title, author, description} or {error}.
create or replace function public.youtube_result(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r record; body text; t text; a text; d text; reason text;
begin
  select q.created_at, q.requested_by, h.status_code, h.content, h.error_msg, h.timed_out
    into r
    from public.import_requests q left join net._http_response h on h.id = q.net_id
    where q.id = p_id;
  if not found then return jsonb_build_object('error', 'Unknown import'); end if;
  if r.requested_by is distinct from auth.uid() then return jsonb_build_object('error', 'Unknown import'); end if;
  if r.status_code is null and r.error_msg is null and coalesce(r.timed_out, false) = false then
    if r.created_at < now() - interval '40 seconds' then return jsonb_build_object('error', 'YouTube took too long to answer. Try again.'); end if;
    return jsonb_build_object('pending', true);
  end if;
  if r.status_code is distinct from 200 then
    if r.status_code = 429 then return jsonb_build_object('error', 'YouTube is limiting requests right now. Paste the list from the description instead.'); end if;
    return jsonb_build_object('error', coalesce('YouTube returned ' || r.status_code, r.error_msg, 'YouTube did not answer.'));
  end if;
  body := r.content;
  -- The description is in the player response (shortDescription) or, on some pages, only in the
  -- page data (attributedDescription).
  d := substring(body from '"shortDescription":"((?:[^"\\]|\\.)*)"');
  if d is null then d := substring(body from '"attributedDescription":\{"content":"((?:[^"\\]|\\.)*)"'); end if;
  if d is null then
    reason := substring(body from '"playabilityStatus":\{"status":"[A-Z_]+","reason":"((?:[^"\\]|\\.)*)"');
    return jsonb_build_object('error', coalesce(reason, 'Couldn''t read that video''s description. It may be private or age-restricted.'));
  end if;
  t := substring(body from '"playerOverlayVideoDetailsRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"');
  if t is null then t := substring(body from '"videoDetails":\{"videoId":"[^"]*","title":"((?:[^"\\]|\\.)*)"'); end if;
  a := substring(body from '"ownerChannelName":"((?:[^"\\]|\\.)*)"');
  if a is null then a := substring(body from '"subtitle":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"'); end if;
  return jsonb_build_object(
    'title', coalesce(('"' || t || '"')::jsonb #>> '{}', ''),
    'author', coalesce(('"' || a || '"')::jsonb #>> '{}', ''),
    'description', coalesce(('"' || d || '"')::jsonb #>> '{}', ''));
end $$;

grant execute on function public.youtube_request(text) to anon, authenticated;
grant execute on function public.youtube_result(uuid) to anon, authenticated;
