# AGENTS.md

## Scope
This file applies to `apps/web/src/app/feed/unsubscribe`.

## Architecture
- `route.ts` handles public one-click newsletter unsubscriptions (`GET` and `POST /feed/unsubscribe?token=...`) via `unsubscribeFromNewsletterByToken` in `@/lib/newsletter-subscribers`: `GET` redirects browsers to `/feed?window=week&newsletter=unsubscribed`, while `POST` returns a direct `200 OK` response for RFC 8058 (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) mail clients.

## Implementation Guidance
- Keep token validation and DB updates in `@/lib/newsletter-subscribers`.
- Redirect back to `/feed?window=week&newsletter=unsubscribed` without leaking subscriber state on invalid tokens.
