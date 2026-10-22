# Taste Truce

Taste Truce proves who concedes what when friends with different tastes pick a place.

Each friend brings a few films, artists, or brands. Qloo turns those tastes into a ranking of the same candidate places for every person. The agent then picks the place where the worst-off friend concedes the least and shows the evidence as a concession table: one row per place, one column per friend, and each cell is that friend's rank for that place.

Live demo: <DEMO_URL>

## The 30-second demo path

1. Open the demo. The first screen is a saved scene: Williamsburg, dinner, Friday 7 p.m., three friends. It loads from a stored snapshot, so opening the page makes no Qloo call.
2. Read the concession table. Its rows are the most popular place, each friend's own #1, a majority #1 when there is one, and the fair pick; a place that is several of these gets one row with every label. The worst rank in each row is highlighted. In the saved Williamsburg scene the fair pick is also the most popular place and friend 3's #1, ranking 8·8·1. Choosing either other friend's #1 instead would push someone down to #49 or #40.
3. Choose the "Williamsburg · majority / minority" preset. Two friends share a #1, Ume, which the third friend ranks #29. The fair pick, Maison Premiere, ranks 6·3·2.
4. Type a veto such as "somewhere quieter" or "no bars please" and press Replan. The Agent steps panel lists each tool call, then an `observe → replan` step that suggests what to try next.
5. Open "Edit friends and scene" and replace friend 2 with Hip-hop + sneakers. The table shows whether the fair pick moved, and says "unchanged" when it didn't.

## How Qloo is used

| Step | Qloo feature | Why |
|---|---|---|
| Resolve tastes | `GET /search` | Turns names like "Moonrise Kingdom" or "Supreme" into entity IDs. When the match is ambiguous, the agent asks the user to choose. |
| Find candidates | `GET /v2/insights` with `filter.type=urn:entity:place`, `filter.location` and `filter.location.radius`, plus `filter.tags` with `operator.filter.tags=intersection` | Gets places near the neighborhood that fit the occasion. Dinner needs both the restaurant tag and the dinner tag. |
| Per-person taste | `signal.interests.entities` set to each friend's resolved IDs | Gives every friend a taste-ranked list of their own. |
| Popularity baseline | The same query with no taste signal | Lets the app compare taste against popularity. The Taste off switch puts this baseline on the map. |
| One shared pool | `filter.results.entities` with the union of candidates, once per friend | Ranks every friend against exactly the same places, so the columns can be compared. |
| Explainability | `feature.explainability=true` | Reports how much each seed contributed to a place's score. It sits in the collapsed ranking details. |

The app compares ranks and leaves raw affinity values aside, because it does not assume affinity is calibrated between two people's requests.

## The agent loop

The agent runs a bounded set of tools. Scores and ranks always come from Qloo results and fixed rules in `logic.py`.

1. A free-text request becomes validated tool calls: `plan`, `exclude_categories`, `exclude_tags`, `exclude_place`, `widen_radius`, `change_occasion`, `change_area`, `prefer_budget` and `add_friend`. An LLM chooses the tools; the live demo uses `qwen/qwen3.8-27b` on Groq. Without an LLM, or when its call fails, a local intent parser handles common English and Korean requests.
2. Each taste is resolved with `/search`. If several results are plausible, the agent stops and asks; the user can pick one or answer "None of these / skip this taste".
3. Candidates are retrieved per friend along with the popularity baseline. If fewer than five eligible places survive, the search widens from 2 km / take 30 to 3.5 km / 40, then 5 km / 50. In Williamsburg the search stops at 3.5 km and keeps Brooklyn addresses.
4. If the union of candidates is larger than 50, the agent keeps the largest equal top-k per person that fits and rescores that pool for everyone.
5. The decision is maximin on ranks: lowest worst personal rank first, then lowest rank sum. If rescoring comes back incomplete, it falls back to rank sum and labels the result that way.
6. After a veto runs, the agent observes the outcome (how many places were excluded, how many remain) and proposes one next step, for example a wider radius when only a few places are left. Nothing runs until the user clicks the suggestion.

The Agent steps panel streams every step with its tool name, inputs, result count, latency, and whether it came from cache.

## Run locally

Requires Python 3.9+. There are no Python packages to install and no build step.

```sh
cp .env.example .env
# Set QLOO_API_KEY in .env. QLOO_BASE_URL defaults to https://hackathon.api.qloo.com.
python3 prewarm.py     # builds the three preset scenes once
python3 server.py
```

