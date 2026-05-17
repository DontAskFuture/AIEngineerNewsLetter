# AGENTS.md

## Scope
This file applies to `packages/shared/src`.

## Architecture
- `types.ts` defines shared source, fetch payload, scoring payload, and newsletter payload types (`FetchSourceEndpointPayload`, `ScoreDocumentsPayload`, `SendDailyNewsletterPayload`); scoring payloads may include `documentIds` for targeted worker scoring.
- `default-sources.ts` is the curated registry seed set.
- `prompts.ts` owns shared LLM prompt templates and rendering helpers used by both web and worker code.
- `scoring-config.ts` owns shared scoring knobs such as batch size, run size, preferred model, and ordered OpenRouter candidate lists for scoring and summaries.
- Seeded source endpoints should default to hourly cadence unless there is a deliberate reason to poll faster.
- `url.ts` handles canonicalization and shared URL behavior.
- `index.ts` is the package export surface.

## Implementation Guidance
- Keep source definitions explicit and readable.
- When expanding the registry, prefer feeds that return valid RSS/Atom and use HTML endpoints only for high-value sources without working feeds.
- HTML endpoints may set `parserKey` when the worker has a source-specific selector strategy; keep keys stable because existing seeded endpoints are updated by source URL.
- Shared types should reflect stable contracts used by both apps.
- URL normalization rules should be conservative because they affect dedupe and document identity.
- Prompt templates should stay centralized here and keep complex formatting in TypeScript helpers rather than hidden in template strings.
- Scoring and ranking prompts should include calibrated score rubrics, negative criteria, prompt-injection boundaries, confidence, matched signals, and source/date metadata in the shared candidate format.
- Profile-level top-story summary prompts should summarize how the selected shortlist helps the profile notice, decide, investigate, or act, highlight cross-story industry trends and useful learnings, include a compact further-study paragraph, preserve prompt-injection boundaries, and keep output in a compact JSON contract.
- Shared scoring configuration should live here instead of being hardcoded in web or worker business logic; model fallback order should be represented as explicit ordered candidate lists.
- Ranking prompts should not include time-window metadata; callers must filter candidates deterministically before rendering prompt text.
