# AGENTS.md

## Scope
This file applies to `apps/web/src/app/admin`.

## Architecture
- This route is the pipeline operations view.
- Access is restricted by `ADMIN_EMAILS`; production should keep that set to `lianglingfan@gmail.com`.
- It reads dashboard metrics, endpoint health, recent fetch attempts, scoring stats (per-source and aggregate), and scoring job history from live Postgres tables.
- It surfaces pg-boss queue state plus recent crawl, scoring, and queue error logs for incident diagnosis.
- Admin actions enqueue crawl and scoring jobs into pg-boss via server actions. The worker processes them.
- `scoring-progress.tsx` polls `/api/scoring-status` to show live progress and job history.
- `action-button.tsx` provides `ActionButton` for server-action-triggered operations with toast feedback.

## Implementation Guidance
- Keep admin-specific presentation here.
- Reuse shared dashboard queries from `../../lib/dashboard` and scoring queries from `../../lib/scoring`.
- Admin buttons should enqueue work, not execute it. The worker owns long-running processes.
- Admin status tables and progress panels should use the shared theme-aware surface styles rather than route-local hardcoded light-mode colors.
- Dense numeric and job-status admin tables should use semantic table markup with fixed columns, tabular numbers for times/counts, truncation for long source names, and horizontal overflow rather than freeform grid rows.
- Error log tables should show the captured error text directly but keep long messages clamped with full text in the title attribute.
- Model selection and ranking configuration details that are too operational for the feed should be surfaced here instead.
