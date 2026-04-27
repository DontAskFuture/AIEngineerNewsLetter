# AGENTS.md

## Scope
This file applies to `packages/shared` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package contains cross-app constants, source registry seeds, shared types, URL helpers, and shared prompt rendering.
- It should stay small and dependency-light; templating dependencies are acceptable only for shared runtime contracts such as prompts.

## Implementation Guidance
- Put durable shared contracts here.
- Avoid adding app runtime dependencies or database access.
- Seed data changes should stay easy to audit and review.
- Keep LLM prompt templates here when both web and worker code need the same behavior.
