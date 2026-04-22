# AGENTS.md

## Scope
This file applies to `packages/db` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package is the single source of truth for the Postgres schema and Drizzle client.
- It exports schema objects used by both the web app and the worker.

## Implementation Guidance
- Schema changes begin in `src/schema.ts`.
- Generate migrations after schema edits and keep SQL artifacts committed.
- Prefer explicit column names and conservative migration changes that are easy to reason about.

