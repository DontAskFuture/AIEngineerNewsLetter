# AGENTS.md

## Scope
This file applies to `apps/worker/src/jobs`.

## Architecture
- `fetch-source-endpoint.ts` executes fetches and converts remote content into raw and normalized records.
- `score-documents.ts` scores the most recent unscored documents for a given user profile using the shared scoring config. It writes scores to `document_scores` with progress tracked in `scoring_jobs`.
- `send-daily-newsletter.ts` sends each active user a daily brief for their first active profile and records successful sends in `newsletter_sends`.
- `cleanup-crawled-documents.ts` prunes expired normalized documents and raw payload rows/files using the worker TTL settings.

## Implementation Guidance
- Treat every job as rerunnable.
- Use content hashes and canonical URLs consistently for fetch jobs.
- Fetch jobs should skip normalized document inserts and article-page fetches when the canonical URL already exists in `documents`.
- Fetch jobs should validate source URLs, redirects, and DNS resolution before egress, blocking non-http(s), off-domain, private, link-local, loopback, and metadata-style targets.
- Crawl inserts are capped per fetch/source pass rather than by lifetime database totals; dedupe still relies on canonical URLs.
- Remote fetches should enforce timeout and response-size bounds before persisting raw payloads or parsing HTML/RSS.
- RSS ingestion should store plain-text summaries and body text by stripping HTML and rejecting CSS-heavy feed noise; when feed text is unusable, fetch the linked article with Readability (bounded per feed pass).
- Fetch jobs retry transient network failures, HTTP 429, and HTTP 5xx responses before recording a failed attempt, and failed attempts should preserve the HTTP status when available.
- HTML listing pages should use bounded-concurrency article fetches through the shared fetch helper rather than ad hoc sequential `fetch()` calls.
- HTML article extraction should preserve publication dates from common article/meta tags when available instead of relying only on discovery time.
- Source-specific HTML extraction should use endpoint `parserKey` selectors where known and fall back to the generic same-path strategy only for simple listing pages.
- Scoring jobs create a `scoring_jobs` row at start and update it per batch with scored/failed counts.
- Scoring jobs should read batch size, per-run document cap, preferred model, and ordered model candidates from `packages/shared/src/scoring-config.ts`.
- Scoring jobs may receive `documentIds` to restrict work to newly inserted documents; broad scoring should stay bounded by worker max-document and lookback env controls.
- The shared LLM scoring prompt asks for a 1-100 relevance score plus a `whyRelevant` explanation per document.
- Retry OpenRouter on 429 and 5xx with exponential backoff (up to 3 retries).
- Newsletter jobs must check `newsletter_sends` before sending so worker restarts do not duplicate a user's daily email.
- Newsletter jobs should ensure active users have a default first profile before selecting recipients, then prefer the active profile marked `is_default`.
- Cleanup jobs should delete in batches, rely on existing foreign-key cascades for dependent feed data, and tolerate missing raw payload files.
- Log operational details, but keep return values compact and machine-friendly.
