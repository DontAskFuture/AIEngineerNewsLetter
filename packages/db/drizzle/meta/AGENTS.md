# AGENTS.md

## Scope
This file applies to `packages/db/drizzle/meta`.

## Architecture
- This folder contains Drizzle snapshot metadata that supports migration generation.
- `_journal.json` records the ordered migration history; `0006_snapshot.json` captures the schema state after adding the `scoring_jobs` table used by the admin scoring tracker.

## Implementation Guidance
- Treat these files as generated state.
- Do not hand-edit snapshots unless you are repairing generator output and fully understand the consequences.
- Normal schema work should happen in `../../src/schema.ts`, followed by migration generation.

