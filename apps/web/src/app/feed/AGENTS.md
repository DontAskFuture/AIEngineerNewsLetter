# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed`.

## Architecture
- This route is the personalized feed experience.
- It combines dashboard coverage data with authenticated profile-driven ranking.
- Server actions in this folder mutate `user_profiles`.

## Implementation Guidance
- Keep form handling and redirects here, but keep ranking and persistence logic in `../../lib/personalized-feed`.
- The feed should gracefully fall back when OpenRouter is unavailable.
- The page is protected and should continue to assume an authenticated user.

