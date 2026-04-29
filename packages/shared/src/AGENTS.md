# AGENTS.md

## Scope
This file applies to `packages/shared/src`.

## Architecture
- `types.ts` defines shared source, fetch payload, scoring payload, and newsletter payload types (`FetchSourceEndpointPayload`, `ScoreDocumentsPayload`, `SendDailyNewsletterPayload`).
- `default-sources.ts` is the curated registry seed set.
- `prompts.ts` owns shared LLM prompt templates and rendering helpers used by both web and worker code.
- `scoring-config.ts` owns shared scoring knobs such as batch size, run size, and preferred model.
- Seeded source endpoints should default to hourly cadence unless there is a deliberate reason to poll faster.
- `url.ts` handles canonicalization and shared URL behavior.
- `index.ts` is the package export surface.

## Implementation Guidance
- Keep source definitions explicit and readable.
- Shared types should reflect stable contracts used by both apps.
- URL normalization rules should be conservative because they affect dedupe and document identity.
- Prompt templates should stay centralized here and keep complex formatting in TypeScript helpers rather than hidden in template strings.
- Shared scoring configuration should live here instead of being hardcoded in web or worker business logic.
- Ranking prompts should not include time-window metadata; callers must filter candidates deterministically before rendering prompt text.
