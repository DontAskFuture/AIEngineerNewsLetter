# AGENTS.md

## Scope
This file applies to `packages/db` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package is the single source of truth for the Postgres schema and Drizzle client.
- It exports schema objects used by both the web app and the worker.
- Ingestion tables: `sources`, `source_endpoints`, `fetch_jobs`, `fetch_attempts`, `raw_documents`, and `documents`.
- Scoring and feed tables: `document_scores`, `scoring_jobs`, `ranking_cache`, `document_reads`, and `user_document_read_list`.
- Auth and identity tables: `auth_users`, `auth_sessions`, `auth_login_attempts`, and `user_profiles`.
- Entity extraction tables `entities` and `document_entities` are defined but not yet written to or read by any web or worker code.
- Newsletter delivery is tracked in `newsletter_sends`.
- `auth_login_attempts` records public login attempts for brute-force throttling.
- `user_profiles` includes an `is_default` flag for each user's preferred feed profile.
- `ranking_cache` caches a rendered top-stories summary per `(profile_id, candidates_hash)` with a `expires_at` TTL so repeated feed loads skip re-summarizing.

## Implementation Guidance
- Schema changes begin in `src/schema.ts`.
- Generate migrations after schema edits with `pnpm db:generate` and keep SQL artifacts committed; never hand-edit files under `drizzle/`.
- Prefer explicit column names and conservative migration changes that are easy to reason about.
- The `document_scores` table has a unique index on `(document_id, profile_id)` to support upserts; `ranking_cache` has a matching unique index on `(profile_id, candidates_hash)`.
- Feed, scoring, cleanup, and dashboard hot paths rely on supporting indexes for document sort time, profile-leading score lookups, fetch history, and raw-document cleanup timestamps.
- The `scoring_jobs` table tracks batch progress with `scored_documents`, `failed_documents`, `current_batch`, and `total_batches`.
- `source_category` and `endpoint_kind` are Postgres enums that intentionally declare more values (for example `social_trends`, `startup_launch`, `docs`, `pricing`, `sitemap`) than the seed data in `packages/shared` currently uses; adding a row with an unused-but-declared value does not require a migration.
