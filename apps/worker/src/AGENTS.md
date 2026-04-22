# AGENTS.md

## Scope
This file applies to `apps/worker/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `index.ts` is the long-running entrypoint.
- `fetch-once.ts` and `seed-sources.ts` are operational scripts.
- `jobs`, `services`, and `storage` separate job execution, domain helpers, and persistence adapters.

## Implementation Guidance
- Keep entrypoints small and push reusable logic into subfolders.
- Use the worker env loader for configuration instead of reading raw environment variables everywhere.
- Preserve compatibility with both local execution and Docker execution.

