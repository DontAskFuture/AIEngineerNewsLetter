# AGENTS.md

## Scope
This file applies to `packages/shared/src`.

## Architecture
- `types.ts` defines shared source, fetch payload, and scoring payload types (`FetchSourceEndpointPayload`, `ScoreDocumentsPayload`).
- `default-sources.ts` is the curated registry seed set.
- `url.ts` handles canonicalization and shared URL behavior.
- `index.ts` is the package export surface.

## Implementation Guidance
- Keep source definitions explicit and readable.
- Shared types should reflect stable contracts used by both apps.
- URL normalization rules should be conservative because they affect dedupe and document identity.
