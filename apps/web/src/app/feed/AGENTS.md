# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed`.

## Architecture
- This route is the personalized feed experience.
- It displays pre-computed document scores joined with documents and sources, filtered by a configurable time window (day/week/month/quarter/year, defaulting to week).
- Server actions in this folder mutate `user_profiles`.
- Time window and profile selection are driven by URL search params (`window`, `profile`).

## Implementation Guidance
- Keep form handling and redirects here, but keep ranking and persistence logic in `../../lib/personalized-feed`.
- The feed reads pre-computed scores from `document_scores`; it does not call OpenRouter at render time.
- The page is protected and should continue to assume an authenticated user.
