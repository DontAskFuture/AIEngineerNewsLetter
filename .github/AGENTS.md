# AGENTS.md

## Scope
This file applies to `.github` and its subdirectories unless a deeper file overrides it.

## Architecture
- This folder contains GitHub-side automation for repository policy and validation.
- Workflows here should reflect the same rules enforced locally where practical.

## Implementation Guidance
- Keep workflows focused, readable, and deterministic.
- Prefer reusing repo scripts from CI instead of duplicating policy logic in YAML.

