FROM python:3.12-alpine

ARG APP_VERSION=dev

LABEL org.opencontainers.image.title="Daily Tracker" \
      org.opencontainers.image.description="Tap-to-tick monthly habit, sleep and mood tracker for a home tablet" \
      org.opencontainers.image.source="https://github.com/JRhattigan1/Daily-Tracker"

WORKDIR /app
COPY server.py ./
COPY public ./public

ENV APP_VERSION=${APP_VERSION} \
    DATA_DIR=/data \
    PORT=8080 \
    PYTHONUNBUFFERED=1

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["python", "server.py"]
