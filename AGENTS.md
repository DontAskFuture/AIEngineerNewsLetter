# AGENTS.md

## Scope
This file applies to the entire repository unless a deeper `AGENTS.md` overrides part of it.

## Monorepo Architecture
- `apps/web` is the Next.js application. It owns the UI, route protection, server actions, and server-side orchestration.
- `apps/worker` is the ingestion worker. It fetches sources, stores raw payloads, and upserts normalized documents.
- `packages/db` owns the Postgres schema, Drizzle client, and migrations.
- `packages/shared` owns shared types, source registry seeds, and URL helpers.
- `docs` holds product and implementation notes that explain intent rather than runtime behavior.

## Core Runtime Flow
1. Curated sources are defined in `packages/shared`.
2. The worker fetches endpoints and writes `fetch_jobs`, `fetch_attempts`, `raw_documents`, and `documents`.
3. The web app reads normalized tables for dashboards and the personalized feed.
4. Auth is handled in the web app with `auth_users`, `auth_sessions`, and an `HttpOnly` session cookie.
5. Personalized ranking uses saved `user_profiles` plus OpenRouter Responses.

## Implementation Guidance
- Keep route files thin. Put data access, auth, and ranking logic in `apps/web/src/lib`.
- Keep worker logic idempotent. Prefer upserts and deterministic hashes over destructive rewrites.
- Treat `packages/db/drizzle` and `packages/db/drizzle/meta` as generated artifacts. Generate migrations instead of hand-editing snapshots.
- Shared code should be framework-light. Do not leak Next.js APIs into `packages/*`.
- Prefer additive schema changes. Existing data should keep working after a migration.

## Safe Change Patterns
- Web features usually touch `apps/web/src/app`, `apps/web/src/lib`, and sometimes `packages/db/src/schema.ts`.
- Ingestion features usually touch `apps/worker/src`, `packages/shared/src`, and `packages/db/src/schema.ts`.
- If a change affects persisted data, update the schema first, generate a migration, then wire runtime code.

## AGENTS Policy
- Every code or config change must update the nearest scoped `AGENTS.md` in the same directory tree.
- `CLAUDE.md` exists as a symlink to the local `AGENTS.md` for tool compatibility, but `AGENTS.md` is the source of truth.
- Local enforcement lives in `.githooks/pre-commit` and CI enforcement lives in `.github/workflows/agents-policy.yml`.
- The policy checker is `scripts/check-agents.mjs`.
