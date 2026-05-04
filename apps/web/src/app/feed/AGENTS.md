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
- Server-action redirects should fall back to `window=week` when no current window is submitted.
- The feed reads pre-computed scores from `document_scores`; it does not call OpenRouter at render time.
- Feed copy should describe scoring as pre-computed and non-blocking so the UI matches runtime behavior.
- Both the top shortlist and the expandable "More stories" section should surface `whyRelevant` copy when the ranking layer provides it.
- Feed story links should route through the internal outbound redirect so clicks can persist `document_reads` before leaving the app.
- Anonymous visitors can view a read-only public feed backed by `lianglingfan@gmail.com`'s `AI Engineer` profile; profile management stays signed-in only.
- The anonymous public-profile row should use a contact CTA to `mailto:michael@audivolt.ai` rather than a sign-in CTA.
- Preserve clear visual separation between feed hero controls, profile editing, top stories, more stories, and source registry, and keep those surfaces theme-aware.
- Keep model-selection and operational ranking configuration details out of the feed surface; those belong in admin.
- Profile creation and update should preserve the user’s current feed window and make the selected profile obvious in the interest chip list.
- Profile creation and selected-profile editing live in one combined profile workspace rather than separate page sections.
- Profile-specific uncontrolled form fields and expandable story sections should be keyed by selected profile so browser state does not leak across profile switches.
- Duplicate profile-name errors are surfaced through feed URL params so server actions can keep using redirects instead of client action state.
- Profile deletes should be soft deletes (`is_active=false`) and redirect to a remaining profile; the UI should prevent deleting the last active profile with a clear error.
