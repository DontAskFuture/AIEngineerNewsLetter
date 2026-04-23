# AGENTS.md

## Scope
This file applies to `packages/db` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package is the single source of truth for the Postgres schema and Drizzle client.
- It exports schema objects used by both the web app and the worker.
- Key tables include `sources`, `source_endpoints`, `documents`, `document_scores`, `scoring_jobs`, `user_profiles`, `auth_users`, and `auth_sessions`.

## Implementation Guidance
- Schema changes begin in `src/schema.ts`.
- Generate migrations after schema edits and keep SQL artifacts committed.
- Prefer explicit column names and conservative migration changes that are easy to reason about.
- The `document_scores` table has a unique index on `(document_id, profile_id)` to support upserts.
- The `scoring_jobs` table tracks batch progress with `scored_documents`, `failed_documents`, `current_batch`, and `total_batches`.
