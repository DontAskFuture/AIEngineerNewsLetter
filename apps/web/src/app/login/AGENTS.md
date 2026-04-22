# AGENTS.md

## Scope
This file applies to `apps/web/src/app/login`.

## Architecture
- This route is the authentication entrypoint for the product.
- It renders the email and password form and explains the current allowlist policy.

## Implementation Guidance
- Keep login presentation here.
- Authentication rules, hashing, sessions, and allowlist behavior belong in `../../lib/auth`.
- Do not add database logic directly to the page.

