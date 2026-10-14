-- "Report an issue" form in the site footer. Rows are written only by the report-issue
-- Edge Function (service role), which also emails them. Admins can read and close them.
create table if not exists public.issue_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message text not null check (char_length(message) between 5 and 4000),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  page_url text check (page_url is null or char_length(page_url) <= 1000),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  user_id uuid references auth.users(id) on delete set null,
  ip_hash text,
  emailed_at timestamptz,
  email_error text,
  resolved boolean not null default false
);
create index if not exists issue_reports_recent on public.issue_reports (created_at desc);
create index if not exists issue_reports_ip on public.issue_reports (ip_hash, created_at desc);

alter table public.issue_reports enable row level security;
revoke all on public.issue_reports from anon, authenticated;
grant select, update (resolved) on public.issue_reports to authenticated;

drop policy if exists issue_reports_admin_read on public.issue_reports;
create policy issue_reports_admin_read on public.issue_reports for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin));
drop policy if exists issue_reports_admin_update on public.issue_reports;
create policy issue_reports_admin_update on public.issue_reports for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin))
  with check (true);
