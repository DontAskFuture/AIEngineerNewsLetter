# AGENTS.md

## Scope
This file applies to `apps/web/src/lib`.

## Architecture
- `auth.ts` owns password hashing (scrypt), session cookies (`ai_intel_session`), the login-attempt throttle, allowlist/admin checks, and the `requireCurrentUser`/`requireAdmin` guards used by pages and server actions.
- `env.ts` loads and memoizes process env into a typed `loadWebEnv()` snapshot: OpenRouter key/model (default `deepseek/deepseek-v4-flash-0731`, matching the shared scoring config's sole model), app base URL/timezone, `FEED_SHOW_WHY_RELEVANT`, allowed/admin emails, and session length.
- `crawler.ts` enqueues `fetch-source-endpoint` and `score-documents` jobs directly into `pgboss.job` and reads recent crawl job status/summary for the admin dashboard.
- `dashboard.ts` builds the source registry, endpoint health, category breakdown, and recent fetch attempts shown on `/admin` and `/feed`.
- `operations.ts` aggregates pg-boss queue summaries plus recent crawl/scoring/queue error logs for admin incident diagnosis; it is read-only and never executes worker logic.
- `scoring.ts` scores a profile's unscored documents in OpenRouter batches, persists `document_scores`, and tracks progress through `scoring-tracker.ts`; it also exposes `getScoringStats`/`getScoringStatsBySource` for admin. Its `scoreUnscoredDocuments` is the inline (web-process) scoring path used by `app/api/score-all`, separate from the worker's own scoring job.
- `scoring-tracker.ts` reads and writes `scoring_jobs` rows: starts a job, updates batch progress, marks stale (>30 min) running jobs as failed, and returns current/history state for `/api/scoring-status`.
- `openrouter.ts` wraps OpenRouter chat completions with model-candidate fallback and retry/backoff, exposing `rankDocumentsForInterest`, `scoreDocumentBatch`, and `summarizeTopStoriesForProfile`, all built on shared prompt templates from `@ai-intel/shared`. Retry-vs-fall-through is decided by `decideRetry`/`extractBodyError` from `@ai-intel/shared`, so a failing free-tier candidate is skipped immediately rather than retried, and requests are bounded by a 60s `AbortSignal.timeout`.
- `personalized-feed.ts` is the feed's core module: profile CRUD (with duplicate-name and last-profile-delete guards), candidate document selection, pre-computed-score ranking with a freshness boost, per-user read-state backfill of the top-10 shortlist, and the cached (`ranking_cache`) profile-level top-stories briefing.
- `read-tracking.ts` records `document_reads` (`markDocumentRead`) and joins read state onto arbitrary document lists (`applyReadStateToDocuments`).
- `document-read-list.ts` manages the separate `user_document_read_list` save list (add/remove/list) and builds the `/read-list` page snapshot by joining saved documents with read state from `read-tracking.ts`.
- `formatters.ts` holds presentation-only helpers (relative/absolute time, compact numbers, percent, duration, category label, text truncation) with no DB or network access.

## Implementation Guidance
- Keep DB access and external API calls inside these modules; route and page files should call into `lib`, not query Postgres or OpenRouter directly.
- `env.ts` caches its result in a module-level variable; treat env values as effectively static for the life of the process rather than re-reading `process.env` elsewhere.
- Scoring and ranking candidates come from the module-level `ScoringModelPool` singleton in `openrouter.ts` (via `resolveScoringCandidates`), not from a static list; summaries still use `selectSummaryModelCandidates`. `env.openRouterModel` stays the final explicit fallback. Every call must report its outcome back through `pool.recordSuccess`/`pool.recordFailure`, or the circuit breaker never learns and parked models are re-probed forever.
- Do not reimplement OpenRouter status handling here; call `decideRetry`/`isFreeTierModel`/`extractBodyError` from `@ai-intel/shared` so the web and worker clients stay in sync. A failed candidate must `break` to the next model, never `throw`, or the remaining pool and the paid backstop are skipped.
- `crawler.ts` enqueues jobs with a `singleton_key` and `ON CONFLICT DO NOTHING`; new job-enqueue helpers should follow the same idempotent pattern instead of inserting duplicate rows.
- `personalized-feed.ts` and `document-read-list.ts` both take an explicit `userId`/`readStateUserId` scoping parameter; never build a query that reads or writes another user's rows without it.
- Prefer extending `scoring-tracker.ts` over adding new ad hoc progress-state tables when tracking future long-running jobs.
