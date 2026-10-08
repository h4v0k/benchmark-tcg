#!/usr/bin/env bash
# Tests supabase/apply-migrations.sh against a throwaway Postgres behind a fake Supabase API.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
TMP=$(mktemp -d); AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; chmod 755 "$TMP"; fi
PORT=$((20000 + RANDOM % 20000)); APIPORT=$((PORT + 1))
cleanup() { kill "${API_PID:-0}" 2>/dev/null || true; "${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"${AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --locale=C --no-sync >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -w -s -o "-k $TMP -p $PORT -c listen_addresses='' -c fsync=off -c timezone=UTC" start
P=(psql -h "$TMP" -p "$PORT" -U postgres)
"${P[@]}" -X -q -v ON_ERROR_STOP=1 -f "$HERE/stubs.sql"
python3 "$HERE/fake-supabase-api.py" "$APIPORT" "${P[@]}" & API_PID=$!
sleep 1
export SUPABASE_ACCESS_TOKEN=test-token SUPABASE_API="http://127.0.0.1:$APIPORT" GITHUB_SHA=testsha
fail=0; check() { if eval "$2"; then echo "PASS | $1"; else echo "FAIL | $1"; fail=1; fi; }
n() { "${P[@]}" -X -At -c "$1"; }

out=$(bash "$ROOT/supabase/apply-migrations.sh" 2>&1); echo "$out" | sed 's/^/    /'
check "first run records 14 earlier migrations" '[ "$(n "select count(*) from ci.migrations where sha = '"'"'before-ci'"'"'")" = 14 ]'
check "first run applies the new ones (015, 016, 017)" '[ "$(n "select string_agg(file, '"'"','"'"' order by file) from ci.migrations where sha = '"'"'testsha'"'"'")" = "015_matchups.sql,016_matchups_catchup.sql,017_winning_lists.sql" ]'
check "really applied (tables, functions, 3 cron jobs)" '[ "$(n "select (to_regclass('"'"'public.mu_events'"'"') is not null)::text || (to_regprocedure('"'"'public.mu_tick(int,boolean,int)'"'"') is not null)::text || (select count(*) from cron.job)")" = "truetrue3" ]'

out=$(bash "$ROOT/supabase/apply-migrations.sh" 2>&1)
check "second run applies nothing" 'grep -q "Applied 0 new migration" <<<"$out"'

# a broken migration: fails, nothing from it sticks, job exits non-zero
printf "create table public.half_done (id int);\nselect this_is_not_valid_sql;\n" > "$ROOT/supabase/migrations/099_broken_test.sql"
set +e; out=$(bash "$ROOT/supabase/apply-migrations.sh" 2>&1); rc=$?; set -e
rm -f "$ROOT/supabase/migrations/099_broken_test.sql"
check "broken migration makes the job fail" '[ "$rc" != 0 ]'
check "broken migration leaves nothing behind (no table, not recorded)" '[ "$(n "select (to_regclass('"'"'public.half_done'"'"') is null)::text || (select count(*) from ci.migrations where file like '"'"'099%'"'"')")" = "true0" ]'

# a good new migration after that
printf "create table public.later_change (id int);\n" > "$ROOT/supabase/migrations/098_later_test.sql"
out=$(bash "$ROOT/supabase/apply-migrations.sh" 2>&1); rm -f "$ROOT/supabase/migrations/098_later_test.sql"
check "a later migration is applied once" '[ "$(n "select (to_regclass('"'"'public.later_change'"'"') is not null)::text || (select count(*) from ci.migrations where file = '"'"'098_later_test.sql'"'"')")" = "true1" ]'

SUPABASE_ACCESS_TOKEN=wrong; set +e; out=$(bash "$ROOT/supabase/apply-migrations.sh" 2>&1); rc=$?; set -e
check "a wrong token fails loudly" '[ "$rc" != 0 ]'
exit $fail
