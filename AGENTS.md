# AGENTS.md

## Scope
This file applies to the entire repository unless a deeper `AGENTS.md` overrides part of it.

## Monorepo Architecture
- `apps/web` is the Next.js application. It owns the UI, route protection, server actions, and server-side orchestration.
- `apps/worker` is the background worker. It fetches sources, stores raw payloads, inserts new normalized documents while skipping canonical duplicates, and runs LLM-based document scoring.
- `packages/db` owns the Postgres schema, Drizzle client, and migrations.
- `packages/shared` owns shared types, source registry seeds, and URL helpers.
- `docs` holds product and implementation notes that explain intent rather than runtime behavior.

## Core Runtime Flow
1. Curated sources (currently ~90) are defined in `packages/shared/src/default-sources.ts`; the worker reseeds this registry on startup and deactivates sources/endpoints that drop out of the seed list, so retired sources stop being crawled without deleting history.
2. The worker fetches endpoints and writes `fetch_jobs`, `fetch_attempts`, `raw_documents`, and `documents`.
3. The worker scores documents against user interest profiles via OpenRouter, writing `document_scores` and tracking progress in `scoring_jobs`.
4. The worker sends daily SendPulse newsletter emails using each active user's default active profile, falling back to the first active profile, then records successful sends in `newsletter_sends`.
5. The web app reads normalized tables for dashboards and the personalized feed.
6. Auth is handled in the web app with `auth_users`, `auth_sessions`, and an `HttpOnly` session cookie.
7. Personalized ranking uses pre-computed `document_scores` joined with `documents` and `sources`, filtered by a time window (day/week/month/quarter/year).

## Job Queue
- Both fetch and scoring jobs are managed by pg-boss (Postgres-backed queue).
- The web app enqueues jobs by inserting into `pgboss.job`; the worker picks them up.
- Queue names: `fetch-source-endpoint`, `score-documents`, `send-daily-newsletter`.
- The worker's default fetch enqueue interval is 60 minutes, while endpoint-specific `cadenceMinutes` still controls per-endpoint singleton throttling.
- Crawl jobs default to 5 local pg-boss fetch workers per worker process; scoring stays separately queued.
- Scoring uses a singleton key per profile to prevent duplicate concurrent scoring.
- Newsletter sends require SendPulse credentials in the worker environment and are deduped by user/date.
- Crawled documents and raw payloads are pruned by the worker according to `CRAWLED_DOCUMENT_TTL_DAYS`, capped at 365 days, with cleanup batch/interval env controls.
- Crawl-triggered scoring should pass newly inserted document IDs so profile scoring stays bounded to fresh work; broad scoring is additionally capped by scoring max/lookback env controls.

