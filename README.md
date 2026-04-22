# AI Builder Intelligence Platform

Phase 0 scaffolds a TypeScript monorepo for a curated-source intelligence product:

- `apps/web`: Next.js dashboard shell
- `apps/worker`: ingestion and fetch worker
- `packages/db`: Drizzle schema and database helpers
- `packages/shared`: source definitions and shared utilities

## Docker quick start

1. Build and start the full stack with `docker compose up --build`.
2. Open `http://localhost:3000`.
3. The compose stack starts `postgres`, runs migrations plus source seeding once, then starts `web` and `worker`.
4. Stop everything with `docker compose down`.

## Local development

1. Copy `.env.example` to `.env`.
2. Start Postgres with `docker compose up -d postgres`.
3. Install dependencies with `corepack pnpm install`.
4. Generate SQL migrations with `corepack pnpm db:generate`.
5. Apply migrations with `corepack pnpm db:migrate`.
6. Seed the source registry with `corepack pnpm seed:sources`.
7. Run the web app with `corepack pnpm dev:web`.
8. Run the worker with `corepack pnpm dev:worker`.

## Useful commands

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm fetch:once`

## Notes

- Raw fetch payloads are stored under `var/raw` locally and in the `raw_data` Docker volume when running through Compose.
- The source registry is seeded from `packages/shared/src/default-sources.ts`.
- The app now uses a lightweight email and password login flow backed by Postgres sessions.
- `AUTH_ALLOWED_EMAILS` controls who can create or access an account. It defaults to `lianglingfan@gmail.com`.
- Passwords are stored as salted hashes, not plain text.
- Add `OPENROUTER_API_KEY` to enable personalized feed ranking with OpenRouter Responses and `openai/gpt-5.4-mini`.
- The personalized shortlist uses each profile's plain-English interest statement plus the title and first paragraph from today's documents.
- The product and roadmap docs live in `docs/feature-and-implementation-plan.md`.
- Docker uses the multi-stage [Dockerfile](/Users/autumn/src/AIEngineerNewsLetter/Dockerfile) and named volumes for Postgres data plus raw fetch storage.
