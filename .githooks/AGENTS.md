# AGENTS.md

## Scope
This file applies to `.githooks`.

## Architecture
- This folder contains local Git hook entrypoints for repository policy enforcement.
- Hooks are local developer guardrails and should stay fast.

## Implementation Guidance
- Keep hooks thin and delegate real logic to versioned repo scripts.
- Hooks should fail loudly on policy violations and avoid hidden side effects.
- Do not embed large amounts of business logic directly in shell hooks.