## Implementation Guidance
- Keep route files thin. Put data access, auth, and ranking logic in `apps/web/src/lib`.
- Keep worker logic idempotent. Prefer deterministic hashes, canonical-URL existence checks, and additive inserts over destructive rewrites.
- Treat `packages/db/drizzle` and `packages/db/drizzle/meta` as generated artifacts. Generate migrations instead of hand-editing snapshots.
- Shared code should be framework-light. Do not leak Next.js APIs into `packages/*`.
- Shared LLM prompt templates live in `packages/shared` and use Handlebars for dynamic rendering across web and worker callers.
- OpenRouter scoring uses the shared model candidates in `packages/shared/src/scoring-config.ts`; both scoring and top-story summaries use DeepSeek V4 Flash (`deepseek/deepseek-v4-flash-0731`) as the sole model, with `env.openRouterModel` (also defaulted to the same model) as the final explicit fallback per call. There is currently no cross-provider fallback model — if DeepSeek has an outage, scoring/summary calls have nothing else to fall back to.
- Prefer additive schema changes. Existing data should keep working after a migration.
- Long-running work (crawling, scoring) belongs in the worker, not the web app. The web app only enqueues.
- Docker builds must exclude workspace `node_modules` directories so container-installed pnpm links are not overwritten by host symlinks.
- Cloudflare Tunnel support lives in Compose as an optional `tunnel` profile; keep `web` and Postgres bound to localhost on the host, and route public web traffic through `cloudflared` to `http://web:3000`.
- Cloudflare Tunnel should run over HTTP/2 in Compose to avoid QUIC/UDP idle timeout issues on local networks, with Docker restart policy set to keep the connector available after failures.
- Cloudflare Tunnel tokens should be mounted from ignored local secret files, not interpolated into Compose commands or committed env examples.
- Local server operations are exposed through `pnpm ops`, which wraps Docker Compose lifecycle commands, crawl/scoring job log queries, remote deploys over SSH (`pnpm ops deploy`), and one-time DB dump/restore for moving existing data to a fresh VM (`pnpm ops db-dump` / `pnpm ops db-restore`). See `docs/deployment.md` for the full Oracle Cloud VM runbook and `scripts/AGENTS.md` for the command implementations.
- Production Compose exposes crawled-document TTL controls through `CRAWLED_DOCUMENT_TTL_DAYS`, `CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES`, and `CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE`.
- `CRAWLED_DOCUMENT_TTL_DAYS` defaults to 30 in Compose because raw payloads grow roughly 8-12 GB/month at the current source count; the worker's own schema default remains 365, so any host relying on that default must set the value explicitly. Raising the TTL is only safe when `raw_data` lives on a volume with room for it.
- Lowering a retention default is destructive to existing installs: the cleanup job prunes on the next run. Pin the prior value in an existing deployment's `.env` before changing a default, rather than assuming defaults are inert.
- Every long-lived Compose service must declare a `restart` policy; without one it does not return after a host reboot while its dependents do, producing a crash-loop that still looks "running" in `docker ps`. Only the one-shot `migrate` service should be `restart: "no"`.
- Compose services share the `x-logging` anchor so the default non-rotating `json-file` driver cannot fill the host volume. Apply `logging: *logging` to any new service.
- Production Compose exposes scoring spend controls through `SCORING_MAX_DOCUMENTS_PER_RUN` and `SCORING_LOOKBACK_DAYS`.
- E2E smoke credentials live in local env as `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`; keep the password synthetic and ensure the email is included in `AUTH_ALLOWED_EMAILS`.
- `FEED_SHOW_WHY_RELEVANT` controls whether stored per-story relevance explanations render in the feed; keep it off by default when the profile-level top-story briefing is the primary explanation surface.
- Project-local Codex skills live in `.codex/skills`; update the relevant skill reference when testing workflows or credential conventions change.
- The repo has no unit/integration test runner configured (no vitest/jest); Playwright (`@playwright/test`) is installed as a root dev dependency for browser-based E2E testing, driven by the `.codex/skills/e2e-functional-testing` skill. No `playwright.config` or spec files exist yet.
- Keep worker job files thin: extract pure, dependency-light parsing helpers (for example `apps/worker/src/jobs/html-links.ts` for listing-page link extraction) into their own module so they can be verified without a database.

## Safe Change Patterns
- Web features usually touch `apps/web/src/app`, `apps/web/src/lib`, and sometimes `packages/db/src/schema.ts`.
- Ingestion features usually touch `apps/worker/src`, `packages/shared/src`, and `packages/db/src/schema.ts`.
- Scoring features touch `apps/worker/src/jobs`, `apps/web/src/lib/scoring*.ts`, and `packages/db/src/schema.ts`.
- If a change affects persisted data, update the schema first, generate a migration, then wire runtime code.

## AGENTS Policy
- Every code or config change must update the nearest scoped `AGENTS.md` in the same directory tree.
- `CLAUDE.md` exists as a symlink to the local `AGENTS.md` for tool compatibility, but `AGENTS.md` is the source of truth.
- Local enforcement lives in `.githooks/pre-commit` and CI enforcement lives in `.github/workflows/agents-policy.yml`.
- The policy checker is `scripts/check-agents.mjs`.
