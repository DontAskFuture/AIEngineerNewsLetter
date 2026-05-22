# AGENTS.md

## Scope
This file applies to `packages/db/src`.

## Architecture
- `schema.ts` defines tables and enums including `documents`, `documentScores`, `documentReads`, `userDocumentReadList`, `newsletterSends`, `scoringJobs`, `scoringJobStatusEnum`, `userProfiles`, and auth tables.
- `authLoginAttempts` stores failed and successful auth attempts so the public login surface can throttle repeated failures.
- `user_profiles` is owned by `auth_users` through `user_id`, so personalization data is stored per account rather than globally.
- `user_profiles` enforces unique slugs and unique case-insensitive display names per user.
- `user_profiles.is_default` stores the user's preferred default feed profile and is constrained so each user has at most one active default.
- `newsletter_sends` records successful daily newsletter delivery per user/date to prevent duplicate emails.
- `client.ts` owns pool and Drizzle client creation.
- `index.ts` is the public export surface for the package.
- `schema.ts` includes supporting indexes for feed sort order, profile-scoped score lookup, fetch history, and raw/document retention cleanup.

## Implementation Guidance
- Keep exports intentional and stable.
- Shared DB helpers should be generic enough for both apps.
- Table and enum naming should match the domain model used throughout the repo.
