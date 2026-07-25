# AGENTS.md

## Scope
This file applies to `packages/shared/src`.

## Architecture
- `types.ts` defines shared source, fetch payload, scoring payload, and newsletter payload types (`FetchSourceEndpointPayload`, `ScoreDocumentsPayload`, `SendDailyNewsletterPayload`); scoring payloads may include `documentIds` for targeted worker scoring.
- `types.ts` also declares the `sourceCategories` and `endpointKinds` const arrays backing `SourceCategory`/`EndpointKind`; these are a superset of what is currently seeded (see below), so a new value can be declared ahead of any source that uses it.
- `default-sources.ts` exports a single `defaultSources: SeedSource[]` array, the curated registry seed set: 90 sources with 90 endpoints total (71 `rss`, 19 `html`), across `research_feed` (5), `lab_blog` (14), `engineering_blog` (27), `community_feed` (22), and `github` (22). It spans lab blogs (including non-US labs such as Qwen), engineering blogs, arXiv research feeds (`cs.AI`, `cs.LG`, `cs.CL`), GitHub release/commit feeds for core AI frameworks, safety and evaluation orgs (METR, Epoch AI, Alignment Forum), and individual feeds from prominent AI practitioners and researchers (e.g., Andrej Karpathy, Lilian Weng, Eugene Yan, Chip Huyen, Sebastian Raschka, Eric Jang, Nathan Lambert, Hamel Husain).
- Of the nine `sourceCategories` declared in `types.ts`, only five are used by any seeded source today: `lab_blog`, `engineering_blog`, `research_feed`, `community_feed`, and `github`. `social_trends`, `startup_launch`, `docs`, and `pricing` are declared but currently unused by `default-sources.ts`.
- Of the five `endpointKinds` declared in `types.ts`, only `rss` and `html` are used today; `sitemap`, `docs`, and `pricing` are declared but currently unused.
- `prompts.ts` owns shared LLM prompt templates and rendering helpers used by both web and worker code.
- `scoring-config.ts` owns shared scoring knobs such as batch size, run size, preferred model, and ordered OpenRouter candidate lists for scoring and summaries.
- Seeded source endpoints should default to hourly cadence unless there is a deliberate reason to poll faster.
- `url.ts` handles canonicalization and shared URL behavior.
- `index.ts` is the package export surface.

## Implementation Guidance
- Keep source definitions explicit and readable.
- When expanding the registry, prefer feeds that return valid RSS/Atom and use HTML endpoints only for high-value sources without working feeds.
- HTML endpoints may set `parserKey` when the worker has a source-specific selector strategy (only 7 of the 19 `html` endpoints do today); endpoints without a `parserKey` fall back to the worker's generic link-extraction path, so keep keys stable because existing seeded endpoints are updated by source URL.
- `canonicalDomain` gates worker egress via `isAllowedHost` in `apps/worker`, so it must match the host actually fetched, not the site the stories point at. A feed proxied by another host (for example Hacker News via `hnrss.org`) must use the proxy's domain or every fetch is blocked.
- Endpoints sharing one upstream domain should use staggered `cadenceMinutes` so concurrent fetch workers do not rate-limit each other; the Reddit feeds are staggered at 60/75/90/105 for this reason.
- Prefer converting an HTML endpoint to `rss` whenever the site turns out to publish a feed, since feed parsing is cheaper and avoids listing-page drift.
- Weekend-quiet feeds are normal: arXiv feeds declare `<skipDays>` for Saturday and Sunday and legitimately return zero items then, so an empty arXiv result is not a broken source.
- Shared types should reflect stable contracts used by both apps.
- URL normalization rules should be conservative because they affect dedupe and document identity.
- Prompt templates should stay centralized here and keep complex formatting in TypeScript helpers rather than hidden in template strings.
- Scoring and ranking prompts should include calibrated score rubrics, negative criteria, prompt-injection boundaries, confidence, matched signals, and source/date metadata in the shared candidate format.
- Profile-level top-story summary prompts should summarize how the selected shortlist helps the profile notice, decide, investigate, or act, highlight cross-story industry trends and useful learnings, include a compact further-study paragraph, preserve prompt-injection boundaries, and keep output in a compact JSON contract.
- Shared scoring configuration should live here instead of being hardcoded in web or worker business logic; model fallback order should be represented as explicit ordered candidate lists.
- Ranking prompts should not include time-window metadata; callers must filter candidates deterministically before rendering prompt text.
