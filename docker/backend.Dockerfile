# Ply Review API + Stockfish
FROM python:3.12-slim AS stockfish
ARG STOCKFISH_VERSION=sf_19
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) asset=stockfish-linux-x86-64-universal.tar.gz ;; \
      arm64) asset=stockfish-linux-arm64-universal.tar.gz ;; \
      *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/sf.tar.gz \
      "https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_VERSION}/${asset}"; \
    mkdir /tmp/sf && tar -xzf /tmp/sf.tar.gz -C /tmp/sf; \
    bin="$(find /tmp/sf -type f -name 'stockfish-*' ! -name '*.tar.gz' -perm -u+x | head -n1)"; \
    install -m 0755 "$bin" /usr/local/bin/stockfish; \
    echo "uci" | /usr/local/bin/stockfish | grep -q uciok

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PLYREVIEW_CONFIG=/app/config.yaml \
    PLYREVIEW__ENGINE__PATH=stockfish \
    PLYREVIEW__API__HOST=0.0.0.0 \
    PLYREVIEW__STORAGE__CACHE_DIR=/data/cache/chesscom \
    PLYREVIEW__STORAGE__REVIEWS_DB=/data/reviews.sqlite3 \
    PLYREVIEW__STORAGE__OUTPUT_DIR=/data/output
COPY --from=stockfish /usr/local/bin/stockfish /usr/local/bin/stockfish
WORKDIR /app
COPY pyproject.toml ./
COPY backend ./backend
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 1000 app && mkdir -p /data && chown app /data
COPY config.yaml ./config.yaml
USER app
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health')"
CMD ["uvicorn", "backend.api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
