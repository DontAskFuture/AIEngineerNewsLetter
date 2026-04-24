# AGENTS.md

## Scope
This file applies to `apps/worker/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `index.ts` is the long-running entrypoint. It starts pg-boss, registers fetch, scoring, and newsletter queues, seeds sources, and schedules periodic fetch/newsletter enqueuing.
- `fetch-once.ts` and `seed-sources.ts` are operational scripts.
- `env.ts` loads and validates worker config including OpenRouter credentials.
- The default periodic fetch enqueue interval is 60 minutes unless `FETCH_INTERVAL_MINUTES` overrides it.
- Crawl work uses pg-boss `localConcurrency`, defaulting to 5 concurrent fetch workers via `FETCH_WORKER_CONCURRENCY`.
- `jobs`, `services`, and `storage` separate job execution, domain helpers, and persistence adapters.

## Implementation Guidance
- Keep entrypoints small and push reusable logic into subfolders.
- Use the worker env loader for configuration instead of reading raw environment variables everywhere.
- Preserve compatibility with both local execution and Docker execution.
