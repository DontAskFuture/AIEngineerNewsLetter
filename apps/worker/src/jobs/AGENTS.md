# AGENTS.md

## Scope
This file applies to `apps/worker/src/jobs`.

## Architecture
- `fetch-source-endpoint.ts` executes fetches and converts remote content into raw and normalized records.
- `score-documents.ts` scores all unscored documents for a given user profile using OpenRouter. It processes documents in batches of 20, caps each candidate at 2000 characters, and writes scores to `document_scores` with progress tracked in `scoring_jobs`.

## Implementation Guidance
- Treat every job as rerunnable.
- Use content hashes and canonical URLs consistently for fetch jobs.
- Scoring jobs create a `scoring_jobs` row at start and update it per batch with scored/failed counts.
- The LLM scoring prompt asks for a 1-100 relevance score plus a `whyRelevant` explanation per document.
- Retry OpenRouter on 429 and 5xx with exponential backoff (up to 3 retries).
- Log operational details, but keep return values compact and machine-friendly.
