# AGENTS.md

## Scope
This file applies to `.github/workflows`.

## Architecture
- This folder contains GitHub Actions workflows.
- Workflows act as the remote enforcement and validation layer for the repo.

## Implementation Guidance
- Prefer small workflows that call checked-in scripts.
- Keep triggers and branch policies explicit.
- CI policy checks should mirror local hooks when possible so failures are predictable.
