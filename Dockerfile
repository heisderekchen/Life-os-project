# syntax=docker/dockerfile:1

# ---------- Next.js Builder ----------
FROM oven/bun:1.3.4 AS builder
WORKDIR /app
ARG LIFEOS_BASE_PATH=/workbench
ENV BACKEND_URL="http://localhost:8081"
ENV LIFEOS_BASE_PATH=${LIFEOS_BASE_PATH}
ENV NEXT_PUBLIC_LIFEOS_BASE_PATH=${LIFEOS_BASE_PATH}

ENV NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_URL="file:/app/data/prod.db"

COPY package.json bun.lock* bun.lockb* ./
RUN bun install

COPY . .
RUN bun run db:generate
RUN bun run build

# ---------- Runner ----------
FROM node:24-slim AS runner
WORKDIR /app
ARG LIFEOS_BASE_PATH=/workbench

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL="file:/app/data/prod.db" \
    BACKEND_URL="http://localhost:8081" \
    LIFEOS_BASE_PATH=${LIFEOS_BASE_PATH} \
    NEXT_PUBLIC_LIFEOS_BASE_PATH=${LIFEOS_BASE_PATH}

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget curl libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

# 1. Next.js standalone server + assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 2. Prisma CLI and client. Reuse the dependency tree installed by Bun in
# the build stage: npm 10 can fail resolving Prisma's dependency graph in
# this minimal image, while the Bun install has already generated the
# target-platform Prisma client.
COPY --from=builder /app/node_modules ./node_modules

# 3. Prisma schema + migration files (needed by migrate deploy at runtime)
COPY --from=builder /app/prisma ./prisma

# 4. Current private Worker API ported to Node/SQLite, plus private-only schema migrations
COPY deploy/standalone ./deploy/standalone

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/data \
    && chown -R node:node /app

# Railway mounts persistent volumes as root. Keep the entrypoint running as
# root so Prisma can initialize the SQLite file inside /app/data on first boot.
USER root
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:3000/internal/health > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
