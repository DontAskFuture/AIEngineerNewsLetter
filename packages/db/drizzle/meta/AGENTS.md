# AGENTS.md

## Scope
This file applies to `packages/db/drizzle/meta`.

## Architecture
- This folder contains Drizzle snapshot metadata that supports migration generation.

## Implementation Guidance
- Treat these files as generated state.
- Do not hand-edit snapshots unless you are repairing generator output and fully understand the consequences.
- Normal schema work should happen in `../../src/schema.ts`, followed by migration generation.

