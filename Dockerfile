# Front end: Vite build of web/ into web/dist (hashed files under /assets).
FROM node:24-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run bundle

FROM python:3.12-slim
WORKDIR /app
COPY server.py agent.py planner.py logic.py qloo.py sessions.py prewarm.py scenes.py ./
COPY static ./static
COPY --from=web /web/dist ./web/dist
RUN useradd --create-home appuser && mkdir -p /data/cache /data/state && chown -R appuser:appuser /data
USER appuser
# DEFAULT_SCENE is read from the runtime environment (williamsburg when unset).
ENV PORT=3000 PYTHONDONTWRITEBYTECODE=1 QLOO_CACHE_DIR=/data/cache QLOO_STATE_DIR=/data/state
EXPOSE 3000
# Fill missing snapshots before serving; a failed prewarm still starts the server.
CMD ["sh", "-c", "python prewarm.py || echo 'prewarm failed; saved scenes may be unavailable' >&2; exec python server.py --host 0.0.0.0"]
