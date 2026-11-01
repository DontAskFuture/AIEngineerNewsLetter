# Oracle Cloud VM Deployment Readiness

**Assessed:** 2026-07-25
**Target:** single Oracle Cloud Infrastructure (OCI) compute VM running the full Compose stack
**Verdict:** the three P0 blockers are **resolved in-repo as of 2026-07-25** (§4). Remaining work before a production-grade deploy is P1 (§5), none of which blocks a first deploy.

---

## 1. Method

Findings below were verified against the repository, not inferred:

- Built the web image on this machine (`docker build --target web`). Build succeeds; all 9 routes compile as dynamic (`ƒ`).
- Measured image size and layer breakdown via `docker images` / `docker history`.
- Read `docker-compose.yml`, `Dockerfile`, `.dockerignore`, `.gitignore`, `.env.example`, `apps/worker/src/env.ts`, and the cleanup/storage job source.
- Confirmed secret hygiene with `git ls-files`.
- Measured worker memory by running real JSDOM + Readability parses against live pages from the source registry, sampling `process.memoryUsage()` around each parse (§7.1).
- Measured Next.js cold production build peak with `/usr/bin/time -l` after removing `.next`.

Every claim cites a file and line where one applies. Memory and build figures are measurements on this workstation, not estimates — see §7.5 for how they transfer to Ampere hardware.

---

## 2. What is already sound

Do not spend effort re-checking these.

| Area | Status | Evidence |
|---|---|---|
| Docker build | Succeeds on arm64 | `docker build --target web` completed |
| Build-time DB dependency | **None** — every route is `force-dynamic`, so `next build` needs no `DATABASE_URL` | Build output: all 9 routes marked `ƒ` |
| Secret hygiene | `.env` and `.secrets/` are untracked; only `.env.example` is committed | `git ls-files` |
| Inbound network surface | **Zero ports required.** Cloudflare Tunnel is the only ingress; Postgres and web bind to `127.0.0.1` | `docker-compose.yml:18,73` |
| Outbound email | Authenticated SMTP submission on port 587, so OCI's default port-25 block does not apply | `apps/worker/src/services/smtp.ts` |
| Tunnel token handling | Mounted from an ignored local file via Compose `secrets`, not interpolated into the command | `docker-compose.yml:82-84,129-130` |

---

## 3. Ranked fix list

Ranked by deployment risk. "Effort" is relative implementation cost.

| # | Priority | Finding | Effort | Blocks deploy? |
|---|---|---|---|---|
| 1 | ~~P0~~ **DONE** | Postgres has no `restart:` policy | Trivial | Fixed 2026-07-25 |
| 2 | ~~P0~~ **DONE** | Docker logs are unbounded (no rotation) | Trivial | Fixed 2026-07-25 |
| 3 | ~~P0~~ **DONE** | Raw payload TTL defaults to 365 days; fills boot volume | Trivial | Fixed 2026-07-25 |
| 4 | P1 | No healthchecks on `web` / `worker` | Small | No |
| 5 | P1 | No memory limits; worker can OOM the host | Small | No |
| 6 | P1 | No Postgres backup | Small | No |
| 7 | P1 | Personal email hardcoded as Compose default | Trivial | No |
| 8 | P1 | `cloudflare/cloudflared:latest` unpinned | Trivial | No |
| 9 | P2 | Three env vars silently ignored under Docker | Trivial | No |
| 10 | P2 | Raw-file cleanup can delete payloads still referenced | Small | No |
| 11 | P3 | Images carry devDependencies (1.14 GB) | Medium | No |
| 12 | P3 | `web` sets `RAW_STORAGE_DIR` with no matching volume | Trivial | No |
| 13 | P3 | README documents localhost only, no VM runbook | Small | No |

---

## 4. Blockers (P0) — RESOLVED 2026-07-25

### 4.1 Postgres has no restart policy

**Evidence:** `docker-compose.yml` — the `postgres` service originally had no `restart:` key, while `migrate` was `restart: "no"`, `web` and `worker` `unless-stopped`, and `cloudflared` `always`. Postgres is the only long-lived service without one, so it defaults to `no`.

**Impact:** on any VM reboot — including OCI's scheduled maintenance reboots — Postgres does not come back. `web` and `worker` *do* come back and crash-loop against a missing database indefinitely. The stack appears "running" in `docker ps` while serving nothing. This is the most likely way the deployment dies silently.