Open http://localhost:3000. To use a different env file, run `ENV_FILE=/path/to/private.env python3 server.py`. The server binds to 127.0.0.1 unless `HOST` or `--host` says otherwise. Map tiles come from OpenStreetMap and need internet access; the table and lists work without them.

`prewarm.py` builds only missing or expired snapshots. From a cold cache the three presets take 26 Qloo calls, and a second run takes none.

## Run with Docker

```sh
docker build -t taste-truce .
docker run --rm -p 3000:3000 --env-file .env -v taste-truce-data:/data taste-truce
```

On start the container runs `prewarm.py`, then the server. Snapshots already on the volume are reused without Qloo calls; if prewarm fails, the server still starts and `/health` reports that the default scene is not ready. Set `DEFAULT_SCENE` in the env file or with `-e` to pick the first scene. The image runs as an unprivileged user. The `/data` volume holds the private response cache, the saved scenes and the SQLite call budget, so keep it across restarts and use one instance per volume. [DEPLOY.md](DEPLOY.md) covers HTTPS cookies, proxies, health checks and scheduled prewarming.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QLOO_API_KEY` | required | Qloo key, read only by the server. |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Qloo API root. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | unset | Optional OpenAI-compatible `/chat/completions` endpoint for the planner. Set all three, or the local parser runs. |
| `LLM_TIMEOUT_SECONDS` | `8` | Per-request LLM timeout. On a timeout or error the local parser runs and the server logs the status code. |
| `DEFAULT_SCENE` | `williamsburg` | First scene: `seongsu`, `williamsburg` or `majority`. |
| `DEFAULT_SCENE_TTL_SECONDS` | `0` (no expiry) | A positive value must be at least 2592000 (30 days). |
| `QLOO_CACHE_TTL_SECONDS` | `0` (no expiry) | Response cache expiry. |
| `QLOO_CACHE_DIR` | `~/.cache/taste-truce/responses` | Private response cache and saved scenes (`/data/cache` in Docker). |
| `QLOO_STATE_DIR` | `~/.local/state/taste-truce` | SQLite budgets (`/data/state` in Docker). |
| `SESSION_CALL_CAP` | `30` | Uncached Qloo calls per browser session. |
| `MONTHLY_CALL_CAP` | `8000` | Monthly call cap; higher values are clamped to 8000. |
| `MONTHLY_RESERVED_CALLS` | `1000` | Calls held back for use of the same key elsewhere. |
| `IP_DAILY_SESSION_CAP` | `20` | New sessions per IP per UTC day. |
| `IP_DAILY_CALL_CAP` | `100` | Uncached calls per IP per UTC day. |
| `MAX_SESSIONS` | `1000` | Sessions kept in memory. |
| `SESSION_TTL_SECONDS` | `86400` | Session lifetime. |
| `TRUSTED_PROXY_HEADER`, `TRUSTED_PROXY_IPS` | unset | Set both to accept a client-IP header from known proxy peers. `TRUSTED_PROXY_IPS` takes exact IPs, CIDR ranges, or `*` when only the platform proxy can reach the app. |
| `COOKIE_SECURE` | `0` | Set to `1` behind HTTPS. |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Bind address. |
| `ENV_FILE` | `./.env` | Env file loaded at startup. |

Every Qloo call passes through a shared limiter that starts at most four requests in any 1.25-second window, at least 0.30 seconds apart. Identical requests in flight share one call.

## Tests

```sh
python3 -m unittest discover -s tests
```

The tests use synthetic data only.

## Data and license

This repository contains no Qloo data and no keys. Qloo responses are fetched at runtime and cached privately outside Git. The code is MIT-licensed (see [LICENSE](LICENSE)). Leaflet ships with its own license in `static/vendor/leaflet`, and map data is © OpenStreetMap contributors.

## Files

- `server.py`: HTTP routes, sessions, streamed agent events.
- `agent.py`: resolution, clarification, widening, rescoring and replanning.
- `planner.py`: tool definitions, the LLM planner, the local parser, observe → replan.
- `logic.py`: eligibility, maximin consensus, the concession table.
- `qloo.py`: server-only Qloo transport, rate limit, cache and budgets.
- `sessions.py`, `scenes.py`, `prewarm.py`: session limits, presets and saved scenes, prewarming.
- `static/`: the interface; `copy.js` holds the first-screen text.
