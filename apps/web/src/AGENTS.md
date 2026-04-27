# AGENTS.md

## Scope
This file applies to `apps/web/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `app` is the App Router surface: layouts, pages, and server actions.
- `lib` is the server-side application layer for auth, dashboards, formatting, env loading, personalized ranking, scoring stats, scoring progress, read tracking, and job enqueueing.

## Implementation Guidance
- New product behavior should usually start in `lib`, then be exposed through `app`.
- Avoid cross-importing page files. Share behavior through `lib` instead.
- Keep browser concerns in page components and data concerns in library modules.
- Keep DB access centralized and explicit, with external APIs wrapped in focused modules.
- Long-running work such as crawling and scoring belongs in the worker; web helpers should only enqueue jobs.
- Personalized feed reads and writes must stay scoped to the authenticated user, and deletes should preserve history with soft deletion.
- OpenRouter prompt text should come from shared prompt helpers rather than route-local or lib-local string constants.
- Personalized feed time windows should filter candidate documents in SQL/application code before any OpenRouter prompt is rendered.
