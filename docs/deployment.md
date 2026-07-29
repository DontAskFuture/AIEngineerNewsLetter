# Deploying to an Oracle Cloud VM

This is the step-by-step runbook for standing up the stack on a fresh Oracle
Cloud Infrastructure (OCI) VM, and for pushing code updates to it afterward.
It assumes the findings in
[`oracle-cloud-deployment-readiness.md`](./oracle-cloud-deployment-readiness.md):
use an **Ampere A1 (arm64)** shape, not the 1 GB `E2.1.Micro` shape, which
cannot hold the worker's crawl-time memory peaks.

## 1. Provision the VM

1. In OCI, create a `VM.Standard.A1.Flex` instance (2+ OCPU / 12+ GB RAM is a
   comfortable starting point; see §7 of the readiness doc for sizing).
   Use the **Canonical Ubuntu 24.04 (aarch64)** image. Prefer it over Oracle
   Linux here: it's RHEL-based and adds `firewalld`/SELinux friction with
   Docker that buys nothing for this stack, since Cloudflare Tunnel is the
   only ingress path. Ubuntu also matches the Docker install command in
   step 2 with no adjustment.
2. Attach a boot volume of at least 50 GB. No extra Block Volume is required
   unless you plan to raise `CRAWLED_DOCUMENT_TTL_DAYS` well beyond 30.
3. Skip inbound Security List / NSG rules beyond SSH (port 22). Cloudflare
   Tunnel dials out from the VM, so port 3000 never needs to be exposed.
4. Note the VM's public IP and confirm you can `ssh` into it with your key.

## 2. Install Docker on the VM

SSH in and install Docker Engine plus the Compose plugin:

```bash
ssh ubuntu@<vm-ip>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in for the group change to take effect
```

Verify:

```bash
docker --version
docker compose version
```

## 3. Clone the repo on the VM

```bash
git clone https://github.com/DontAskFuture/AIEngineerNewsLetter.git
cd AIEngineerNewsLetter
```

This path (`~/AIEngineerNewsLetter`) is the default `pnpm ops deploy` and
`pnpm ops db-restore` expect later. If you clone somewhere else, pass
`--path` (or set `DEPLOY_SSH_PATH`) in those later steps.

## 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

| Variable | Guidance |
|---|---|
| `POSTGRES_PASSWORD` | Fresh, long, random — do not reuse the example value. |
| `DATABASE_URL` | Update the password to match. |
| `AUTH_ALLOWED_EMAILS` | Your real email(s); do not rely on the committed default. |
| `ADMIN_EMAILS` | Your real email(s). |
| `APP_BASE_URL` | `https://<your-tunnel-hostname>` once step 5 is set up. |
| `CRAWLED_DOCUMENT_TTL_DAYS` | Keep at 30 unless `raw_data` is on a volume sized for more (see readiness doc §4.3). |
| `OPENROUTER_API_KEY` | Required for scoring and briefings. |
| `SENDPULSE_CLIENT_ID` / `SENDPULSE_CLIENT_SECRET` / `SENDPULSE_FROM_EMAIL` | Required for the daily newsletter send. |

## 5. Set up the Cloudflare Tunnel

Follow the [README's Cloudflare Tunnel section](../README.md#cloudflare-tunnel):

```bash
mkdir -p .secrets
printf '%s\n' 'your-tunnel-token-here' > .secrets/cloudflare_tunnel_token
chmod 600 .secrets/cloudflare_tunnel_token
```

Point the tunnel's public hostname at `http://web:3000` in Cloudflare Zero
Trust, and set `APP_BASE_URL` in `.env` to that hostname.

## 6. (Optional) Migrate existing local data

The VM starts with an empty database: `migrate` only creates schema and
reseeds the source registry, it does not carry over your local documents,
scores, or accounts. If you have local data worth keeping, move it over
**before** step 7, from your local machine:

```bash
pnpm ops db-dump
```

This runs `pg_dump -Fc` inside your local `postgres` container and writes a
custom-format archive to `var/backups/ai_intel-<timestamp>.dump` (pass
`--file path` to choose a different location). Then, with the VM cloned and
`.env` in place from steps 3–4:

```bash
pnpm ops db-restore --host ubuntu@<vm-ip> --file var/backups/ai_intel-<timestamp>.dump
```

This copies the dump to the VM over `scp`, starts (or reuses) the VM's
`postgres` container, and runs `pg_restore --clean --if-exists --no-owner`
inside it. **This overwrites whatever is already in the target database** —
only run it against a fresh VM or one you intend to reset. It intentionally
does not start `web`/`worker`/`migrate` itself; run step 7 right after so
`migrate` reconciles the restored schema against current migrations (a
no-op if the dump already matches) and reseeds the source registry.

## 7. First deploy

```bash
docker compose --profile tunnel up --build -d
docker compose --profile tunnel ps
```

`migrate` runs schema migrations and source seeding once, then exits
successfully; `postgres`, `web`, `worker`, and `cloudflared` should all show
`running`. Confirm the site loads at your tunnel hostname.

## 8. Deploying updates

From your local machine, `pnpm ops deploy` SSHes into the VM, fast-forwards
the repo to the latest commit on the target branch, rebuilds, and restarts
the stack:

```bash
DEPLOY_SSH_HOST=ubuntu@<vm-ip> pnpm ops deploy
```

or, without an env var:

```bash
pnpm ops deploy --host ubuntu@<vm-ip> --path ~/AIEngineerNewsLetter --branch main
```

This runs, on the VM:

```bash
cd <path>
git fetch origin <branch>
git checkout <branch>
git merge --ff-only origin/<branch>
docker compose --profile tunnel up --build -d
docker compose --profile tunnel ps
```

The `--ff-only` merge is deliberate: if the VM's clone has diverged (for
example, someone edited `.env`-adjacent files directly on the box, or a
previous deploy left an uncommitted change), the command fails loudly rather
than silently discarding VM-side state. Resolve the divergence over `ssh`
first, then re-run `pnpm ops deploy`.

`docker compose up --build -d` only recreates containers whose image or
config actually changed, so this is safe to run for every update — including
ones that only touch one of `web` or `worker`. Database migrations run
automatically via the `migrate` service on every deploy, since Compose
always re-runs `migrate` before `web`/`worker` start and migrations are
idempotent.

### Watching a deploy

```bash
ssh ubuntu@<vm-ip> 'cd ~/AIEngineerNewsLetter && docker compose --profile tunnel logs -f web worker migrate'
```

Or once you're on the box, use the same `pnpm ops logs` / `pnpm ops job-logs`
commands documented in [`scripts/AGENTS.md`](../scripts/AGENTS.md) and the
root `README.md`.

## 9. Rolling back

If a deploy breaks something, roll back to the previous commit on the VM
directly (this bypasses the fast-forward guard by design, since a rollback
is an intentional history move):

```bash
ssh ubuntu@<vm-ip>
cd ~/AIEngineerNewsLetter
git log --oneline -5
git checkout <previous-good-commit>
docker compose --profile tunnel up --build -d
```

Return to the branch tip (`git checkout main`) once a fix is ready, then
resume using `pnpm ops deploy` as normal.

## 10. Known gaps

See §5 of
[`oracle-cloud-deployment-readiness.md`](./oracle-cloud-deployment-readiness.md)
for what this setup does not yet cover: no `/api/health`-based healthchecks
on `web`/`worker`, no container memory limits, and no automated Postgres
backup. None of these block a first deploy, but plan to address the backup
gap before trusting the VM with data you can't afford to lose.
