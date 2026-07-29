# AGENTS.md

## Scope
This file applies to `scripts`.

## Architecture
- This folder contains repository-level automation and policy scripts.
- Scripts here should be lightweight, deterministic, and runnable in local and CI contexts.
- `server.mjs` is the local operations CLI for Docker Compose lifecycle, service logs, crawl/scoring job visibility, and remote deploys.

## Implementation Guidance
- Prefer Node built-ins for repo policy checks so scripts run without install-time coupling.
- Prefer Node built-ins for local operations CLIs too; shell out to Docker Compose, psql, git, or ssh rather than introducing CLI framework dependencies.
- Keep script inputs explicit and make failure messages actionable.
- Repository policy scripts should explain how to fix violations, not just fail.
- AGENTS policy checks should ignore non-source build, test report, and artifact folders instead of requiring scoped policy files there.
- `pnpm ops deploy` shells out to `ssh` and runs a fast-forward-only `git merge` on the remote before rebuilding Compose; it deliberately refuses to deploy if the remote has diverged (e.g. local edits on the VM) rather than force-resetting it. Target host/path come from `DEPLOY_SSH_HOST`/`DEPLOY_SSH_PATH` env vars or `--host`/`--path` flags — see `docs/deployment.md` for the full runbook.
- `pnpm ops db-dump` runs `pg_dump -Fc` inside the local `postgres` container and writes the archive to a local file (default `var/backups/ai_intel-<timestamp>.dump`, already covered by the repo-wide `var` gitignore entry). `pnpm ops db-restore` copies that file to a remote host over `scp`, starts (or reuses) the remote `postgres` container with `docker compose up -d --wait`, and runs `pg_restore --clean --if-exists` inside it. This is a one-time first-setup step for carrying existing local data to a fresh VM, not part of the regular `pnpm ops deploy` flow, and it overwrites whatever is in the target database.
