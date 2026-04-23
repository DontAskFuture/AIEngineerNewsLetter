# AGENTS.md

## Scope
This file applies to `packages/db/src`.

## Architecture
- `schema.ts` defines tables and enums including `documents`, `documentScores`, `documentReads`, `scoringJobs`, `scoringJobStatusEnum`, `userProfiles`, and auth tables.
- `user_profiles` is owned by `auth_users` through `user_id`, so personalization data is stored per account rather than globally.
- `client.ts` owns pool and Drizzle client creation.
- `index.ts` is the public export surface for the package.

## Implementation Guidance
- Keep exports intentional and stable.
- Shared DB helpers should be generic enough for both apps.
- Table and enum naming should match the domain model used throughout the repo.
