# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed`.

## Architecture
- This route is the personalized feed experience.
- It displays pre-computed document scores joined with documents and sources, filtered by a configurable time window (day/week/month/quarter/year, defaulting to week).
- Server actions in this folder mutate `user_profiles`, including profile CRUD and the user's default profile selection.
- Time window and profile selection are driven by URL search params (`window`, `profile`).
- Profile switching uses a small client selector for optimistic click feedback, but the selected profile data is still loaded by the server page from URL params.

## Implementation Guidance
- Keep form handling and redirects here, but keep ranking and persistence logic in `../../lib/personalized-feed`.
- Server-action redirects should fall back to `window=week` when no current window is submitted.
- The feed reads pre-computed scores from `document_scores`, then may call OpenRouter once at render time to create a profile-level briefing for the selected top stories.
- Feed copy should describe scoring as pre-computed while treating the profile briefing as a live, failure-tolerant enhancement that can include trends, learnings, and a further-study paragraph.
- The stored per-story `whyRelevant` copy should stay available to the UI, but rendering is gated by `FEED_SHOW_WHY_RELEVANT`.
- Feed story links should route through the internal outbound redirect so clicks can persist `document_reads` before leaving the app.
- After read state is applied for signed-in users, stories marked read are removed from the top-10 shortlist and the next unread candidates backfill those slots.
- Anonymous visitors can view a read-only public feed backed by `lianglingfan@gmail.com`'s `AI Engineer` profile; profile management stays signed-in only.
- The anonymous public-profile row should use a contact CTA to `mailto:michael@audivolt.ai` rather than a sign-in CTA.
- Preserve clear visual separation between feed hero controls, profile editing, top stories, more stories, and source registry, and keep those surfaces theme-aware.
- Keep model-selection and operational ranking configuration details out of the feed surface; those belong in admin.
- Profile creation and update should preserve the user’s current feed window and make the selected profile obvious in the interest chip list.
- Users can choose their default feed profile; the default is used only when no explicit `profile` URL param is present.
- Profile creation and selected-profile editing live in one combined profile workspace rather than separate page sections.
- Profile-specific uncontrolled form fields and expandable story sections should be keyed by selected profile so browser state does not leak across profile switches.
- Duplicate profile-name errors are surfaced through feed URL params so server actions can keep using redirects instead of client action state.
- Profile deletes should be soft deletes (`is_active=false`) and redirect to a remaining profile; the UI should prevent deleting the last active profile with a clear error.
- Read-list controls on story cards render only for signed-in users; the public feed stays read-only.
- Signed-in users save individual stories to their read list from each story card via shared read-list server actions; unread stories also expose an inline Mark read action.
