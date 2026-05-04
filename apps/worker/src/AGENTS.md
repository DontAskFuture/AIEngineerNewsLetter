# AGENTS.md

## Scope
This file applies to `apps/worker/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `index.ts` is the long-running entrypoint. It starts pg-boss, registers fetch, scoring, and newsletter queues, seeds sources, and schedules periodic fetch/newsletter enqueuing.
- Successful fetch jobs that insert new normalized documents enqueue `score-documents` jobs for active profiles, using per-profile singleton keys so crawl bursts do not create duplicate scoring work.
- `fetch-once.ts` and `seed-sources.ts` are operational scripts.
- `env.ts` loads and validates worker config including OpenRouter credentials.
- Worker OpenRouter env defaults should match the shared scoring default model unless a deliberate fallback is set in deployment env.
- The default periodic fetch enqueue interval is 60 minutes unless `FETCH_INTERVAL_MINUTES` overrides it.
- Crawl work uses pg-boss `localConcurrency`, defaulting to 5 concurrent fetch workers via `FETCH_WORKER_CONCURRENCY`.
- Crawled document retention is enforced by the worker using `CRAWLED_DOCUMENT_TTL_DAYS`, capped at 365 days, plus cleanup interval and batch-size env controls.
- Scoring cost is bounded with `SCORING_MAX_DOCUMENTS_PER_RUN` and `SCORING_LOOKBACK_DAYS`; crawl-triggered scoring should pass fresh document IDs where available and use document-set-specific singleton keys.
- `jobs`, `services`, and `storage` separate job execution, domain helpers, and persistence adapters.

## Implementation Guidance
- Keep entrypoints small and push reusable logic into subfolders.
- Use the worker env loader for configuration instead of reading raw environment variables everywhere.
- Validate crawler URL schemes, source domains, redirects, and resolved IP ranges before issuing worker egress requests.
- Preserve compatibility with both local execution and Docker execution.
