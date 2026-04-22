# AGENTS.md

## Scope
This file applies to `apps/web/src/lib`.

## Architecture
- This folder is the server-side application layer for the web app.
- It owns auth, dashboard reads, environment parsing, formatting, personalized feed assembly, and OpenRouter integration.

## Implementation Guidance
- Prefer pure helpers and narrow side effects.
- Keep DB access centralized and explicit.
- External APIs should be wrapped in focused modules with stable return shapes.
- Formatting helpers should stay display-oriented and avoid business decisions.

