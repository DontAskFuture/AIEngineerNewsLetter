# AGENTS.md

## Scope
This file applies to `apps/web/src/app/read-list`.

## Architecture
- Authenticated-only route for a per-user story read list (saved documents), separate from `document_reads` read-state tracking.
- `user_document_read_list` stores `(user_id, document_id)` rows; story read state still uses `document_reads`.
- `../../middleware.ts` redirects unauthenticated `/read-list` requests to `/login?next=...` before the page renders.
- Document listing queries live in `../../lib/document-read-list.ts`.
- Opening a story still uses `/out/[documentId]` so read state stays consistent with the feed.

## Implementation Guidance
- The page and server actions both require a signed-in user; anonymous visitors never see read-list UI or mutations.
- Filter is URL-driven (`filter=all|unread`) without a time window; saved stories stay listed until removed.
- Prefer server-rendered forms for add/remove/mark-read mutations; validate `timeWindow` on return redirects, tolerate stale/pruned document IDs gracefully, and use `revalidatePath` on `/read-list` and `/feed`.
- Feed story cards add/remove individual documents via shared read-list server actions.
