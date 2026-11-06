# AGENTS.md

## Scope
This file applies to `apps/worker/src/storage`.

## Architecture
- Storage adapters persist raw fetched payloads so they can be replayed or debugged later.
- The current implementation uses local filesystem storage but is meant to be swappable.

## Implementation Guidance
- Keep the adapter boundary small and stable.
- Validate `contentHash` (`64` hex chars) before constructing filesystem paths so storage keys cannot escape `RAW_STORAGE_DIR`.
- Preserve enough metadata to support replay, diffing, and migration to object storage later.
- Do not mix normalization logic into storage helpers.

