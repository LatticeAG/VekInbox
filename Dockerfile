# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/cli/package.json ./packages/cli/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/integration-core/package.json ./packages/integration-core/
COPY packages/langchain/package.json ./packages/langchain/
COPY packages/ai-sdk/package.json ./packages/ai-sdk/
COPY packages/queue/package.json ./packages/queue/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile || pnpm install

FROM deps AS build
COPY . .
RUN pnpm --filter @latticeag/vekinbox-shared build \
  && pnpm --filter @latticeag/vekinbox-db build \
  && pnpm --filter @latticeag/vekinbox-queue build \
  && pnpm --filter @latticeag/vekinbox-core build \
  && pnpm --filter @latticeag/vekinbox build \
  && pnpm --filter @latticeag/vekinbox-integration-core build \
  && pnpm --filter @latticeag/vekinbox-langchain build \
  && pnpm --filter @latticeag/vekinbox-ai-sdk build \
  && pnpm --filter @latticeag/vekinbox-cli build \
  && pnpm --filter @latticeag/vekinbox-api build \
  && pnpm --filter @latticeag/vekinbox-worker build

# Optional: build web UI when implemented
RUN pnpm --filter @latticeag/vekinbox-web build 2>/dev/null || true

FROM node:22-slim AS production
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/packages/queue/package.json ./packages/queue/
COPY --from=build /app/packages/queue/dist ./packages/queue/dist
COPY --from=build /app/packages/queue/node_modules ./packages/queue/node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
COPY scripts/worker-entrypoint.sh /worker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh /worker-entrypoint.sh

ENV PORT=3001
ENV WEB_DIST=/app/apps/web/dist
EXPOSE 3001

ENTRYPOINT ["/docker-entrypoint.sh"]
