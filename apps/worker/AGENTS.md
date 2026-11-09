# AGENTS.md

## Scope
This file applies to `apps/worker` and its subdirectories unless a deeper file overrides it.

## Architecture
- This app handles source ingestion, document normalization, LLM-based document scoring, and daily newsletter delivery.
- It runs pg-boss queues: `fetch-source-endpoint` for crawling, `score-documents` for relevance scoring, and `send-daily-newsletter` for email briefs.
- A separate in-process interval (not a pg-boss queue) prunes expired documents and raw payload files once retention settings expire, guarded so overlapping runs are skipped.
- Fetch jobs persist raw payloads and insert only new normalized documents, skipping rows whose canonical URL already exists.
- Score jobs call Jev on OpenRouter for profile relevance and story topic, then DeepSeek for Michael's Take on qualifying stories. Scores land in `document_scores`, topics on `documents.story_topic`, and progress in `scoring_jobs`.
- Newsletter jobs send SMTP mail for the top daily stories for each active user's default active profile, falling back to their earliest-created active profile.
- Startup re-seeds the source registry from `packages/shared` and deactivates sources/endpoints that dropped out of the seed list, so retired sources stop being crawled.

## Implementation Guidance
- Favor deterministic behavior, retry safety, and append-only storage patterns.
- Keep job orchestration in the job file; extract pure, dependency-light parsing helpers (for example listing-page link extraction) into their own module so they can be verified without a database via `pnpm --filter worker test`.
- Scoring jobs must be idempotent. Use upserts for `document_scores`, re-verify the profile's interest statement before persisting batch results, and update `scoring_jobs` per batch.
- OpenRouter calls use exponential backoff with retries on 429 and 5xx errors.
- `OPENROUTER_API_KEY` has no default and scoring throws without it; `OPENROUTER_MODEL` and `APP_BASE_URL` fall back to working defaults.
- Newsletter delivery requires `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL`; without them the worker logs and skips newsletter scheduling entirely. `SMTP_HOST` defaults to `smtp.gmail.com` and `SMTP_PORT` defaults to 587.
