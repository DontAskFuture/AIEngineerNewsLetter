# AGENTS.md

## Scope
This file applies to `.github` and its subdirectories unless a deeper file overrides it.

## Architecture
- Holds GitHub-specific automation configuration.
- Currently contains only `workflows/`, with a single CI workflow (`agents-policy.yml`) enforcing the AGENTS.md policy.

## Implementation Guidance
- Keep workflow YAML thin; push real logic into `scripts/*.mjs` so it runs identically locally and in CI.
- New automation should be added as additional workflow files rather than growing an existing one with unrelated jobs.
