# AGENTS.md

## Scope
This file applies to `apps/web/src/app/out/[documentId]`.

## Architecture
- This route resolves a document by positive integer id in parallel with `getCurrentUser()` and redirects to the document's validated `http(s):` canonical URL.
- Signed-in users get read tracking before redirect; anonymous public-feed users skip read tracking and still reach the story.
- An invalid, non-positive, or unknown document id redirects to `/feed?window=week` instead of erroring.

## Implementation Guidance
- Read tracking should happen before redirect when possible, but redirecting the user to the story should still succeed if the write fails.
- Keep anonymous redirects read-only and do not synthesize a user/session just to track reads.
- Use the stored document URL from Postgres instead of trusting a redirect target from query params.
