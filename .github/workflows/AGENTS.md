# AGENTS.md

## Scope
This file applies to `.github/workflows`.

## Architecture
- `agents-policy.yml` runs on every pull request and on pushes to `main`.
- It checks out full history (`fetch-depth: 0`), installs Node 22, and runs `node scripts/check-agents.mjs --base <base-sha>` (the PR base SHA, or `github.event.before` on push) to enforce that code/config changes update their nearest scoped `AGENTS.md`.

## Implementation Guidance
- Keep the actual policy logic in `scripts/check-agents.mjs`, not inline in YAML.
- Use `fetch-depth: 0` for any workflow that diffs against a base ref, or the diff will be incomplete.
- Keep the Node version pinned here in sync with the `engines.node` constraint in the root `package.json`.
