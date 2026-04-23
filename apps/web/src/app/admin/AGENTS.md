# AGENTS.md

## Scope
This file applies to `apps/web/src/app/admin`.

## Architecture
- This route is the pipeline operations view.
- It reads dashboard metrics, endpoint health, recent fetch attempts, scoring stats (per-source and aggregate), and scoring job history from live Postgres tables.
- Admin actions enqueue crawl and scoring jobs into pg-boss via server actions. The worker processes them.
- `scoring-progress.tsx` polls `/api/scoring-status` to show live progress and job history.
- `action-button.tsx` provides `ActionButton` for server-action-triggered operations with toast feedback.

## Implementation Guidance
- Keep admin-specific presentation here.
- Reuse shared dashboard queries from `../../lib/dashboard` and scoring queries from `../../lib/scoring`.
- Admin buttons should enqueue work, not execute it. The worker owns long-running processes.
- Admin status tables and progress panels should use the shared theme-aware surface styles rather than route-local hardcoded light-mode colors.
- Model selection and ranking configuration details that are too operational for the feed should be surfaced here instead.
