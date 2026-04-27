# AGENTS.md

## Scope
This file applies to `scripts`.

## Architecture
- This folder contains repository-level automation and policy scripts.
- Scripts here should be lightweight, deterministic, and runnable in local and CI contexts.

## Implementation Guidance
- Prefer Node built-ins for repo policy checks so scripts run without install-time coupling.
- Keep script inputs explicit and make failure messages actionable.
- Repository policy scripts should explain how to fix violations, not just fail.
- AGENTS policy checks should ignore non-source build, test report, and artifact folders instead of requiring scoped policy files there.
