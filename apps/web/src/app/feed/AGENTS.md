# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed`.

## Architecture
- This route is the personalized feed experience.
- It displays pre-computed document scores joined with documents and sources, filtered by a configurable time window (day/week/month/quarter/year, defaulting to week).
- Server actions in this folder mutate `user_profiles` (profile CRUD and default profile selection), `story_curations` ("My Take" notes, pin-to-top-10, and hide-story toggles), and `newsletter_subscribers` (public email subscription).
- Time window, profile selection, and newsletter status banners are driven by URL search params (`window`, `profile`, `newsletter`).
- Profile switching uses a small client selector for optimistic click feedback, but the selected profile data is still loaded by the server page from URL params.
- `profile-selector.tsx`, `feed-story-actions.tsx`, and `more-stories.tsx` are the client components for profile switching, per-story curation ("My Take" note editor with AI draft seeding, Pin/Unpin, Hide/Unhide) plus read-list/mark-read actions, and the paginated secondary story list, respectively.
- `unsubscribe/route.ts` handles one-click newsletter unsubscriptions via `token` query param.

## Implementation Guidance
- Keep form handling and redirects here, but keep ranking and persistence logic in `../../lib/personalized-feed`.
- Server-action redirects should fall back to `window=week` when no current window is submitted.
- The feed reads pre-computed scores from `document_scores`, then may call OpenRouter once at render time to create a profile-level briefing for the selected top stories, rendered as a dedicated `Today's Trend & Highlights` section (`Today's Industry Trend`, `Today's Highlights`, and `Engineering Radar · What To Stress-Test Next`) above `Top stories`.
- Feed copy should describe scoring as pre-computed while treating the `Today's Trend & Highlights` briefing as a live, failure-tolerant enhancement that synthesizes macro industry trends, standout highlights, and a further-study radar paragraph.
- Each story card renders a spicy practitioner take (`formatPractitionerTake(curatorNote, whyRelevant)`) labeled `{brandAuthorName}'s Take` (defaulting to `Michael's Take`), preferring manual `curatorNote` overrides and falling back to cleaned `whyRelevant` commentary.
- Feed story links should route through the internal outbound redirect so clicks can persist `document_reads` before leaving the app.
- After read state is applied for signed-in users, stories marked read are removed from the top-10 shortlist and the next unread candidates backfill those slots.
- Anonymous visitors can view a read-only public feed backed by `lianglingfan@gmail.com`'s default profile, styled with personal branding (`BRAND_AUTHOR_*`) and an inline email newsletter subscription form plus RSS link; profile management and story curation controls stay signed-in only.
- Preserve clear visual separation between feed hero controls, profile editing, top stories, and more stories, and keep those surfaces theme-aware.
- The public source list lives in the root layout footer. Do not rebuild the old per-source crawl-stats registry on this page; operational source health stays on `/admin`.
- Keep model-selection and operational ranking configuration details out of the feed surface; those belong in admin.
- Profile creation and update should preserve the user’s current feed window and make the selected profile obvious in the interest chip list.
- Users can choose their default feed profile; the default is used only when no explicit `profile` URL param is present.
- Profile creation and selected-profile editing live in one combined profile workspace rather than separate page sections, enforcing client/server `maxLength` bounds (`80` for display names, `2000` for interest statements).
- Profile-specific uncontrolled form fields and expandable story sections should be keyed by selected profile so browser state does not leak across profile switches.
- Duplicate profile-name errors are surfaced through feed URL params so server actions can keep using redirects instead of client action state.
- Profile deletes should be soft deletes (`is_active=false`) and redirect to a remaining profile; the UI should prevent deleting the last active profile with a clear error.
- Read-list controls on story cards render only for signed-in users; the public feed stays read-only.
- Signed-in users save individual stories to their read list from each story card via shared read-list server actions; unread stories also expose an inline Mark read action.
