# AGENTS.md

## Scope
This file applies to `apps/web/src/app` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder is the HTTP entry surface for the web app.
- `layout.tsx` defines shared chrome and bootstraps the global light/dark theme state for the app shell.
- Route folders own page composition and route-local server actions.
- `auth-actions.ts` owns top-level login and logout mutations.
- `out/[documentId]` is the authenticated outbound redirect that records `document_reads` before redirecting to an external story URL.
- `api/score-all` streams Server-Sent Events while iterating active profiles and delegating per-profile work to `../lib/scoring`. It must stay admin-gated and thin.
- `api/scoring-status` is an admin-only JSON endpoint that surfaces the current scoring job and recent history via `../lib/scoring-tracker`, powering the admin progress UI polling loop.
- `/` is a thin redirect to `/feed?window=week`, which is the canonical default public feed entrypoint.
- `/read-list` is the authenticated story read-list surface for saving individual documents and reading them later.

## Implementation Guidance
- Keep these files focused on request handling, composition, redirects, and form actions.
- Generic feed links and auth redirects should use `/feed?window=week` so the default week window is explicit in the URL.
- Public app chrome should hide signup entrypoints while signup is invite-gated.
- Move complex business logic into `../lib`.
- Route protection should happen at page entry, not deep in child components.
- Shared visual primitives such as theme-aware buttons, panels, and section separation should be driven from `globals.css` and reused consistently across routes.
