# AGENTS.md

## Scope
This file applies to `apps/web/src/app/out/[documentId]`.

## Architecture
- This route resolves a document by id and redirects to the document's canonical URL.
- Signed-in users get read tracking before redirect; anonymous public-feed users skip read tracking and still reach the story.

## Implementation Guidance
- Read tracking should happen before redirect when possible, but redirecting the user to the story should still succeed if the write fails.
- Keep anonymous redirects read-only and do not synthesize a user/session just to track reads.
- Use the stored document URL from Postgres instead of trusting a redirect target from query params.
