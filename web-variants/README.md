# Taste Truce UI variants

Design studies for the Taste Truce front end. Each variant is a separate page that talks to the
unchanged server (`app/server.py`): same endpoints, same saved scenes. The production UI in
`app/static/` is not touched.

| Folder | Idea |
| --- | --- |
| `ledger/` | Split dashboard: verdict, map and rank table on the left, sticky agent trace on the right |
| `matrix/` | Compromise heatmap: places × friends, a slider that shows the maximin cut, steps in a sheet |
| `atlas/` | Map first: full-bleed map with a floating panel (pick, shortlist, agent), bottom sheet on phones |
| `thread/` | Conversation: each run is a turn with its tool trace and a result card that shows what changed |

Shared code lives in `src/shared/` (API client, NDJSON stream, step names, map) and
`src/components/ui/` (shadcn/ui on Base UI).

## Run

```sh
npm install
# Point the dev proxy at a running Taste Truce server (default http://127.0.0.1:3000).
TASTE_TRUCE_BACKEND=http://127.0.0.1:3210 npx vite --port 5391
# open http://127.0.0.1:5391/ledger/ (or /matrix/, /atlas/, /thread/)
```

The proxy maps `/__session` to the server's home page so it can set its session cookie, and drops
the `Origin` header so the server's same-origin check sees a same-host request.
