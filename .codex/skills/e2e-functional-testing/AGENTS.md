# AGENTS.md

## Scope
This file applies to `.codex/skills/e2e-functional-testing` and its subdirectories unless a deeper file overrides it.

## Architecture
- `SKILL.md` defines the Playwright frontend E2E smoke-testing skill: workflow, smoke matrix template, and Playwright patterns.
- `agents/openai.yaml` declares Codex-facing interface metadata (display name, default prompt, implicit-invocation policy).
- `references/ai-engineer-newsletter.md` holds this repo's specific routes, Docker assumptions, credential variables, and smoke-flow checklist.

## Implementation Guidance
- Keep `SKILL.md` generic and reusable; put repo-specific facts only in `references/ai-engineer-newsletter.md`.
- Update the reference file whenever `apps/web` routes, env var names, or smoke flows change so the skill stays accurate.
