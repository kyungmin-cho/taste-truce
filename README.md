# Taste Truce

Taste Truce proves who concedes what when friends with different tastes pick a place.

Each friend brings a few films, artists, or brands. Qloo turns those tastes into a ranking of the same candidate places for every person. The agent then picks the place where the worst-off friend concedes the least and shows the evidence as a concession table: one row per place, one column per friend, and each cell is that friend's rank for that place.

Live demo: <DEMO_URL>

## The 30-second demo path

1. Open the demo. The first screen is a saved scene: Seongsu, dinner, Friday 7 p.m., three friends. It loads from a stored snapshot, so opening the page makes no Qloo call.
2. Read the concession table. Its rows are the most popular place, each friend's own #1, a majority #1 when there is one, and the fair pick. The worst rank in each row is highlighted. In the saved Seongsu scene the most popular place ranks 10·2·5 for the three friends, and the fair pick ranks 4·1·2.
3. Choose the "Williamsburg · majority / minority" preset. Two friends share a #1, Ume, which the third friend ranks #29. The fair pick, Maison Premiere, ranks 6·3·2.
4. Type a veto such as "somewhere quieter" or "no bars please" and press Replan. The Agent steps panel lists each tool call, then an `observe → replan` step that suggests what to try next.
5. Replace friend 2 with Hip-hop + sneakers or K-pop + streetwear. The table shows whether the fair pick moved, and says "unchanged" when it didn't.

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

1. A free-text request becomes validated tool calls: `plan`, `exclude_categories`, `exclude_tags`, `exclude_place`, `widen_radius`, `change_occasion`, `change_area`, `prefer_budget` and `add_friend`. With an LLM configured, the model chooses the tools. Without one, a local intent parser handles common English and Korean requests.
2. Each taste is resolved with `/search`. If several results are plausible, the agent stops and asks; the user can pick one or answer "None of these / skip this taste".
3. Candidates are retrieved per friend along with the popularity baseline. If fewer than five eligible places survive, the search widens from 2 km / take 30 to 3.5 km / 40, then 5 km / 50.
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

`prewarm.py` builds only missing or expired snapshots. In our recorded run a cold cache needed 26 Qloo calls for the three presets, and running it again needed none.

## Run with Docker

```sh
docker build -t taste-truce .
docker run --rm --env-file .env -v taste-truce-data:/data taste-truce python prewarm.py
docker run --rm -p 3000:3000 --env-file .env -v taste-truce-data:/data taste-truce
```

The image runs as an unprivileged user. The `/data` volume holds the private response cache, the saved scenes and the SQLite call budget, so keep it across restarts and use one instance per volume. [DEPLOY.md](DEPLOY.md) covers HTTPS cookies, proxies, health checks and scheduled prewarming.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QLOO_API_KEY` | required | Qloo key, read only by the server. |
| `QLOO_BASE_URL` | `https://hackathon.api.qloo.com` | Qloo API root. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | unset | Optional OpenAI-compatible `/chat/completions` endpoint for the planner. Set all three, or the local parser runs. |
| `DEFAULT_SCENE` | `seongsu` | First scene: `seongsu`, `williamsburg` or `majority`. |
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
| `TRUSTED_PROXY_HEADER`, `TRUSTED_PROXY_IPS` | unset | Set both to accept a client-IP header from known proxy peers. |
| `COOKIE_SECURE` | `0` | Set to `1` behind HTTPS. |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Bind address. |
| `ENV_FILE` | `./.env` | Env file loaded at startup. |

Every Qloo call passes through a shared limiter that starts at most four requests in any 1.25-second window, at least 0.30 seconds apart. Identical requests in flight share one call.

## Tests

```sh
python3 -m unittest discover -s tests
```

The tests use synthetic data only.

## Limits

- The fair pick often overlaps the most popular places. In the four scenes we tried, it was popularity #1 twice and #2 twice. What the app adds is the table: it shows who gives up what, even when the answer is a popular place.
- The presets are illustrative. We tried four scenes (two original groups and two pre-registered variants) and show three. Every number comes from real Qloo results, but four scenes are too few to generalize from.
- A rank only means something inside that scene's candidate pool. Popularity is ranked within Qloo's returned no-signal sample, which is smaller than the whole neighborhood.
- Affinity describes people with shared interests. It does not predict what one person will enjoy.
- Opening hours, availability, bookings, allergies, travel time and real group satisfaction are not checked. The quieter, cheaper and vegetarian filters rely on tags Qloo has recorded.
- In our runs each seed contributed roughly half of a place's score, so the table carries the evidence and the contributions stay in the details.
- The app is not deployed yet; `<DEMO_URL>` above is a placeholder.

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