**Fix applied:** `restart: unless-stopped` added to `postgres` (`docker-compose.yml:28`). Verified via `docker compose config`: postgres/web/worker are `unless-stopped`, cloudflared `always`, and the one-shot `migrate` correctly remains `no`.

### 4.2 Unbounded Docker logs

**Evidence:** no `logging:` key anywhere in `docker-compose.yml`.

**Impact:** Docker's default `json-file` driver never rotates. The worker logs per-fetch operational detail across 90 sources at hourly cadence with `LOG_LEVEL: info`. Log growth is slow but monotonic, and when the boot volume fills, Postgres fails writes and the whole stack goes down. Failure mode is delayed and hard to diagnose.

**Fix applied:** an `x-logging` anchor (`docker-compose.yml:3-7`) is now applied to all five services via `logging: *logging`. Caps each at 30 MB (10 MB x 3 files). Verified per-service through `docker compose --profile tunnel config`.

```yaml
x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

### 4.3 Raw payload storage exhausts the boot volume

**Evidence:** `CRAWLED_DOCUMENT_TTL_DAYS` defaults to **365**, which is also the schema maximum (`apps/worker/src/env.ts:27`). The VM `.env` does not set this key, so 365 is inherited. Payloads are written on every fetch (`apps/worker/src/storage/local-raw-store.ts:21-34`).

**Impact:** 90 endpoints at hourly cadence is ~2,160 payload writes/day. Storage keys are content-hash derived, so unchanged feeds overwrite in place — but feeds change constantly, and observed bodies range from ~600 B to 6.3 MB. Realistic growth is **8–12 GB/month**. A default 50 GB OCI boot volume (~46.6 GB usable) fills in roughly **four months**, taking Postgres down with it.

**Fix applied:** the Compose default dropped from 365 to **30** for both `web` and `worker` (`docker-compose.yml:58,103`), so a fresh VM is safe without anyone remembering to set the variable. `.env.example` updated to 30 with a sizing note.

**Destructive-change note:** lowering this default is not inert. The local development stack held **28,247 of 36,104 documents older than 30 days** (corpus back to 2026-04-22) and did not set the variable, so the new default would have pruned 78% of it on the next cleanup run. The local `.env` was therefore pinned to `CRAWLED_DOCUMENT_TTL_DAYS=365` to preserve that history. Any other existing deployment relying on the old default needs the same pin before pulling this change.

The worker's own schema default (`apps/worker/src/env.ts:27`) remains 365 and was deliberately left alone, since changing it would silently prune data for non-Compose runs. If long retention is genuinely wanted on the VM, attach a separate Block Volume for `raw_data` rather than raising the TTL on the boot disk.

---

## 5. High priority (P1) — fix soon after deploy

### 5.1 No healthchecks on web or worker
`postgres` has a healthcheck (`docker-compose.yml:21-25`); `web` and `worker` do not. `restart: unless-stopped` only reacts to process *exit*. A hung Next.js server or a worker blocked on a socket stays "up" indefinitely. Requires adding a `/api/health` route to the web app — one does not exist today.

### 5.2 No memory limits
No `deploy.resources` anywhere. The worker runs `FETCH_WORKER_CONCURRENCY=5` fetch workers, each fanning out to `HTML_ARTICLE_FETCH_CONCURRENCY = 4` article fetches (`apps/worker/src/jobs/fetch-source-endpoint.ts:22`), with `MAX_ENDPOINT_RESPONSE_BYTES = 15 MB` and `MAX_ARTICLE_RESPONSE_BYTES = 5 MB` (lines 17-18), all fed through JSDOM + Readability. JSDOM inflates a document **28–39×** its HTML size (measured, §7.1), and one configured source (Pinecone) returns 6.2 MB of HTML — a single parse of it costs 177 MB. An unbounded spike OOMs the host and takes Postgres with it.

**Sizing consequence:** measured at 173 MB baseline with ~1 GB peaks under default concurrency. This stack will **not** fit the 1 GB Always Free `E2.1.Micro` shape. Use an Ampere A1 shape. See §7 for the measurements.

### 5.3 No Postgres backup
`postgres_data` is a bare named volume with no dump schedule and no snapshot policy. Total data loss on volume corruption or accidental `docker compose down -v`.

### 5.4 Personal email hardcoded as Compose default
`AUTH_ALLOWED_EMAILS` and `ADMIN_EMAILS` both default to a personal address (`docker-compose.yml:68-69`). Set both explicitly in the VM `.env` rather than depending on a committed default.

### 5.5 Unpinned cloudflared image
`cloudflare/cloudflared:latest` (`docker-compose.yml:78`). An upstream change can break the only ingress path with no version to roll back to. Pin a release tag.

---

## 6. Nice to have (P2 / P3)

### 6.1 Env vars silently ignored under Docker (P2)
`LOG_LEVEL`, `FETCH_INTERVAL_MINUTES`, and `FETCH_WORKER_CONCURRENCY` are set as **literals** in Compose, not `${VAR:-default}` form — `docker-compose.yml:40,42` (migrate), `55,57` (web), `99,101,102` (worker). The VM `.env` can set `FETCH_INTERVAL_MINUTES` and it will have no effect in containers. These are precisely the knobs to turn down on a constrained VM, so the inconsistency is worth removing.

### 6.2 Raw-file cleanup can delete live payloads (P2)
`storageKey` is content-hash derived, so two `raw_documents` rows with identical body content share one file on disk. `cleanup-crawled-documents.ts` unlinks the file for each expiring row (lines 18-30, 52-71) without checking whether a newer, non-expired row references the same hash. Slow-moving feeds will lose payloads that live rows still point at.

**Severity:** low. Affects replay/debugging only; deletion of an already-missing file is handled gracefully. Pre-existing, not introduced by deployment.

### 6.3 Images carry devDependencies (P3)
The web image is **1.14 GB**, of which `pnpm install` is 626 MB while the actual `.next` output is only 17.7 MB. This is **not** fixable with `pnpm install --prod`: the worker runs `tsx src/index.ts` in production (`apps/worker/package.json`) and `migrate` needs `drizzle-kit`, so devDependencies are genuinely required at runtime. Layer sharing keeps total image disk near ~1.6 GB across web/worker/migrate plus Postgres and cloudflared. A real fix means precompiling the worker to JS and adopting `output: "standalone"` for Next.

### 6.4 `web` sets `RAW_STORAGE_DIR` with no volume (P3)
`docker-compose.yml:56` sets `RAW_STORAGE_DIR: /app/var/raw` on `web`, but only `worker` mounts the `raw_data` volume (line 120). Harmless today because web only enqueues jobs, but it is a trap for anyone who later adds a web-side write path.

### 6.5 No VM runbook (P3)
`README.md` documents localhost development and the tunnel setup, but there is no deploy, upgrade, or rollback procedure for a VM.

---

## 7. Does the Always Free tier fit? (measured)

**Short answer: not on the 1 GB micro shape; comfortably on Ampere A1.**

### 7.1 Measured figures

Taken on this workstation against real pages from the live source registry:

| Measurement | Result | How |
|---|---|---|
| Worker baseline RSS (tsx + jsdom loaded) | **173 MB** | `process.memoryUsage()` at startup |
| Single JSDOM + Readability parse, 6.2 MB page (Pinecone) | **+177 MB** | RSS delta around one parse |
| Same, 1.5 MB page (Cerebras) | **+59 MB** | RSS delta |
| Same, 85 KB page (METR) | **+26 MB** | RSS delta |
| Next.js cold production build peak | **758 MB** | `/usr/bin/time -l`, `.next` removed first |
| Web image size | **1.14 GB** | `docker images` |

JSDOM inflates a document roughly **28–39×** its HTML size. That is the number that drives worker sizing.

### 7.2 Worst-case worker footprint

Defaults are `FETCH_WORKER_CONCURRENCY=5`, each fanning out to `HTML_ARTICLE_FETCH_CONCURRENCY=4` — up to **20 concurrent JSDOM parses**. At a measured ~40 MB per typical parse that is ~800 MB, plus the 173 MB baseline: **~1 GB steady peak, and higher when several large pages land together.**

### 7.3 Verdict by shape

| Shape | Spec | Verdict |
|---|---|---|
| `VM.Standard.E2.1.Micro` | 1 OCPU / **1 GB** RAM, x86 | **Not viable.** The worker alone can exceed 1 GB during a crawl burst, and the 758 MB Next build would not complete alongside the OS. |
| `VM.Standard.A1.Flex` | up to 4 OCPU / **24 GB** RAM, arm64 | **Comfortable.** Steady state across postgres + web + worker + cloudflared + OS is roughly 1–1.5 GB, peaking ~2 GB. Roughly 10× headroom. |

Whole-stack estimate on A1: Postgres ~150–250 MB, web (`next start`) ~150–300 MB, worker 173 MB baseline with ~1 GB peaks, cloudflared ~30–50 MB, OS + Docker daemon ~300–500 MB.

Even a reduced A1 slice (1 OCPU / 6 GB) is sufficient. CPU is not the constraint — crawling is mostly I/O bound and 4 OCPU is ample for 90 hourly sources.

### 7.4 Storage against the free allowance

Always Free includes **200 GB total block storage** (50 GB minimum boot volume). Against the §4.3 growth rate of 8–12 GB/month:

- Default 50 GB boot volume: fills in ~4 months at the 365-day TTL. **TTL must come down** — this is blocker 4.3.
- Full 200 GB allocation: survives roughly 16 months even untuned, but a 21–30 day TTL still keeps it flat and is the better default.

### 7.5 Caveats

- These are figures for **this workstation's** CPU and Node build; Ampere cores are slower per-core, so the build takes longer (memory is comparable, and 24 GB absorbs it either way).
- Ampere A1 Always Free capacity is frequently exhausted in popular regions ("Out of host capacity"). Securing the shape may take retries or a different region — plan for this before committing to a deploy window.
- Oracle has changed Always Free terms over time. Verify current allocations against Oracle's documentation rather than treating the numbers here as contractual.

---

## 8. Architecture and shape decision

**Build on the VM.** Clone the repo and run `docker compose up --build -d` on the instance. This removes CPU-architecture mismatch as a class of failure: this workstation is `arm64`, so locally built images would match an Ampere A1 shape but fail silently on any x86 shape (E3/E4/E5).

Two constraints follow:

- The Next.js build needs roughly 2 GB RAM. Add swap if the shape is small.
- The 1 GB `E2.1.Micro` Always Free shape is **not viable** for this stack (see §5.2). The Ampere A1 Always Free allocation (up to 4 OCPU / 24 GB) is the right target.

**Networking:** no OCI Security List or NSG ingress rules are needed beyond SSH. Cloudflare Tunnel dials outbound. Do not open port 3000.

---

## 9. Execution plan

**Phase 1 — before deploy (P0).** All in `docker-compose.yml` and the VM `.env`:
1. `restart: unless-stopped` on `postgres`
2. Shared `logging:` anchor applied to every service
3. VM `.env`: `CRAWLED_DOCUMENT_TTL_DAYS=21`, `FETCH_WORKER_CONCURRENCY=2`, explicit `AUTH_ALLOWED_EMAILS` / `ADMIN_EMAILS`, a fresh strong `POSTGRES_PASSWORD`, and `APP_BASE_URL=https://<tunnel-hostname>`
4. Convert the literal env values in §6.1 to `${VAR:-default}` form so item 3 takes effect
5. Pin the `cloudflared` image tag
6. Recreate `.secrets/cloudflare_tunnel_token` on the VM (`chmod 600`)

**Phase 2 — before relying on it (P1).** Add `/api/health` and healthchecks for `web` and `worker`; add memory limits (~1.5 GB worker, ~1 GB web, ~1 GB postgres on a 6 GB+ shape); add a nightly `pg_dump` to a separate Block Volume or Object Storage.

**Phase 3 — cleanup (P2/P3).** Fix the raw-file dedupe deletion; drop the unused `RAW_STORAGE_DIR` from `web`; write the VM runbook.

---

## 10. Open decisions

- ~~**OCI shape and architecture.**~~ **Resolved 2026-07-25 by measurement (§7):** Ampere A1 (arm64) is required; the 1 GB `E2.1.Micro` is not viable. Remaining risk is A1 capacity availability, not fit.
- **Raw payload retention.** A 21-day TTL on the boot volume, or long retention on a dedicated Block Volume — these are the two coherent options; 365 days on the boot disk is not.
