FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS builder

COPY . .

RUN pnpm --filter web build

FROM deps AS migrate

ENV NODE_ENV=production

COPY . .

CMD ["sh", "-lc", "pnpm --filter @ai-intel/db db:migrate && pnpm --filter worker seed:sources"]

FROM deps AS web

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY . .
COPY --from=builder /app/apps/web/.next ./apps/web/.next

EXPOSE 3000

CMD ["pnpm", "--filter", "web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]

FROM deps AS worker

ENV NODE_ENV=production

COPY . .

CMD ["pnpm", "--filter", "worker", "start"]

