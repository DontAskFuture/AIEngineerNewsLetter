# AGENTS.md

## Scope
This file applies to `apps/web/src/app/admin`.

## Architecture
- This route is the ingestion operations view.
- It reads dashboard metrics, endpoint health, and recent fetch attempts from live Postgres tables.

## Implementation Guidance
- Keep admin-specific presentation here.
- Reuse shared dashboard queries from `../../lib/dashboard`.
- If the admin page needs new operational metrics, extend the shared dashboard query layer rather than adding ad hoc queries directly in the page.

