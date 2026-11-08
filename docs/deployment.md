# Deploying to an Oracle Cloud VM

This is the step-by-step runbook for standing up the stack on a fresh Oracle
Cloud Infrastructure (OCI) VM, and for pushing code updates to it afterward.
It assumes the findings in
[`oracle-cloud-deployment-readiness.md`](./oracle-cloud-deployment-readiness.md):
use an **Ampere A1 (arm64)** shape, not the 1 GB `E2.1.Micro` shape, which
cannot hold the worker's crawl-time memory peaks.

## 1. Provision the VM

1. In OCI, create a `VM.Standard.A1.Flex` instance at **exactly 2 OCPU and
   12 GB RAM**. That is the entire Always Free Ampere allotment (1,500
   OCPU-hours and 9,000 GB-hours per month). The measured stack peaks around
   2 GB, so 12 GB fits. Allocating more than 2 OCPU or 12 GB leaves Always
   Free and bills on a Pay As You Go account. Create it in the tenancy home
   region. Use the **Canonical Ubuntu 24.04 (aarch64)** image. Prefer it over Oracle
   Linux here: it's RHEL-based and adds `firewalld`/SELinux friction with
   Docker that buys nothing for this stack, since Cloudflare Tunnel is the
   only ingress path. Ubuntu also matches the Docker install command in
   step 2 with no adjustment.
2. Attach a boot volume of at least 50 GB. No extra Block Volume is required
   unless you plan to raise `CRAWLED_DOCUMENT_TTL_DAYS` well beyond 30.
3. Skip inbound Security List / NSG rules beyond SSH (port 22). Cloudflare
   Tunnel dials out from the VM, so port 3000 never needs to be exposed.
4. Note the VM's public IP and confirm you can `ssh` into it with your key. If
   the instance was created without a Public IPv4 address, open the instance's
   **Networking -> Primary VNIC -> IPv4 Addresses** tab in the OCI Console,
   click `⋮ -> Edit` on the private IP row, and attach an **Ephemeral public IP**
   (which persists across reboots and stop/start cycles in OCI) or a **Reserved
   public IP**.

## 2. Install Docker on the VM

SSH in and install Docker Engine plus the Compose plugin.

**Ubuntu 24.04 (`ubuntu@<vm-ip>`):**

```bash
ssh ubuntu@<vm-ip>

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# log out and back in for the group change to take effect
```

**Oracle Linux 9 (`opc@<vm-ip>`):**

```bash
ssh opc@<vm-ip>

sudo dnf install -y git dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
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
| `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM_EMAIL` | Required for the daily newsletter send. Defaults to Gmail submission on port 587. |

## 5. Set up the Cloudflare Tunnel

Follow the [README's Cloudflare Tunnel section](../README.md#cloudflare-tunnel):

```bash
mkdir -p .secrets
printf '%s\n' 'your-tunnel-token-here' > .secrets/cloudflare_tunnel_token
chmod 644 .secrets/cloudflare_tunnel_token
# On Oracle Linux / SELinux hosts, label .secrets so cloudflared can read the mounted secret:
chcon -Rt svirt_sandbox_file_t .secrets || true
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

## 10. 5-Minute Health Watchdog, Daily DB Backups & Email Alerts

`pnpm ops setup-watchdog` installs two `systemd` timers on the VM:

### A. 5-Minute Health Watchdog (`tunnel-watchdog.timer` -> [`scripts/vm-watchdog.sh`](../scripts/vm-watchdog.sh))
1. Checks `ai-intel-postgres` health (`healthy`), `aiengineernewsletter-worker-1`
   status (`running`), local web + database readiness
   (`http://127.0.0.1:3000/api/health`), and end-to-end public Cloudflare Tunnel
   reachability (`${APP_BASE_URL}/api/health`).
2. Automatically restarts `cloudflared` if only the public tunnel is unreachable,
   or runs `docker compose --profile tunnel up -d` / restarts `web` +
   `cloudflared` if a core service is unhealthy.
3. Prunes Docker build cache (`docker builder prune -af`) if `/` disk usage
   reaches `>= 85%`.
4. Sends an alert email over SMTP (using `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `ADMIN_EMAILS` from `.env`, with a
   30-minute cooldown) whenever auto-recovery runs.

### B. Daily Postgres Backup (`db-backup.timer` -> [`scripts/vm-backup-db.sh`](../scripts/vm-backup-db.sh))
1. Runs daily at `03:30 UTC` (`pg_dump -Fc` inside `ai-intel-postgres`).
2. Writes atomically to `/var/oled/backups/ai_intel-YYYY-MM-DD.dump` (using the
   separate `/var/oled` logical volume on Oracle Linux, or `var/backups`
   elsewhere) and prunes archives older than 7 days.
3. Sends an SMTP alert email if a backup fails.

Install or update both timers on the VM from your local machine:

```bash
pnpm ops setup-watchdog --host opc@<vm-ip> --path /home/opc/AIEngineerNewsLetter
```

Check timer schedules or logs on the VM:

```bash
ssh opc@<vm-ip> 'systemctl list-timers tunnel-watchdog.timer db-backup.timer'
ssh opc@<vm-ip> 'sudo journalctl -u tunnel-watchdog.service -u db-backup.service -n 50 --no-pager'
```

## 11. Expanding the OCI Boot Volume Online

Oracle Always Free includes up to **200 GB** of block/boot storage. If you resize
the Boot Volume in the OCI Console (**Instance -> Boot volume -> View boot volume
details -> Edit -> Volume Size (in GB)**), apply the new size online without
rebooting:

```bash
ssh opc@<vm-ip> 'echo 1 | sudo tee /sys/class/block/sda/device/rescan && sudo /usr/libexec/oci-growfs -y && df -h /'
```
