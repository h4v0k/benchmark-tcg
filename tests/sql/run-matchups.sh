#!/usr/bin/env bash
# Throwaway-Postgres test for supabase/migrations/015_matchups.sql
# Usage: tests/sql/run-matchups.sh      (env: PGBIN, MIGRATION)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
MIGRATION=${MIGRATION:-$ROOT/supabase/migrations/015_matchups.sql}
TMP=$(mktemp -d)
AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; chmod 755 "$TMP"; fi
PORT=$((20000 + RANDOM % 20000))
cleanup() {
  "${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT
"${AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --locale=C --no-sync >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -w -s \
  -o "-k $TMP -p $PORT -c listen_addresses='' -c fsync=off -c timezone=UTC" start
P=(psql -h "$TMP" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
echo "== stubs";            "${P[@]}" -f "$HERE/stubs.sql"
echo "== migration (1st)";  "${P[@]}" -f "$MIGRATION"
echo "== migration (2nd, re-run)"; "${P[@]}" -f "$MIGRATION"
echo "PASS | migration applies cleanly twice"
echo "== tests"
set +e
"${P[@]}" -f "$HERE/matchups-test.sql" >"$TMP/test.out" 2>&1
RC=$?
sed -E 's/^psql:[^ ]+ ?//; s/^NOTICE:  //' "$TMP/test.out" | grep -E "PASS|FAIL|ERROR|SUMMARY|WARNING|DETAIL|LINE|HINT" || true
if [ "$RC" -eq 0 ] && grep -q "FAIL |" "$TMP/test.out"; then RC=3; fi
exit "$RC"
