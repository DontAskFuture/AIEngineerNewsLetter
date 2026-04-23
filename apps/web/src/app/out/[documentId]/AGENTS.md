# AGENTS.md

## Scope
This file applies to `apps/web/src/app/out/[documentId]`.

## Architecture
- This route resolves a document by id, marks it as read for the current user, and redirects to the document's canonical URL.

## Implementation Guidance
- Read tracking should happen before redirect when possible, but redirecting the user to the story should still succeed if the write fails.
- Use the stored document URL from Postgres instead of trusting a redirect target from query params.
