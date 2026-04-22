# AGENTS.md

## Scope
This file applies to `apps` and its subdirectories unless a deeper file overrides it.

## Architecture
- `web` is the user-facing product surface.
- `worker` is the background ingestion and normalization surface.

## Implementation Guidance
- Keep app-specific code inside the owning app.
- Move truly shared logic to `packages/*` instead of duplicating it across apps.
- Runtime environment handling belongs near the app entrypoints, not in shared packages.

