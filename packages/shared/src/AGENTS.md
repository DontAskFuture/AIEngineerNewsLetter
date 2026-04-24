# AGENTS.md

## Scope
This file applies to `packages/shared/src`.

## Architecture
- `types.ts` defines shared source, fetch payload, scoring payload, and newsletter payload types (`FetchSourceEndpointPayload`, `ScoreDocumentsPayload`, `SendDailyNewsletterPayload`).
- `default-sources.ts` is the curated registry seed set.
- Seeded source endpoints should default to hourly cadence unless there is a deliberate reason to poll faster.
- `url.ts` handles canonicalization and shared URL behavior.
- `index.ts` is the package export surface.

## Implementation Guidance
- Keep source definitions explicit and readable.
- Shared types should reflect stable contracts used by both apps.
- URL normalization rules should be conservative because they affect dedupe and document identity.
