#!/usr/bin/env bash
# Applies every migration (001..N) to a throwaway Postgres, re-runs 018+, then runs chain-test.sql:
# row-level security after 018, matchup_decks, and the weighted winning lists from 019.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
TMP=$(mktemp -d); AS=()
if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); chown postgres "$TMP"; chmod 755 "$TMP"; fi
PORT=$((20000 + RANDOM % 20000))
trap '"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
"${AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --locale=C --no-sync >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -w -s -o "-k $TMP -p $PORT -c listen_addresses='' -c fsync=off -c timezone=UTC" start
P=(psql -h "$TMP" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${P[@]}" -f "$HERE/stubs.sql"; PGOPTIONS="-c client_min_messages=warning" "${P[@]}" -f "$HERE/stubs-full.sql"
for m in "$ROOT"/supabase/migrations/0*.sql; do "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL | $(basename "$m") does not apply"; "${P[@]}" -f "$m" 2>&1 | grep ERROR | head -3; exit 1; }; done
# re-running a migration right after itself must be harmless (CI retries a failed run)
for m in "$ROOT"/supabase/migrations/01[8-9]*.sql "$ROOT"/supabase/migrations/0[2-9][0-9]*.sql; do [ -f "$m" ] || continue
  "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL | $(basename "$m") is not safe to run twice"; exit 1; }; done
echo "PASS | all migrations apply; 018+ can run again"
"${P[@]}" -f "$HERE/chain-test.sql" 2>&1 | sed -E 's/^psql:[^ ]+ ?//; s/^NOTICE:  //' | grep -E "PASS|FAIL|ERROR" | tee "$TMP/out"
! grep -qE "FAIL|ERROR" "$TMP/out"
