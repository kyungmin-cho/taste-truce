# Taste Truce on Cloudflare Pages

This folder runs the same app as `server.py` on Cloudflare Pages: the built interface and `/classic` are static files, and Pages Functions serve the API. The Functions are a TypeScript port of the Python server. They have the same endpoints, the same 20 KB request limit, the same validation and error messages, and the same agent steps. `tests/test_pages.py` sends the same requests to both servers and compares the answers.

| Path | Served by |
|---|---|
| `/`, `/classic`, `/assets/*`, `/app.js`, `/vendor/leaflet/*` … | static files in `dist/` (`npm run build`). `/` and `/classic` also pass through a Function that sets the session cookie |
| `GET /api/config`, `GET /health`, `GET /scene/<name>`, `POST /api/plan` | `functions/`, code in `src/` |

## Storage

- **KV `CACHE`**: the Qloo response cache and the saved scenes. It is filled once from a local response cache with `seed_kv.py` and is never committed. Each response stores only its scores. Each place is stored once under a content hash and read with bulk gets, so a plan stays within the Workers Free CPU budget. Every new Qloo response the Functions fetch is one more KV write.
- **D1 `DB`**: the sessions and call counters behind the Python server's limits. These are the session call cap, the monthly cap with its reserve, the per-IP daily session and call caps, and the 5-per-second pacing. Each check is one conditional `UPDATE`, so it holds across isolates. The tables are created on first use.
- **Session cookie**: an HMAC over a random id, the issue time and a hash of the visitor's IP, so opening the page writes nothing. Set `SESSION_SECRET`.

Pages adds three limits that the Python server does not have, to keep inside the free quotas:

| Variable | Default | Why |
|---|---|---|
| `DAILY_CALL_CAP` | 500 | Qloo calls per day across all visitors. Each new response is a KV write, and KV Free allows 1,000 writes a day |
| `IP_DAILY_PLAN_CAP` | 200 | plans per IP per day. Plans served from the cache still read KV |
| `DAILY_PLAN_CAP` | 600 | plans per day in total, about 60,000 of the 100,000 daily KV reads |

The Python server's variables (`SESSION_CALL_CAP`, `MONTHLY_CALL_CAP`, `MONTHLY_RESERVED_CALLS`, `IP_DAILY_SESSION_CAP`, `IP_DAILY_CALL_CAP`, `SESSION_TTL_SECONDS`, `QLOO_CACHE_TTL_SECONDS`, `DEFAULT_SCENE`, `DEFAULT_SCENE_TTL_SECONDS`, `LLM_*`) mean the same here.

## Run locally

```sh
(cd ../web && npm ci && npm run build)
npm ci && npm run build
# Seed a local KV from a Qloo response cache. Keep the bulk file outside the repository.
python3 seed_kv.py --cache-dir ~/.cache/taste-truce/responses --out /tmp/taste-truce-kv.json
npx wrangler kv bulk put /tmp/taste-truce-kv.json --binding CACHE --local --persist-to /tmp/taste-truce-pages
npx wrangler pages dev --persist-to /tmp/taste-truce-pages --binding SESSION_SECRET=$(openssl rand -hex 24)
```

Without `QLOO_API_KEY`, only cached requests succeed and the rest end with the same "Set QLOO_API_KEY" error as the Python server.

## Deploy

```sh
npx wrangler kv namespace create taste-truce-cache     # put the id in wrangler.toml
npx wrangler d1 create taste-truce                     # put the database_id in wrangler.toml
npx wrangler kv bulk put /tmp/taste-truce-kv.json --binding CACHE --remote
npx wrangler pages project create taste-truce --production-branch main
npx wrangler pages secret put QLOO_API_KEY --project-name taste-truce
npx wrangler pages secret put SESSION_SECRET --project-name taste-truce
npm run build && npx wrangler pages deploy --branch main
```

## Tests

- `npm test`: sessions, limits and pacing on D1, with `node:sqlite` standing in.
- `npm run typecheck`
- `python3 -m unittest discover -s tests` from the parent folder includes `test_pages.py`. It runs the parity flows on synthetic data, and also on a real cache when `TRUCE_CACHE_CHECK_DIR` is set.
- `node test/bench.ts <bulk file>` prints the CPU time of each route.
