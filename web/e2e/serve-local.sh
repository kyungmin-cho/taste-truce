#!/bin/sh
# A keyless local Pages server for the E2E tests. Run from pages/: sh ../web/e2e/serve-local.sh <port> <state dir>
# The local KV is seeded from the Qloo response cache on this machine (seed_kv.py), Qloo points at a closed
# port and no LLM variable is set, so a request the cache cannot answer fails instead of calling Qloo.
# Only wrangler's local state is used (--persist-to, never --remote). The state holds cached Qloo data,
# so it is deleted when the server stops.
set -eu
PORT=$1; STATE=$2
case "$PORT" in 3000) echo 'Port 3000 is not for tests.' >&2; exit 2;; esac
for v in $(env | cut -d= -f1 | grep -E 'QLOO|LLM|CLOUDFLARE|CF_API|SESSION_|TRUCE_' || true); do unset "$v"; done
export WRANGLER_SEND_METRICS=false
W="npx --no-install wrangler"
DEV=
trap 'kill $DEV 2>/dev/null || true; wait $DEV 2>/dev/null || true; rm -rf "$STATE"' EXIT INT TERM
rm -rf "$STATE"; mkdir -p "$STATE"
$W d1 execute taste-truce --local --persist-to "$STATE" --file schema.sql > "$STATE/schema.log" 2>&1
python3 -I seed_kv.py --cache-dir "${TRUCE_E2E_CACHE:-$HOME/.cache/taste-truce/responses}" --out "$STATE/seed/kv.json" > "$STATE/seed.log"
$W kv bulk put "$STATE/seed/kv.json" --binding CACHE --local --persist-to "$STATE" > "$STATE/kv.log" 2>&1
rm -rf "$STATE/seed"
$W pages dev --ip 127.0.0.1 --port "$PORT" --persist-to "$STATE" --binding SESSION_SECRET=local-e2e-only --binding QLOO_BASE_URL=http://127.0.0.1:9 &
DEV=$!
wait $DEV
