#!/usr/bin/env bash
# Strict type check of the non-React code (src/lib, src/config). React type definitions aren't installed here,
# so .tsx files can't be checked; this still catches mistakes like calling something that isn't a function.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TSC=${TSC:-$(command -v tsc || echo /opt/npm-tools/node_modules/.bin/tsc)}
cd "$ROOT"
$TSC -p tests/tsconfig.lib.json
echo "PASS | src/lib type-checks"
