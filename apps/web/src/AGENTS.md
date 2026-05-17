# AGENTS.md

## Scope
This file applies to `apps/web/src` and its subdirectories unless a deeper file overrides it.

## Architecture
- `app` is the App Router surface: layouts, pages, and server actions.
- `lib` is the server-side application layer for auth, dashboards, formatting, env loading, personalized ranking, scoring stats, scoring progress, operations visibility, read tracking, and job enqueueing.

## Implementation Guidance
- New product behavior should usually start in `lib`, then be exposed through `app`.
- Avoid cross-importing page files. Share behavior through `lib` instead.
- Keep browser concerns in page components and data concerns in library modules.
- Keep DB access centralized and explicit, with external APIs wrapped in focused modules.
- Long-running work such as crawling and scoring belongs in the worker; web helpers should only enqueue jobs.
- Admin observability helpers may read pg-boss and pipeline tables for status/error reporting, but they should not execute long-running worker logic.
- Personalized feed reads and writes must stay scoped to the authenticated user, and deletes should preserve history with soft deletion.
- Public feed reads may use the configured public owner profile but must not expose profile mutation controls or public-owner read state.
- When no explicit feed profile slug is requested, the selected feed profile should use the user's active profile marked as default, then fall back to the normal profile ordering.
- Personalized feed ranking should use pre-computed scores or fall back to newest in-window stories; live LLM calls during feed render are limited to failure-tolerant profile-level summaries of the already-selected top stories.
- Personalized feed ranking should stay relevance-led while applying the configured freshness boost so recent high-signal stories do not get buried by older marginally higher scores.
- Personalized feed ordering should include deterministic tie-breakers, usually descending document id after score/time, because top-story summary cache keys preserve the selected story order.
- OpenRouter prompt text should come from shared prompt helpers rather than route-local or lib-local string constants.
- Profile-level feed summary prompts should come from shared prompt helpers and summarize the selected top stories as a collection rather than replacing stored document scores.
- Top-story profile briefings should use the existing `ranking_cache` table keyed by profile and selected story set so admin refreshes can force regeneration without changing ranking; cache version changes should force regeneration when the briefing JSON contract changes.
- Web OpenRouter parsing should tolerate shared scoring/ranking responses with confidence and matched-signal fields while preserving displayable relevance explanations.
- Web-triggered scoring should match worker scoring by reading run size, batch size, and preferred model from shared scoring config.
- Web OpenRouter calls should select ordered model candidates from shared scoring config and keep env model overrides as explicit final fallbacks.
- Web OpenRouter env defaults may remain a DeepSeek fallback while primary scoring and summary candidates come from shared scoring config.
- Personalized feed time windows should filter candidate documents in SQL/application code before any OpenRouter prompt is rendered.
- Public auth actions should call the shared login-attempt throttle before password verification and record the outcome for auditability.
