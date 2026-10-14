#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres, then runs japan-test.sql (022: Japan preview).
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
for m in "$ROOT"/supabase/migrations/02[2-9]_japan*.sql; do "${P[@]}" -f "$m" >/dev/null 2>&1 || { echo "FAIL | $(basename "$m") is not safe to run twice"; "${P[@]}" -f "$m" 2>&1 | grep ERROR | head -3; exit 1; }; done
"${P[@]}" -f "$HERE/japan-test.sql" 2>&1 | sed -E 's/^psql:[^ ]+ ?//; s/^NOTICE:  //' | grep -E "PASS|FAIL|ERROR|WARNING" | tee "$TMP/out"
! grep -qE "FAIL|ERROR" "$TMP/out"
