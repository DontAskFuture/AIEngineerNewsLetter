# AGENTS.md

## Scope
This file applies to `apps/web/src/app/out` and its subdirectories unless a deeper file overrides it.

## Architecture
- This route family handles outbound story clicks.
- It records per-user read state for signed-in users before redirecting the browser to the external canonical URL.

## Implementation Guidance
- Keep redirect handlers thin and push persistence into `../../lib/read-tracking`.
- Route handlers here should use authenticated user context when available and avoid trusting arbitrary external URLs from the request.
