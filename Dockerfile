FROM python:3.12-slim
WORKDIR /app
COPY server.py agent.py logic.py qloo.py ./
COPY static ./static
RUN useradd --create-home appuser && mkdir .cache && chown appuser:appuser .cache
USER appuser
ENV PORT=3000 PYTHONDONTWRITEBYTECODE=1
EXPOSE 3000
CMD ["python", "server.py", "--host", "0.0.0.0"]
