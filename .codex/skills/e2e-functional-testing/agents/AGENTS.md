# AGENTS.md

## Scope
This file applies to `.codex/skills/e2e-functional-testing/agents`.

## Architecture
- `openai.yaml` declares Codex-facing interface metadata for this skill: display name, short description, default prompt, and implicit-invocation policy.

## Implementation Guidance
- Keep `default_prompt` aligned with the bare-invocation behavior described in the parent `SKILL.md`.
- This file configures how Codex surfaces the skill, not the skill's testing logic itself.
