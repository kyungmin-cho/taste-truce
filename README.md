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

Open http://localhost:3000. Only the server reads provider credentials. Alternatively use `ENV_FILE=/path/to/private.env python3 server.py`. The server binds to localhost by default. Leaflet, fonts, and OpenStreetMap tiles require internet access; results remain readable if the map cannot load.

Optional settings can be omitted or removed from `.env`: `SESSION_CALL_CAP` (30), `QLOO_CACHE_DIR` (`~/.cache/taste-truce/responses`), `QLOO_STATE_DIR` (`~/.local/state/taste-truce`), `MONTHLY_CALL_CAP` (8000 maximum), `MONTHLY_RESERVED_CALLS` (1000), `QLOO_CACHE_TTL_SECONDS` (86400), `HOST` (`127.0.0.1`), and `PORT` (3000).

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
5. If full numeric rescore coverage fails, or the union exceeds the API take ceiling of 50, expand individual retrieval to take 50 and use rank sum. Missing candidates receive a penalty one beyond the pool size and are marked unknown, never reported as measured ranks.
6. Explain the rank drop from each signal's #1, with recorded tag differences. Language describes groups with shared interests, not predicted personal enjoyment.

**Veto** any listed place, or enter `no bars` / `not that place`. Exclusions persist through replanning and apply to baseline results too. Reset exclusions to clear them. **Taste off** switches the map and list to the popularity baseline and reports its ID overlap with the taste shortlist. Popularity is sorted within Qloo's no-signal returned sample; it is not a census of nearby businesses.

The right panel streams tool names, input entities, returned counts, latency, and live/cache status. Open an entity detail to inspect the rescoring pool. Colored pins show each person's top five; the shared pick has a dark pin. A rank is always relative to this candidate pool.

## Optional narration

Set all three variables to use an OpenAI-compatible `/chat/completions` endpoint:

- `LLM_BASE_URL`: API root, including `/v1` if required.
- `LLM_API_KEY`: server-only credential.
- `LLM_MODEL`: model identifier.

Without these, deterministic, data-grounded sentences provide the complete experience. Optional model narration is additional and cannot change the decision or concession evidence. If it fails or times out, templates remain available. It sends only the selected place and concession evidence to the configured service.

## Limits and scope

The shared server limiter starts at most five Qloo requests in any 1.05-second window. Cache keys include the full request; identical concurrent misses coalesce. Uncached requests count against a server-held session budget, including failures. Replanning is serialized per session. Budgets are in memory and reset on server restart; this local skeleton is not a hardened public service. Server-side errors omit upstream bodies and credentials.

Friday 7 p.m. is a planning scene. Opening hours, live availability, bookings, allergies, travel time, and actual group satisfaction are not verified. Fewer than five eligible options can remain after all retries; the UI reports the actual count. There are no reservations, accounts, share links, or deployment automation. The title is a working name.

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
