# AGENTS.md

## Scope
This file applies to `packages/db` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package is the single source of truth for the Postgres schema and Drizzle client.
- It exports schema objects used by both the web app and the worker.
- Key tables include `sources`, `source_endpoints`, `documents`, `document_scores`, `document_reads`, `user_document_read_list`, `scoring_jobs`, `user_profiles`, `auth_users`, and `auth_sessions`.
- `auth_login_attempts` records public login attempts for brute-force throttling.
- `user_profiles` includes an `is_default` flag for each user's preferred feed profile.

## Implementation Guidance
- Schema changes begin in `src/schema.ts`.
- Generate migrations after schema edits and keep SQL artifacts committed.
- Prefer explicit column names and conservative migration changes that are easy to reason about.
- The `document_scores` table has a unique index on `(document_id, profile_id)` to support upserts.
- Feed, scoring, cleanup, and dashboard hot paths rely on supporting indexes for document sort time, profile-leading score lookups, fetch history, and raw-document cleanup timestamps.
- The `scoring_jobs` table tracks batch progress with `scored_documents`, `failed_documents`, `current_batch`, and `total_batches`.
