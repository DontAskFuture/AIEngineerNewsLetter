# AGENTS.md

## Scope
This file applies to `packages/db/drizzle` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder contains generated SQL migrations and Drizzle metadata.
- Migrations are ordered history, not a scratch space.
- `0006_next_wendell_rand.sql` introduces the `scoring_jobs` table and `scoring_job_status` enum that back the admin scoring progress tracker (see `apps/web/src/lib/scoring-tracker.ts`).

## Implementation Guidance
- Add new migration files through `drizzle-kit generate`.
- Avoid rewriting old migration history unless there is a very deliberate reason.
- Review generated SQL for safety before shipping it.

