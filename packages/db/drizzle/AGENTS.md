# AGENTS.md

## Scope
This file applies to `packages/db/drizzle` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder contains generated SQL migrations and Drizzle metadata.
- Migrations are ordered history, not a scratch space.

## Implementation Guidance
- Add new migration files through `drizzle-kit generate`.
- Avoid rewriting old migration history unless there is a very deliberate reason.
- Review generated SQL for safety before shipping it.

