# AGENTS.md

## Scope
This file applies to `apps/web/src/app` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder is the HTTP entry surface for the web app.
- `layout.tsx` defines shared chrome, bootstraps the global light/dark theme state for the app shell, and renders `source-list.tsx` as a concise footer of every seeded source, grouped by category and linked to each source homepage.
- Route folders own page composition and route-local server actions.
- `auth-actions.ts` owns top-level login and logout mutations (without recording new failed-attempt rows once rate-limited); `login/` and `signup/` render the forms that call into it.
- `signup/page.tsx` is the invite-gated account creation form; it has no dedicated AGENTS.md and is governed by this file plus `../lib/auth`. Its entrypoint is intentionally not linked from app chrome.
- `out/[documentId]` resolves a document (`documentId > 0`) and redirects to its validated `http(s):` canonical URL, recording `document_reads` for signed-in users first; anonymous visitors redirect without tracking.
- `api/health` is an unauthenticated JSON health check probing Postgres connectivity (`checkDatabaseHealth`) for Docker healthchecks and monitoring.
- `api/score-all` streams Server-Sent Events while iterating active profiles and delegating per-profile work to `../lib/scoring`. It must stay admin-gated via `getAuthenticatedAdmin()` (`401`/`403`) and thin; it is not currently invoked by any admin UI control (the admin "Score all" button instead enqueues a pg-boss job via `../lib/crawler`).
- `api/scoring-status` is an admin-only JSON endpoint (`getAuthenticatedAdmin()`) that surfaces the current scoring job and recent history via `../lib/scoring-tracker`, powering the admin progress UI polling loop.
- `/` is a thin redirect to `/feed?window=week`, which is the canonical default public feed entrypoint.
- `/read-list` is the authenticated story read-list surface for saving individual documents and reading them later.

## Implementation Guidance
- Keep these files focused on request handling, composition, redirects, and form actions.
- Generic feed links and auth redirects should use `/feed?window=week` so the default week window is explicit in the URL.
- Public app chrome should hide signup entrypoints while signup is invite-gated.
- Move complex business logic into `../lib`.
- Route protection should happen at page entry, not deep in child components.
- Shared visual primitives such as theme-aware buttons, panels, and section separation should be driven from `globals.css` and reused consistently across routes.
- The source footer should keep reading `defaultSources` from `@ai-intel/shared` so the public list matches the seed registry without a database round trip. Keep it to grouped names and homepage links.
