# AGENTS.md

## Scope
This file applies to `apps/worker` and its subdirectories unless a deeper file overrides it.

## Architecture
- This app handles source ingestion, document normalization, and LLM-based document scoring.
- It runs two pg-boss queues: `fetch-source-endpoint` for crawling and `score-documents` for relevance scoring.
- Fetch jobs persist raw payloads and upsert normalized document records.
- Score jobs call OpenRouter to score documents against user interest profiles, writing results to `document_scores` and tracking progress in `scoring_jobs`.

## Implementation Guidance
- Favor deterministic behavior, retry safety, and append-only storage patterns.
- Keep fetch-time parsing close to the fetch job implementation.
- Scoring jobs must be idempotent. Use upserts for `document_scores` and update `scoring_jobs` per batch.
- OpenRouter calls use exponential backoff with retries on 429 and 5xx errors.
- Environment requires `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `APP_BASE_URL` for scoring to function.
