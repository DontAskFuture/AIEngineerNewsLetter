# AGENTS.md

## Scope
This file applies to `apps/worker/src/services`.

## Architecture
- Services hold worker-specific domain helpers that are broader than a single job step.
- Today this folder mainly owns source registry seeding and synchronization behavior.

## Implementation Guidance
- Keep services focused on domain operations rather than process control.
- Prefer idempotent upserts and explicit mappings from shared seed data to DB tables.

