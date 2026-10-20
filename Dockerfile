FROM python:3.12-slim
WORKDIR /app
COPY server.py agent.py planner.py logic.py qloo.py sessions.py prewarm.py scenes.py ./
COPY static ./static
RUN useradd --create-home appuser && mkdir -p /data/cache /data/state && chown -R appuser:appuser /data
USER appuser
ENV DEFAULT_SCENE=williamsburg PORT=3000 PYTHONDONTWRITEBYTECODE=1 QLOO_CACHE_DIR=/data/cache QLOO_STATE_DIR=/data/state
EXPOSE 3000
CMD ["python", "server.py", "--host", "0.0.0.0"]
