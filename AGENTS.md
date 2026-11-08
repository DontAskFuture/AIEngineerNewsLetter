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
1. Curated sources (currently 122) are defined in `packages/shared/src/default-sources.ts`; the worker reseeds this registry on startup and deactivates sources/endpoints that drop out of the seed list, so retired sources stop being crawled without deleting history. The web app lists those sources in a concise footer.
2. The worker fetches endpoints and writes `fetch_jobs`, `fetch_attempts`, `raw_documents`, and `documents`.
3. The worker scores documents against user interest profiles via OpenRouter, writing `document_scores` and tracking progress in `scoring_jobs`.
4. The worker sends daily newsletter emails over SMTP using each active user's default active profile, falling back to the first active profile, then records successful sends in `newsletter_sends`. Public email subscribers (`newsletter_subscribers`) also receive the public curator's daily brief with one-click unsubscribe links.
5. The web app reads normalized tables for dashboards and the personalized feed, including curator story overrides (`story_curations` for "My Take" editorial notes, pins, and hides), personal branding configuration (`BRAND_AUTHOR_*`), and the public `/rss.xml` feed.
6. Auth is handled in the web app with `auth_users`, `auth_sessions`, and an `HttpOnly` session cookie.
7. Personalized ranking uses pre-computed `document_scores` joined with `documents` and `sources`, filtered by a time window (day/week/month/quarter/year).

## Job Queue
- Both fetch and scoring jobs are managed by pg-boss (Postgres-backed queue).
- The web app enqueues jobs by inserting into `pgboss.job`; the worker picks them up.
- Queue names: `fetch-source-endpoint`, `score-documents`, `send-daily-newsletter`.
- The worker's default fetch enqueue interval is 60 minutes, while endpoint-specific `cadenceMinutes` still controls per-endpoint singleton throttling.
- Crawl jobs default to 5 local pg-boss fetch workers per worker process; scoring stays separately queued.
- Scoring uses a singleton key per profile to prevent duplicate concurrent scoring.
- Newsletter sends require `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL` in the worker environment and are deduped by user/date.
- Crawled documents and raw payloads are pruned by the worker according to `CRAWLED_DOCUMENT_TTL_DAYS`, capped at 365 days, with cleanup batch/interval env controls.
- Crawl-triggered scoring should pass newly inserted document IDs so profile scoring stays bounded to fresh work; broad scoring is additionally capped by scoring max/lookback env controls.

