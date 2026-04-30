# AGENTS.md

## Scope
This file applies to `scripts`.

## Architecture
- This folder contains repository-level automation and policy scripts.
- Scripts here should be lightweight, deterministic, and runnable in local and CI contexts.
- `server.mjs` is the local operations CLI for Docker Compose lifecycle, service logs, and crawl/scoring job visibility.

## Implementation Guidance
- Prefer Node built-ins for repo policy checks so scripts run without install-time coupling.
- Prefer Node built-ins for local operations CLIs too; shell out to Docker Compose or psql rather than introducing CLI framework dependencies.
- Keep script inputs explicit and make failure messages actionable.
- Repository policy scripts should explain how to fix violations, not just fail.
- AGENTS policy checks should ignore non-source build, test report, and artifact folders instead of requiring scoped policy files there.
