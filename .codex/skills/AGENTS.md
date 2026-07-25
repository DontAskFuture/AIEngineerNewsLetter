# AGENTS.md

## Scope
This file applies to `.codex/skills` and its subdirectories unless a deeper file overrides it.

## Architecture
- Each subdirectory is one Codex skill with a `SKILL.md` entrypoint.
- `e2e-functional-testing` is the only skill defined here today: Playwright-based frontend E2E smoke testing.

## Implementation Guidance
- New skills need a `SKILL.md` with `name`/`description` frontmatter.
- Keep repo-specific facts (routes, credentials, flows) in a skill's `references/` subdirectory rather than inline in `SKILL.md`, so `SKILL.md` stays generic and reusable.
