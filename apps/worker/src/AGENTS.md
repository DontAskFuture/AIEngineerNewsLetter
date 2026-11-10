# AGENTS.md

## Scope
This file applies to `apps/worker/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `index.ts` is the long-running entrypoint. It starts pg-boss, registers fetch, scoring, and newsletter queues, seeds sources, enqueues startup fetch and profile-scoring runs, and schedules periodic fetch/newsletter enqueuing plus crawled-document cleanup.
- Successful fetch jobs that insert new normalized documents enqueue `score-documents` jobs for active profiles, using per-profile singleton keys so crawl bursts do not create duplicate scoring work.
- `fetch-once.ts` and `seed-sources.ts` are operational scripts for one-shot local runs.
- `env.ts` loads and validates worker config, including OpenRouter, SMTP (`SMTP_FROM_NAME` defaulting to `"Michael's AI Brief"`), and personal brand (`BRAND_AUTHOR_*`, with generic AI engineering curation default bio) credentials, from the repo-root `.env`; `OPENROUTER_MODEL` defaults to `~deepseek/deepseek-flash-latest`.
- `logger.ts` configures the shared pino logger: pretty-printed when `NODE_ENV=development`, structured JSON otherwise, gated by `LOG_LEVEL`, with `err` and `error` serializers so `Error` instances log message and stack traces instead of `{}`.
- Worker OpenRouter env default remains DeepSeek, used only as the fallback for Michael's Take and the industry-trend briefing. Relevance and story topics go to Decider Flash and do not fall back onto that chat model.
- The default periodic fetch enqueue interval is 60 minutes unless `FETCH_INTERVAL_MINUTES` overrides it.
- Crawl work uses pg-boss `localConcurrency`, defaulting to 5 concurrent fetch workers via `FETCH_WORKER_CONCURRENCY`.
- Newsletter enqueuing checks the local hour in `APP_TIME_ZONE` against `NEWSLETTER_SEND_HOUR` every `NEWSLETTER_CHECK_INTERVAL_MINUTES`, then uses a 36-hour singleton key per calendar date so at most one newsletter job is queued per day.
- Crawled document retention is enforced using `CRAWLED_DOCUMENT_TTL_DAYS` (capped at 365 days) plus cleanup interval and batch-size env controls; cleanup runs once at startup and then on that interval, skipping a run if the prior one is still in flight.
- Scoring pages through every unscored document in the lookback (or the targeted id set) until `SCORING_MAX_DOCUMENTS_PER_RUN` (default 20000) stops the run. Crawl-triggered scoring should pass fresh document IDs where available and use document-set-specific singleton keys. `SCORING_LOOKBACK_DAYS` still bounds which history is eligible.
- `jobs`, `services`, and `storage` separate job execution, domain helpers, and persistence adapters.

## Implementation Guidance
- Keep entrypoints small and push reusable logic into subfolders.
- Use the worker env loader for configuration instead of reading raw environment variables everywhere.
- Validate crawler URL schemes, source domains, redirects, and resolved IP ranges before issuing worker egress requests.
- Preserve compatibility with both local execution and Docker execution.
