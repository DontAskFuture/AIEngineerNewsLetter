# AGENTS.md

## Scope
This file applies to `apps/web/src/app` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder is the HTTP entry surface for the web app.
- `layout.tsx` defines shared chrome.
- Route folders own page composition and route-local server actions.
- `auth-actions.ts` owns top-level login and logout mutations.

## Implementation Guidance
- Keep these files focused on request handling, composition, redirects, and form actions.
- Move complex business logic into `../lib`.
- Route protection should happen at page entry, not deep in child components.

