# Taste Truce

Three friends. Three playlists. One shared table, with the trade-offs in plain sight.

A working dinner-consensus agent powered by Qloo's cross-domain taste graph. The first scene is **Fri 7 p.m. · Seongsu · Dinner · 3 friends**. A Williamsburg NYC scene is also available. Edit the prefilled films, artists, and brands, then select **Find our common ground**.

## Run locally

Requires Python 3.9+; no Python packages or build step are needed.

```sh
cp .env.example .env
# Set QLOO_API_KEY and QLOO_BASE_URL in .env.
# The hackathon API base URL is https://hackathon.api.qloo.com.
python3 server.py
```

Open http://localhost:3000. Only the server reads provider credentials. Alternatively use `ENV_FILE=/path/to/private.env python3 server.py`. The server binds to localhost by default. Leaflet is served locally with its license; OpenStreetMap tiles require internet access. Results remain readable if tiles cannot load.

Optional settings can be omitted or removed from `.env`: `SESSION_CALL_CAP` (30), `QLOO_CACHE_DIR` (`~/.cache/taste-truce/responses`), `QLOO_STATE_DIR` (`~/.local/state/taste-truce`), `MONTHLY_CALL_CAP` (8000 maximum), `MONTHLY_RESERVED_CALLS` (1000), `QLOO_CACHE_TTL_SECONDS` (86400), `HOST` (`127.0.0.1`), `PORT` (3000), `IP_DAILY_SESSION_CAP` (20), `IP_DAILY_CALL_CAP` (100), `MAX_SESSIONS` (1000), `SESSION_TTL_SECONDS` (86400), `TRUSTED_PROXY_HEADER`, `TRUSTED_PROXY_IPS`, and `COOKIE_SECURE` (0).

Warm both default dinner scenes before first use (uses the normal call budgets and default cache directory):

```sh
python3 prewarm.py
```

The one-click swap replaces BTS with Miles Davis and shows actual changes, including when the shared pick stays the same. No popularity cap or trend bias override is applied.

## Docker

```sh
docker build -t taste-truce .
docker run --rm -p 3000:3000 --env-file .env -v taste-truce-data:/data taste-truce
```

The image runs as an unprivileged user. The volume at `/data` preserves the private cache and SQLite monthly budget across container restarts. All workers must share the same state directory; use one persistent service instance. Never put state or caches in git or a public image. The default 1000-call monthly reserve covers prior external usage; increase it to cover additional use of the same key elsewhere. A lost state volume resets accounting, so restore it before restarting a public service. Ephemeral free hosts need a persistent external budget store before public use.

## Agent behavior

1. Resolve each taste seed through `/search`. A unique exact typed match is accepted. Multiple place matches, multiple exact matches, and uncertain matches prompt a choice with names, types, and addresses.
2. Select category tags for the occasion. Dinner requires both restaurant and dinner tags (`intersection`), plus an appropriate primary genre. Tagged retail false positives and closed places are removed.
3. Retrieve candidates for each friend alongside a no-signal baseline. If fewer than five eligible places survive, expand radius/take from 2 km/30 to 3.5 km/40, then 5 km/50.
4. Rescore the union with `filter.results.entities` for each friend's signal. Compare ranks within each person's returned pool. Minimize the worst personal rank, then rank sum, then entity ID. This avoids assuming affinity magnitudes are calibrated between people.
5. If the union exceeds 50, take the largest equal per-person top-k whose union fits the ceiling, then rescore that same pool for everyone. If full numeric rescore coverage fails, expand individual retrieval to take 50 and use rank sum. Missing candidates receive a penalty one beyond the pool size and are marked unknown, never reported as measured ranks.
6. Explain the rank drop from each signal's #1, with recorded tag differences and Qloo seed contributions from `feature.explainability`. Language describes groups with shared interests, not predicted personal enjoyment.

**Veto** any listed place, or enter requests such as `no bars please`, `somewhere quieter`, `not that place`, `cheaper`, or `add a vegetarian friend`. Quietness uses recorded ambience tags, budget requires a recorded price level, and vegetarian options require recorded offerings; confirm these conditions with the venue. New friends are asked for a cultural taste. Exclusions persist through replanning and apply to baseline results too. Reset exclusions to clear them. **Taste off** switches the map and list to the popularity baseline and reports its ID overlap with the taste shortlist. Popularity is sorted within Qloo's no-signal returned sample; it is not a census of nearby businesses.

The right panel streams tool names, input entities, returned counts, latency, and live/cache status. Open an entity detail to inspect the rescoring pool. Colored pins show each person's top three; the shared pick has a dark pin. A rank is always relative to this candidate pool.

## Optional planner

Set all three variables to use an OpenAI-compatible `/chat/completions` endpoint:

- `LLM_BASE_URL`: API root, including `/v1` if required.
- `LLM_API_KEY`: server-only credential.
- `LLM_MODEL`: model identifier.

The planner converts requests into validated tools for exclusions, radius, area, occasion, budget and adding a friend. Scoring and concession evidence stay deterministic. If no endpoint is configured, or it fails, a local intent parser handles common English and Korean requests. The steps panel identifies which planner ran. The configured endpoint receives the request and scene inputs; provider credentials stay on the server.

## Limits and scope

The shared server limiter starts at most four Qloo requests in any 1.25-second window, at least 0.30 seconds apart. Cache keys include the full request; identical concurrent misses coalesce. Uncached requests count against a server-held session budget, including failures. Replanning is serialized per session. The monthly and per-IP daily budgets persist in SQLite; session budgets last until expiry or eviction. GET `/` issues a session cookie; unknown-session POSTs are rejected. Sessions expire after one day and are capped at 1000 entries. Per-IP daily defaults are 20 new sessions and 100 uncached calls. Set `TRUSTED_PROXY_HEADER` and `TRUSTED_PROXY_IPS` together only for known proxy peers; other clients use the socket address. Set `COOKIE_SECURE=1` behind HTTPS. Server-side errors omit upstream bodies and credentials.

Friday 7 p.m. is a planning scene. Opening hours, live availability, bookings, allergies, travel time, and actual group satisfaction are not verified. Fewer than five eligible options can remain after all retries; the UI reports the actual count. Scene links contain only inputs and resolve tastes again on reload. There are no reservations, accounts, or deployment automation. The title is a working name.

## Tests

```sh
python3 -m unittest discover -s tests -v
```

Tests use synthetic data only. They cover maximin versus rank sum, incomplete coverage, recorded concessions, category/veto filtering, and ambiguity.

## Files

- `server.py`: HTTP routes, sessions, streamed events.
- `qloo.py`: server-only transport, rate limit, private cache, call budgets.
- `agent.py`: resolution, clarification, adaptive retrieval, rescoring and replanning.
- `logic.py`: consensus and concession rules.
- `static/`: English interface and Leaflet map with OpenStreetMap attribution.

MIT licensed. Qloo data is fetched at runtime; none is included in this repository.
