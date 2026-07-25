# AGENTS.md

## Scope
This file applies to `.codex` and its subdirectories unless a deeper file overrides it.

## Architecture
- Holds Codex CLI skills for this project, separate from any Claude Code skill mechanism.
- Currently defines one skill: `skills/e2e-functional-testing`.

## Implementation Guidance
- Add new Codex skills as their own subdirectory under `skills/` with a `SKILL.md` entrypoint.
- Keep skill content in sync with actual repo routes, env vars, and workflows when they change.
