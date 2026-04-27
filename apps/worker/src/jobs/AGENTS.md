# AGENTS.md

## Scope
This file applies to `apps/worker/src/jobs`.

## Architecture
- `fetch-source-endpoint.ts` executes fetches and converts remote content into raw and normalized records.
- `score-documents.ts` scores all unscored documents for a given user profile using OpenRouter. It processes documents in batches of 20, caps each candidate at 2000 characters, and writes scores to `document_scores` with progress tracked in `scoring_jobs`.
- `send-daily-newsletter.ts` sends each active user a daily brief for their first active profile and records successful sends in `newsletter_sends`.

## Implementation Guidance
- Treat every job as rerunnable.
- Use content hashes and canonical URLs consistently for fetch jobs.
- Fetch jobs should skip normalized document inserts and article-page fetches when the canonical URL already exists in `documents`.
- Scoring jobs create a `scoring_jobs` row at start and update it per batch with scored/failed counts.
- The shared LLM scoring prompt asks for a 1-100 relevance score plus a `whyRelevant` explanation per document.
- Retry OpenRouter on 429 and 5xx with exponential backoff (up to 3 retries).
- Newsletter jobs must check `newsletter_sends` before sending so worker restarts do not duplicate a user's daily email.
- Newsletter jobs should ensure active users have a default first profile before selecting recipients.
- Log operational details, but keep return values compact and machine-friendly.
