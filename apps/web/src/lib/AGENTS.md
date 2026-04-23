# AGENTS.md

## Scope
This file applies to `apps/web/src/lib`.

## Architecture
- This folder is the server-side application layer for the web app.
- It owns auth, dashboard reads, environment parsing, formatting, personalized feed assembly, scoring stats, scoring job tracking, job enqueuing, and OpenRouter integration.
- `crawler.ts` handles both crawl and scoring job enqueuing into pg-boss.
- `scoring.ts` provides scoring stats queries (total/scored/unscored counts, per-source breakdowns).
- `scoring-tracker.ts` reads/writes `scoring_jobs` table state for the admin progress UI.
- `personalized-feed.ts` assembles the feed from pre-computed `document_scores` with time-window filtering.

## Implementation Guidance
- Prefer pure helpers and narrow side effects.
- Keep DB access centralized and explicit.
- External APIs should be wrapped in focused modules with stable return shapes.
- Formatting helpers should stay display-oriented and avoid business decisions.
- Long-running work (actual scoring, crawling) must not run here; only enqueue jobs for the worker.
- Feed ranking caps should apply to source families by canonical domain when multiple feeds belong to the same publisher, such as arXiv subfeeds.
- The feed should still render a full top 10 after source-family caps by backfilling from additional ranked or fallback candidates.
- Read tracking logic belongs here and should stay reusable across feed rendering and outbound redirect handlers.
- Personalized feed profile reads and writes should be scoped to the authenticated user rather than using a global shared profile list.