## Implementation Guidance
- Keep route files thin. Put data access, auth, and ranking logic in `apps/web/src/lib`.
- Keep worker logic idempotent. Prefer deterministic hashes, canonical-URL existence checks, and additive inserts over destructive rewrites.
- Treat `packages/db/drizzle` and `packages/db/drizzle/meta` as generated artifacts. Generate migrations instead of hand-editing snapshots.
- Shared code should be framework-light. Do not leak Next.js APIs into `packages/*`.
- Shared LLM prompt templates live in `packages/shared` and use Handlebars for dynamic rendering across web and worker callers.
- Scoring candidates are assembled at call time by `ScoringModelPool` (`packages/shared/src/model-pool.ts`) from three layers: the hand-probed verified free pool in `scoring-config.ts`, free models discovered from OpenRouter's models API, then the paid DeepSeek Flash Latest (`~deepseek/deepseek-flash-latest`) backstop, which is always last and never parked. Top-story summaries bypass the pool and stay on DeepSeek alone because they are low volume and user-facing. `env.openRouterModel` remains the final explicit fallback per call.
- The pool keeps a per-process circuit breaker (`packages/shared/src/model-health.ts`): a failed candidate is parked for a cooldown scaled to how durable its failure is (transient 1min with capped escalation, quota 15min, forbidden 6h, invalid model id 24h), so a dead model costs one round trip rather than one per batch. Health is deliberately in-memory and forgotten on restart; web and worker each learn independently.
- Model discovery is an enhancement, never a dependency: it is cached for an hour, bounded by a 10s timeout, and any failure silently leaves the verified pool in place. Discovered models are unproven against the scoring JSON contract, so they always rank after the verified pool — a bad one costs a fall-through, and its unparseable output is discarded by existing validation rather than reaching the database.
- Individual free OpenRouter endpoints are unreliable by design — quota exhaustion (429), upstream congestion returned as HTTP 200, and outright hangs are all routine. The pool absorbs that: `packages/shared/src/openrouter-retry.ts` never retries a `:free` candidate and falls straight through to the next one, reserving backoff retries for the paid backstop that is actually worth waiting on. Both OpenRouter clients (`apps/web/src/lib/openrouter.ts` and `apps/worker/src/jobs/score-documents.ts`) must share this helper rather than reimplementing status checks.
- OpenRouter reports upstream provider failures as **HTTP 200 with an `error` object in the body**, so `response.ok` does not prove success. Always classify the parsed payload through `extractBodyError` and treat a failure as a model fall-through; never throw out of the candidate loop, which would skip every remaining candidate including the paid backstop.
- Every OpenRouter request must set an `AbortSignal.timeout` (currently 60s). A free endpoint that hangs will otherwise stall an entire scoring job indefinitely.
- Prefer additive schema changes. Existing data should keep working after a migration.
- Long-running work (crawling, scoring) belongs in the worker, not the web app. The web app only enqueues.
- Docker builds must exclude workspace `node_modules` directories so container-installed pnpm links are not overwritten by host symlinks.
- Cloudflare Tunnel support lives in Compose as an optional `tunnel` profile; keep `web` and Postgres bound to localhost on the host, and route public web traffic through `cloudflared` to `http://web:3000`.
- Cloudflare Tunnel should run over HTTP/2 in Compose to avoid QUIC/UDP idle timeout issues on local networks, with Docker restart policy set to keep the connector available after failures.
- Cloudflare Tunnel tokens should be mounted from ignored local secret files, not interpolated into Compose commands or committed env examples.
- Local server operations are exposed through `pnpm ops`, which wraps Docker Compose lifecycle commands, crawl/scoring job log queries, remote deploys over SSH (`pnpm ops deploy`), remote 5-minute health watchdog + daily DB backup timer setup (`pnpm ops setup-watchdog`), and one-time DB dump/restore for moving existing data to a fresh VM (`pnpm ops db-dump` / `pnpm ops db-restore`). See `docs/deployment.md` for the full Oracle Cloud VM runbook and `scripts/AGENTS.md` for the command implementations.
- Production Compose exposes crawled-document TTL controls through `CRAWLED_DOCUMENT_TTL_DAYS`, `CRAWLED_DOCUMENT_CLEANUP_INTERVAL_MINUTES`, and `CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE`.
- `CRAWLED_DOCUMENT_TTL_DAYS` defaults to 30 in Compose because raw payloads grow roughly 8-12 GB/month at the current source count; the worker's own schema default remains 365, so any host relying on that default must set the value explicitly. Raising the TTL is only safe when `raw_data` lives on a volume with room for it.
- Lowering a retention default is destructive to existing installs: the cleanup job prunes on the next run. Pin the prior value in an existing deployment's `.env` before changing a default, rather than assuming defaults are inert.
- Every long-lived Compose service must declare a `restart` policy and `mem_limit`; without a restart policy it does not return after a host reboot while its dependents do, producing a crash-loop that still looks "running" in `docker ps`, and without `mem_limit` a crawl-time memory spike can OOM the host and take Postgres down with it. Only the one-shot `migrate` service should be `restart: "no"`. `web` declares a Docker `healthcheck` against `/api/health` and `cloudflared` declares a readiness `healthcheck` via `cloudflared tunnel --metrics 127.0.0.1:2000 ready`.
- Compose services share the `x-logging` anchor so the default non-rotating `json-file` driver cannot fill the host volume. Apply `logging: *logging` to any new service.
- Production Compose exposes scoring spend controls through `SCORING_MAX_DOCUMENTS_PER_RUN` and `SCORING_LOOKBACK_DAYS`.
- E2E smoke credentials live in local env as `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD`; keep the password synthetic and ensure the email is included in `AUTH_ALLOWED_EMAILS`.
- `FEED_SHOW_WHY_RELEVANT` controls whether stored per-story relevance explanations render in the feed; keep it off by default when the profile-level top-story briefing is the primary explanation surface.
- Project-local Codex skills live in `.codex/skills`; update the relevant skill reference when testing workflows or credential conventions change.
- Unit tests run on the built-in Node test runner via `tsx` — `pnpm test` fans out to each package's `test` script (`packages/shared` and `apps/worker`, which run `src/**/*.test.ts`). No vitest/jest; keep unit-tested logic pure and dependency-light so it needs no runner beyond this. Playwright (`@playwright/test`) is installed as a root dev dependency for browser-based E2E testing, driven by the `.codex/skills/e2e-functional-testing` skill. No `playwright.config` or spec files exist yet.
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
