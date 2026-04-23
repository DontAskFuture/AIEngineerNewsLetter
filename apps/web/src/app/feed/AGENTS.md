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
- Both the top shortlist and the expandable "More stories" section should surface `whyRelevant` copy when the ranking layer provides it.
- Feed story links should route through the internal outbound redirect so clicks can persist `document_reads` before leaving the app.
- The page is protected and should continue to assume an authenticated user.
- Preserve clear visual separation between feed hero controls, profile editing, top stories, more stories, and source registry, and keep those surfaces theme-aware.
