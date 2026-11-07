# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed/unsubscribe`.

## Architecture
- `route.ts` handles public one-click newsletter unsubscriptions (`GET` and `POST /feed/unsubscribe?token=...`) via `unsubscribeFromNewsletterByToken` in `@/lib/newsletter-subscribers`, then redirects to `/feed?window=week&newsletter=unsubscribed`.

## Implementation Guidance
- Keep token validation and DB updates in `@/lib/newsletter-subscribers`.
- Redirect back to `/feed?window=week&newsletter=unsubscribed` without leaking subscriber state on invalid tokens.
