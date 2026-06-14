FROM oven/bun:1-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# No dependencies — the server uses only Bun + Node built-ins.
COPY server.ts ./

EXPOSE 3129

USER bun
CMD ["bun", "server.ts"]
