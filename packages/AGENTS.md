# AGENTS.md

## Scope
This file applies to `packages` and its subdirectories unless a deeper file overrides it.

## Architecture
- `packages/*` contains reusable code shared by multiple apps.
- These packages should stay framework-light and represent stable system contracts.

## Implementation Guidance
- Put shared types, schema, and low-level helpers here.
- Avoid importing app-specific runtime APIs from packages.
- If code is only used by one app, prefer keeping it in that app instead of promoting it too early.

