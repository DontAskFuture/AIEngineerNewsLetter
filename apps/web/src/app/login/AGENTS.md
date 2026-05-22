# AGENTS.md

## Scope
This file applies to `apps/web/src/app/login`.

## Architecture
- This route is the authentication entrypoint for the product.
- It renders the email and password form and explains the current allowlist policy.

## Implementation Guidance
- Keep login presentation here.
- Signed-in visitors who land on login should redirect to a safe `next` path when provided, otherwise `/feed?window=week`.
- Login accepts `?next=/read-list?...` so middleware-blocked read-list visits return after sign-in.
- Keep brute-force feedback generic and route lockout behavior through `../../lib/auth`.
- Authentication rules, hashing, sessions, and allowlist behavior belong in `../../lib/auth`.
- Do not add database logic directly to the page.
- Hide signup links while signup is invite-gated.
- The auth shell should stay theme-aware and keep the access policy explanation legible in both light and dark mode.
