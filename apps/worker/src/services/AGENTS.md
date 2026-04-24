# AGENTS.md

## Scope
This file applies to `apps/worker/src/services`.

## Architecture
- Services hold worker-specific domain helpers that are broader than a single job step.
- `source-registry.ts` owns source registry seeding and synchronization behavior.
- `sendpulse.ts` owns transactional email delivery through the SendPulse REST API.

## Implementation Guidance
- Keep services focused on domain operations rather than process control.
- Prefer idempotent upserts and explicit mappings from shared seed data to DB tables.
- Keep provider credentials in the worker env loader and keep email payload construction in jobs.
