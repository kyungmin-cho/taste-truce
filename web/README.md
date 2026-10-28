# Taste Truce web front end

React + Vite + TypeScript + Tailwind with shadcn/ui on Base UI. The map fills the screen; a panel
holds the fair pick, the shortlist and the agent's steps (a bottom sheet on phones).

`server.py` serves the build: `web/dist/index.html` at `/` and hashed files under `/assets/`.
Without a build, `/` serves the previous page in `static/`, which also stays reachable at `/classic`.
The Docker image builds this folder in its first stage.

## Build

```sh
npm ci
npm run build      # type check + bundle into dist/
```

## Develop

```sh
# Point the dev proxy at a local Taste Truce server. There is no default: do not use the live
# deployment on :3000, which holds real provider keys. A server started without keys answers
# from its cache only.
TASTE_TRUCE_BACKEND=http://127.0.0.1:3210 npx vite --port 5391
```

The proxy maps `/__session` to the server's home page so it can set its session cookie, and drops
the `Origin` header so the server's same-origin check sees a same-host request.

| Folder | Contents |
| --- | --- |
| `src/App.tsx` | Layout: map, panel (desktop) or bottom sheet (phone), condition bar |
| `src/app/` | Pick, shortlist, agent steps, condition bar, friend editor, question dialog |
| `src/shared/` | API client (NDJSON stream), run state, step names, scene links, map |
| `src/components/ui/` | shadcn/ui primitives |
