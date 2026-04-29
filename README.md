# AI Builder Intelligence Platform

Phase 0 scaffolds a TypeScript monorepo for a curated-source intelligence product:

- `apps/web`: Next.js dashboard shell
- `apps/worker`: ingestion and fetch worker
- `packages/db`: Drizzle schema and database helpers
- `packages/shared`: source definitions and shared utilities

## Docker quick start

1. Build and start the full stack with `docker compose up --build`.
2. Open `http://localhost:3000`.
3. The compose stack starts `postgres`, runs migrations plus source seeding once, then starts `web` and `worker`.
4. Stop everything with `docker compose down`.

## Cloudflare Tunnel

Use the optional `cloudflared` Compose profile when you want a stable public DNS name without opening inbound port `3000`.

1. In Cloudflare Zero Trust, create a Cloudflare Tunnel.
2. Choose the Docker connector and copy the tunnel token into `.env`:
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN=your-token-here
   ```
3. Add a public hostname for the tunnel, such as `news.example.com`.
4. Point that hostname's service to the Compose web service:
   ```text
   http://web:3000
   ```
5. Set `APP_BASE_URL` to the public URL so generated links and OpenRouter referer headers use the public hostname:
   ```bash
   APP_BASE_URL=https://news.example.com
   ```
6. Start the stack with the tunnel profile:
   ```bash
   docker compose --profile tunnel up --build -d
   ```

The web service still binds to `127.0.0.1:3000` for local browser access, while Cloudflare reaches it privately over the Docker network through `cloudflared`. Do not publish router/firewall inbound access to port `3000`; the only public entrypoint should be Cloudflare.

## Local development

1. Copy `.env.example` to `.env`.
2. Start Postgres with `docker compose up -d postgres`.
3. Install dependencies with `corepack pnpm install`.
4. Generate SQL migrations with `corepack pnpm db:generate`.
5. Apply migrations with `corepack pnpm db:migrate`.
6. Seed the source registry with `corepack pnpm seed:sources`.
7. Run the web app with `corepack pnpm dev:web`.
8. Run the worker with `corepack pnpm dev:worker`.

## Useful commands

- `corepack pnpm typecheck`
- `corepack pnpm lint`
- `corepack pnpm check:agents -- --staged`
- `corepack pnpm fetch:once`

## Notes

- Raw fetch payloads are stored under `var/raw` locally and in the `raw_data` Docker volume when running through Compose.
- The source registry is seeded from `packages/shared/src/default-sources.ts`.
- Local Git enforcement for `AGENTS.md` updates lives in `.githooks/pre-commit`. Run `git config core.hooksPath .githooks` once per clone to enable it.
- CI enforcement lives in `.github/workflows/agents-policy.yml`.
- The app now uses a lightweight email and password login flow backed by Postgres sessions.
- `AUTH_ALLOWED_EMAILS` controls who can create or access an account. It defaults to `lianglingfan@gmail.com`.
- Passwords are stored as salted hashes, not plain text.
- Add `OPENROUTER_API_KEY` to enable personalized feed ranking with OpenRouter Responses and `openai/gpt-5.4-mini`.
- The personalized shortlist uses each profile's plain-English interest statement plus the title and first paragraph from today's documents.
- The product and roadmap docs live in `docs/feature-and-implementation-plan.md`.
- Docker uses the multi-stage [Dockerfile](/Users/autumn/src/AIEngineerNewsLetter/Dockerfile) and named volumes for Postgres data plus raw fetch storage.
