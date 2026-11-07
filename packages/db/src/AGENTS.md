# AGENTS.md

## Scope
This file applies to `packages/db/src`.

## Architecture
- `schema.ts` defines every table and enum: ingestion (`sources`, `sourceEndpoints`, `fetchJobs`, `fetchAttempts`, `rawDocuments`, `documents`), entity extraction (`entities`, `documentEntities`), scoring/feed (`documentScores`, `scoringJobs`, `rankingCache`, `documentReads`, `userDocumentReadList`, `storyCurations`), newsletter (`newsletterSends`, `newsletterSubscribers`), and auth/profile (`authUsers`, `authSessions`, `authLoginAttempts`, `userProfiles`) tables.
- Enums: `sourceCategoryEnum`, `endpointKindEnum`, `fetchStatusEnum`, `storageProviderEnum`, `entityKindEnum`, and `scoringJobStatusEnum`.
- `entities` and `documentEntities` model extracted companies/models/products/repos/papers/people/topics per document but currently have no reader or writer in `apps/web` or `apps/worker`.
- `authLoginAttempts` stores failed and successful auth attempts so the public login surface can throttle repeated failures.
- `user_profiles` is owned by `auth_users` through `user_id`, so personalization data is stored per account rather than globally.
- `user_profiles` enforces unique slugs and unique case-insensitive display names per user.
- `user_profiles.is_default` stores the user's preferred default feed profile and is constrained so each user has at most one active default.
- `newsletter_sends` records successful daily newsletter delivery per user/date to prevent duplicate emails.
- `ranking_cache` stores a cached top-stories summary JSON blob per `(profile_id, candidates_hash)` with an `expires_at` TTL; it is read and written by the web app's personalized feed code.
- `client.ts` owns pool and Drizzle client creation via `getPool`/`getDb` (with bounded connection/idle timeouts, TCP keepAlive, an idle-client error listener, and `globalThis` reuse in development), and exposes `closePool` for teardown.
- `index.ts` re-exports `client.ts` and the whole `schema.ts` module as `schema`.
- `schema.ts` includes supporting indexes for feed sort order, profile-scoped score lookup, fetch history, and raw/document retention cleanup.

## Implementation Guidance
- Keep exports intentional and stable.
- Shared DB helpers should be generic enough for both apps.
- Table and enum naming should match the domain model used throughout the repo.
- `getDb`/`getPool` memoize a single connection pool per process; call `closePool` in scripts and tests that need a clean shutdown.
