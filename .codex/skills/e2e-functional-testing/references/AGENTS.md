# AGENTS.md

## Scope
This file applies to `.codex/skills/e2e-functional-testing/references`.

## Architecture
- `ai-engineer-newsletter.md` is the project-specific reference for this repo: routes, Docker/localhost runtime assumptions, `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` credential variables, and the default smoke-flow checklist.

## Implementation Guidance
- Keep routes, env var names, and flows here in sync with `apps/web`.
- Reference credential variable names only; never write actual secret values into this file.
