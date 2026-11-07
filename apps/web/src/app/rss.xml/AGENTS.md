# AGENTS.md

## Scope
This file applies to `apps/web/src/app/rss.xml`.

## Architecture
- `route.ts` serves the public RSS 2.0 XML feed (`GET /rss.xml`) built from `getPublicAiEngineerFeedSnapshot("week")` and personal brand metadata in `loadWebEnv()`.
- Pinned stories appear first, hidden stories are excluded, and any curator "My Take" (`curatorNote`) is prepended to each item's `<description>`.

## Implementation Guidance
- Keep this route read-only, unauthenticated, and thin; delegate feed ranking and caching to `@/lib/personalized-feed`.
- Escape all dynamic strings before interpolating into XML and validate item `<link>` URLs as `http(s):`.
