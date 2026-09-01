# AGENTS.md

## Scope
This file applies to `packages/shared` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package contains cross-app constants, source registry seeds, shared types, URL helpers, shared prompt rendering, shared scoring configuration, and the shared OpenRouter retry policy.
- It should stay small and dependency-light; templating dependencies are acceptable only for shared runtime contracts such as prompts.

## Implementation Guidance
- Put durable shared contracts here.
- Avoid adding app runtime dependencies or database access.
- Seed data changes should stay easy to audit and review.
- Keep LLM prompt templates here when both web and worker code need the same behavior.
- Keep scoring knobs here when both web-triggered and worker-triggered scoring must match.
- This package hosts the repo's unit tests: `pnpm test` (root) fans out to `pnpm --filter @ai-intel/shared test`, which runs `tsx --test "src/**/*.test.ts"` on the built-in Node test runner. Co-locate a `*.test.ts` beside the module it covers, and keep tested logic pure so no runner beyond `tsx` is needed.
