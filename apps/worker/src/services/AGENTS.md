# AGENTS.md

## Scope
This file applies to `apps/worker/src/services`.

## Architecture
- Services hold worker-specific domain helpers that are broader than a single job step.
- `source-registry.ts` owns source registry seeding and synchronization behavior.
- `smtp.ts` owns transactional email delivery through authenticated SMTP submission (Gmail on port 587 by default), strips CR/LF characters from header fields (`from`, `to`, `subject`), and attaches RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers via `buildListUnsubscribeHeaders` (covered by `smtp.test.ts`).

## Implementation Guidance
- Keep services focused on domain operations rather than process control.
- Prefer idempotent upserts and explicit mappings from shared seed data to DB tables.
- Seeding must also deactivate drift: endpoints whose URL is no longer in a source's seed, and sources whose slug left `defaultSources`. Upserts alone are additive, so re-pointing a seed URL would otherwise leave the previous endpoint active and still crawled.
- `listActiveSourceEndpoints` requires both the endpoint and its parent source to be active, so deactivating a source is sufficient to stop its crawls.
- Keep provider credentials in the worker env loader and keep email payload construction in jobs.
