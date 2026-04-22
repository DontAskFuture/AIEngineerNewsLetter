# AGENTS.md

## Scope
This file applies to `apps/web/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `app` is the App Router surface: layouts, pages, and server actions.
- `lib` contains server-side helpers for auth, dashboards, formatting, env loading, and personalized ranking.

## Implementation Guidance
- New product behavior should usually start in `lib`, then be exposed through `app`.
- Avoid cross-importing page files. Share behavior through `lib` instead.
- Keep browser concerns in page components and data concerns in library modules.

