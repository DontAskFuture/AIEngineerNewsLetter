# AGENTS.md

## Scope
This file applies to `apps/worker/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `index.ts` is the long-running entrypoint. It starts pg-boss, registers fetch, scoring, and newsletter queues, seeds sources, enqueues startup fetch and profile-scoring runs, and schedules periodic fetch/newsletter enqueuing plus crawled-document cleanup.
- Successful fetch jobs that insert new normalized documents enqueue `score-documents` jobs for active profiles, using per-profile singleton keys so crawl bursts do not create duplicate scoring work.
- `fetch-once.ts` and `seed-sources.ts` are operational scripts for one-shot local runs.
- `env.ts` loads and validates worker config, including OpenRouter and SMTP credentials, from the repo-root `.env`; `OPENROUTER_MODEL` defaults to `deepseek/deepseek-v4-flash-0731`.
- `logger.ts` configures the shared pino logger: pretty-printed when `NODE_ENV=development`, structured JSON otherwise, gated by `LOG_LEVEL`, with `err` and `error` serializers so `Error` instances log message and stack traces instead of `{}`.
- Worker OpenRouter env default is the same DeepSeek model as the shared scoring config's sole scoring/summary candidate, so there is currently no cross-provider fallback if that model or provider has an outage.
- The default periodic fetch enqueue interval is 60 minutes unless `FETCH_INTERVAL_MINUTES` overrides it.
- Crawl work uses pg-boss `localConcurrency`, defaulting to 5 concurrent fetch workers via `FETCH_WORKER_CONCURRENCY`.
- Newsletter enqueuing checks the local hour in `APP_TIME_ZONE` against `NEWSLETTER_SEND_HOUR` every `NEWSLETTER_CHECK_INTERVAL_MINUTES`, then uses a 36-hour singleton key per calendar date so at most one newsletter job is queued per day.
- Crawled document retention is enforced using `CRAWLED_DOCUMENT_TTL_DAYS` (capped at 365 days) plus cleanup interval and batch-size env controls; cleanup runs once at startup and then on that interval, skipping a run if the prior one is still in flight.
- Scoring cost is bounded with `SCORING_MAX_DOCUMENTS_PER_RUN` and `SCORING_LOOKBACK_DAYS`; crawl-triggered scoring should pass fresh document IDs where available and use document-set-specific singleton keys.
- `jobs`, `services`, and `storage` separate job execution, domain helpers, and persistence adapters.

## Implementation Guidance
- Keep entrypoints small and push reusable logic into subfolders.
- Use the worker env loader for configuration instead of reading raw environment variables everywhere.
- Validate crawler URL schemes, source domains, redirects, and resolved IP ranges before issuing worker egress requests.
- Preserve compatibility with both local execution and Docker execution.
