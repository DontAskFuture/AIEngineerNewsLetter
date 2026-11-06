# AGENTS.md

## Scope
This file applies to `apps/worker/src/jobs`.

## Architecture
- `fetch-source-endpoint.ts` executes fetches and converts remote content into raw and normalized records.
- `score-documents.ts` scores the most recent unscored documents for a given user profile using the shared scoring config. It writes scores to `document_scores` with progress tracked in `scoring_jobs`.
- `send-daily-newsletter.ts` sends each active user a daily brief for their default active profile, falling back to their earliest-created active profile, through `services/smtp.ts`, and records successful sends in `newsletter_sends`.
- `cleanup-crawled-documents.ts` prunes expired normalized documents and raw payload rows/files using the worker TTL settings.
- `html-links.ts` owns listing-page link extraction: the `parserKey` selector registry (`htmlParserConfigs`) and `extractArticleLinks`. It is a pure, dependency-light module so listing strategies can be verified against live HTML without a database.

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
- Add a `parserKey` only when the generic same-path strategy fails, which happens when a listing page links to sibling sections (Epoch AI, Physical Intelligence's `/blog` and `/research`) or is served from the site root so the listing path is empty (LMArena).
- A listing page that links only to off-domain URLs cannot produce documents, because `extractArticleLinks` enforces same-origin. Prefer a feed, or drop the source, rather than adding a parser for it.
- HTML listing sources return HTTP 200 even when they yield zero links, so status codes alone do not prove a source works. Verify new or re-pointed HTML endpoints by running `extractArticleLinks` against the live page and confirming a non-zero link count.
- Scoring jobs create a `scoring_jobs` row at start and update it per batch with scored/failed counts.
- Scoring jobs read batch size and per-run document cap from `packages/shared/src/scoring-config.ts`, but model candidates come from the module-level `ScoringModelPool` singleton (discovery + circuit breaker), with `OPENROUTER_MODEL` appended as the final fallback. Every call must report its outcome back through `pool.recordSuccess`/`pool.recordFailure`, or the breaker never learns and parked models are re-probed on every batch.
- Scoring jobs may receive `documentIds` to restrict work to newly inserted documents; broad scoring should stay bounded by worker max-document and lookback env controls.
- The shared LLM scoring prompt receives the profile's display name, interest statement, and `extractDocumentPreview` excerpts, and asks for reasoning-first JSON (`matchedSignals`, `whyRelevant`, `confidence`, `score`) enforced with `response_format: { type: "json_object" }` and validated via `parseScoreDocumentsResponse`. Invalid or empty score JSON is recorded as a 502 model failure and falls through to the next candidate in the pool.
- Retry OpenRouter on 429 and 5xx with exponential backoff (up to 3 retries), except that any failure from a free-tier (`:free`) candidate falls through to the next model immediately, with no backoff. That policy lives in `decideRetry`/`isFreeTierModel`/`extractBodyError` in `@ai-intel/shared`; call it rather than re-deriving status checks here.
- Scoring requests must set a 60s `AbortSignal.timeout`, because a hung free-pool endpoint would otherwise stall the whole scoring job. A failed candidate must `break` to the next model, never `throw`, or the remaining pool and the paid backstop are skipped.
- Newsletter jobs must check `newsletter_sends` before sending so worker restarts do not duplicate a user's daily email.
- Newsletter jobs should ensure active users have a default first profile before selecting recipients, then prefer the active profile marked `is_default`.
- Newsletter story selection ranks scored documents from the last 24 hours, caps stories per source domain and total count, and falls back to the most recently discovered unscored documents when no scored stories qualify.
- Cleanup jobs should delete in batches, rely on existing foreign-key cascades for dependent feed data, and tolerate missing raw payload files.
- Log operational details, but keep return values compact and machine-friendly.
