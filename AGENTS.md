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
1. Curated sources are defined in `packages/shared`.
2. The worker fetches endpoints and writes `fetch_jobs`, `fetch_attempts`, `raw_documents`, and `documents`.
3. The worker scores documents against user interest profiles via OpenRouter, writing `document_scores` and tracking progress in `scoring_jobs`.
4. The worker sends daily SendPulse newsletter emails using each active user's first active profile, then records successful sends in `newsletter_sends`.
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
- DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) is the default OpenRouter model for scoring; fallback model changes should stay explicit in env/config.
- Prefer additive schema changes. Existing data should keep working after a migration.
- Long-running work (crawling, scoring) belongs in the worker, not the web app. The web app only enqueues.
- Docker builds must exclude workspace `node_modules` directories so container-installed pnpm links are not overwritten by host symlinks.
- Cloudflare Tunnel support lives in Compose as an optional `tunnel` profile; keep `web` and Postgres bound to localhost on the host, and route public web traffic through `cloudflared` to `http://web:3000`.
- Cloudflare Tunnel tokens should be mounted from ignored local secret files, not interpolated into Compose commands or committed env examples.
- Local server operations are exposed through `pnpm ops`, which wraps Docker Compose lifecycle commands and crawl/scoring job log queries.
- Production Compose exposes crawled-document TTL controls through `CRAWLED_DOCUMENT_TTL_DAYS`, `CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES`, and `CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE`.
- Production Compose exposes scoring spend controls through `SCORING_MAX_DOCUMENTS_PER_RUN` and `SCORING_LOOKBACK_DAYS`.
- E2E smoke credentials live in local env as `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`; keep the password synthetic and ensure the email is included in `AUTH_ALLOWED_EMAILS`.
- `FEED_SHOW_WHY_RELEVANT` controls whether stored per-story relevance explanations render in the feed; keep it off by default when the profile-level top-story briefing is the primary explanation surface.
- Project-local Codex skills live in `.codex/skills`; update the relevant skill reference when testing workflows or credential conventions change.
- Playwright is installed as a root dev dependency for browser-based E2E smoke tests.

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
