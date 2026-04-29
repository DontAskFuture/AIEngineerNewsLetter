# AGENTS.md

## Scope
This file applies to `apps/web` and its subdirectories unless a deeper file overrides it.

## Architecture
- This is a Next.js App Router application.
- It is server-first: pages fetch live data from Postgres and server actions mutate state.
- Authentication and session checks happen on the server before protected pages render.
- Public deployments define baseline security headers in `next.config.ts`.

## Implementation Guidance
- Put route files under `src/app` and reusable server logic under `src/lib`.
- Keep security headers compatible with the Next app shell and public Cloudflare Tunnel hosting.
- Prefer server components unless interactivity clearly requires a client component.
- Keep auth, DB reads, and external API calls on the server.
- UI should compose existing data helpers rather than duplicating SQL in page files.
