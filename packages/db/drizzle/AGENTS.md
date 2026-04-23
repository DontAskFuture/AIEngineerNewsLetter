# AGENTS.md

## Scope
This file applies to `packages/db/drizzle` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder contains generated SQL migrations and Drizzle metadata.
- Migrations are ordered history, not a scratch space.
- `0006_next_wendell_rand.sql` introduces the `scoring_jobs` table and `scoring_job_status` enum that back the admin scoring progress tracker (see `apps/web/src/lib/scoring-tracker.ts`).
- `0007_spotty_layla_miller.sql` introduces `document_reads`, which stores per-user read state for outbound story clicks.
- `0008_flawless_brother_voodoo.sql` scopes `user_profiles` to `auth_users` so each signed-in account owns its own interest profiles.

## Implementation Guidance
- Add new migration files through `drizzle-kit generate`.
- Avoid rewriting old migration history unless there is a very deliberate reason.
- Review generated SQL for safety before shipping it.
- Keep `drizzle/meta` free of Markdown or symlink docs because Drizzle parses that subtree as JSON snapshots during generation.
