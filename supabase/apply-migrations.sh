#!/usr/bin/env bash
# Applies new files in supabase/migrations/ to the live database, oldest first, each exactly once.
# Uses Supabase's Management API (needs SUPABASE_ACCESS_TOKEN), so no database password is involved.
# Each file runs in one transaction together with the line that records it, so a failure changes nothing.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?Add the SUPABASE_ACCESS_TOKEN secret in the GitHub repo settings}"
REF="${PROJECT_REF:-rnujzhrfiqjfjqskekpt}"
API="${SUPABASE_API:-https://api.supabase.com}"
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"
SHA="${GITHUB_SHA:-local}"

run_sql() {  # prints the JSON rows the query returns
  jq -n --arg q "$1" '{query: $q}' | curl -sS --fail-with-body -X POST \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
    --data @- "$API/v1/projects/$REF/database/query"
}

# Where applied files are recorded (not exposed to the website's public API).
run_sql "create schema if not exists ci;
create table if not exists ci.migrations (file text primary key, applied_at timestamptz not null default now(), sha text);
revoke all on schema ci from anon, authenticated;" >/dev/null

# First run only: files that were applied by hand before this job existed.
if [ "$(run_sql 'select count(*)::int as n from ci.migrations' | jq '.[0].n')" = "0" ]; then
  list=$(grep -Ev '^\s*(#|$)' "$DIR/APPLIED_BEFORE_CI.txt" | jq -R . | jq -sc .)
  run_sql "insert into ci.migrations (file, sha)
           select x, 'before-ci' from jsonb_array_elements_text('$list'::jsonb) x on conflict do nothing;" >/dev/null
  echo "Recorded $(echo "$list" | jq length) migrations that were already applied."
fi

applied=$(run_sql 'select file from ci.migrations' | jq -r '.[].file')
count=0
for path in $(ls "$DIR"/*.sql | sort); do
  file=$(basename "$path")
  [[ "$file" =~ ^[0-9]{3}[a-z0-9_]*\.sql$ ]] || { echo "Skipping $file: name must look like 016_something.sql"; continue; }
  grep -qxF "$file" <<<"$applied" && continue
  echo "Applying $file"
  run_sql "begin;
$(cat "$path")
;
insert into ci.migrations (file, sha) values ('$file', '$SHA');
commit;" >/dev/null
  echo "  done"
  count=$((count + 1))
done
echo "Applied $count new migration(s)."
