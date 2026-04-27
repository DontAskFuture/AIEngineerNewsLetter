# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed`.

## Architecture
- This route is the personalized feed experience.
- It displays pre-computed document scores joined with documents and sources, filtered by a configurable time window (day/week/month/quarter/year, defaulting to week).
- Server actions in this folder mutate `user_profiles`.
- Time window and profile selection are driven by URL search params (`window`, `profile`).
- Profile switching uses a small client selector for optimistic click feedback, but the selected profile data is still loaded by the server page from URL params.

## Implementation Guidance
- Keep form handling and redirects here, but keep ranking and persistence logic in `../../lib/personalized-feed`.
- The feed reads pre-computed scores from `document_scores`; it does not call OpenRouter at render time.
- Both the top shortlist and the expandable "More stories" section should surface `whyRelevant` copy when the ranking layer provides it.
- Feed story links should route through the internal outbound redirect so clicks can persist `document_reads` before leaving the app.
- The page is protected and should continue to assume an authenticated user.
- Preserve clear visual separation between feed hero controls, profile editing, top stories, more stories, and source registry, and keep those surfaces theme-aware.
- Keep model-selection and operational ranking configuration details out of the feed surface; those belong in admin.
- Profile creation and update should preserve the user’s current feed window and make the selected profile obvious in the interest chip list.
- Profile-specific uncontrolled form fields and expandable story sections should be keyed by selected profile so browser state does not leak across profile switches.
- Duplicate profile-name errors are surfaced through feed URL params so server actions can keep using redirects instead of client action state.
- Profile deletes should be soft deletes (`is_active=false`) and redirect to a remaining profile; the UI should prevent deleting the last active profile with a clear error.
