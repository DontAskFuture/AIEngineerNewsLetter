# AGENTS.md

## Scope
This file applies to `.githooks`.

## Architecture
- `pre-commit` runs `node scripts/check-agents.mjs --staged` to enforce the AGENTS.md policy locally before a commit is created.
- Git does not use this directory automatically; each clone must opt in.

## Implementation Guidance
- README documents the one-time setup: `git config core.hooksPath .githooks`. Keep that instruction accurate if the hooks path or hook names change.
- Keep hook scripts POSIX `sh` and delegate real logic to `scripts/*.mjs`, matching the CI workflow in `.github/workflows/agents-policy.yml`.
