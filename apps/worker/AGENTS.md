# AGENTS.md

## Scope
This file applies to `apps/worker` and its subdirectories unless a deeper file overrides it.

## Architecture
- This app handles source ingestion and document normalization.
- It runs fetch jobs, persists raw payloads, and upserts normalized document records.

## Implementation Guidance
- Favor deterministic behavior, retry safety, and append-only storage patterns.
- Keep fetch-time parsing close to the fetch job implementation.
- Avoid web-app-specific concerns here. The worker should only care about ingestion and normalization.

