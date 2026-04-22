# AGENTS.md

## Scope
This file applies to `packages/shared` and its subdirectories unless a deeper file overrides it.

## Architecture
- This package contains cross-app constants, source registry seeds, shared types, and URL helpers.
- It should stay small and dependency-light.

## Implementation Guidance
- Put durable shared contracts here.
- Avoid adding app runtime dependencies or database access.
- Seed data changes should stay easy to audit and review.

