# Home origin and daily Cloudflare static site

**Scoped:** 2026-11-08
**Status:** scope only. Nothing in this document is implemented. `docs/deployment.md` remains the current runbook for the Oracle Cloud VM.

## 1. Outcome

Retire the Oracle Cloud VM. Run crawling, scoring, the database, the daily email, and the signed-in app on one always-on machine at home. Publish the public brief once a day to Cloudflare as static files, so readers still get the site when that machine is asleep or the tunnel is down.

Cloudflare Tunnel stays. It is the only public path to the live app. The public brief does not go through the tunnel.

Checked against Cloudflare's docs on 2026-11-08, this layout stays on the free tiers: Workers Static Assets requests are free and unlimited, and every account includes 1,000 tunnels at no cost. Re-check [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [Tunnels for Platforms](https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/) before implementation if those pages have moved.

## 2. What stays where

| Work | Where it runs |
|---|---|
| Fetch the curated sources, score documents, send the newsletter | Home machine, existing `worker` container |
| Database, sessions, curation, subscribers | Home machine, existing database volume |
| Signed-in feed, read list, admin, login, subscribe, unsubscribe | Home machine, existing `web` container, reached through Cloudflare Tunnel |
| Anonymous brief, time-window pages, RSS, source footer | Cloudflare Workers Static Assets, replaced once a day |

The home stack is the Compose file that already exists, started with the `tunnel` profile. The database and web stay bound to `127.0.0.1`. `cloudflared` dials out. No inbound port on the home router.

A laptop that sleeps does not meet this. The machine has to be up through `NEWSLETTER_SEND_HOUR` in `APP_TIME_ZONE` (default 8, `America/Los_Angeles`) and keep Docker's restart policy, because a wake later the same local day still enqueues that day's newsletter (`apps/worker/src/index.ts` skips only while the local hour is earlier than the send hour, then uses a per-date singleton). A wake on the next local day does not backfill the missed day. The same gate applies to the publish job below.

Raw payload growth is unchanged: about 8–12 GB/month, with `CRAWLED_DOCUMENT_TTL_DAYS` at 30 unless the home disk is sized for more.

## 3. Two hostnames

One hostname cannot serve both audiences without running a Worker on every public page view. The anonymous `/feed` and the signed-in `/feed` are the same path today, and the layout branches on the session cookie (`apps/web/src/app/layout.tsx`, `apps/web/src/app/feed/page.tsx`). A Worker that inspects that cookie counts against the free plan's 100,000 Worker requests per day. Static asset requests do not.

| Hostname | DNS | What a visitor gets |
|---|---|---|
| Public site, e.g. `news.example.com` | Worker custom domain for the static-assets project | The latest published brief. No Worker script runs for these reads. |
| App, e.g. `app.example.com` | Existing tunnel public hostname, service `http://web:3000` | The current Next.js app |

`APP_BASE_URL` becomes the app hostname. Unsubscribe links in the newsletter already use it (`apps/worker/src/jobs/send-daily-newsletter.ts`). Add `PUBLIC_SITE_URL` for the static site. RSS self and alternate links, OpenRouter `HTTP-Referer`, and any "view the brief" link in the email use `PUBLIC_SITE_URL`.

The curator opens the app hostname directly. The static site does not need the hidden login gesture the public Next.js chrome uses today.

## 4. Static site contents

Publish a directory of files. Workers serves a matching path as that file and does not invoke a script.

| File | Page |
|---|---|
| `index.html` | Same brief as today's `/` redirect target: the public week window |
| `feed/index.html` | Week window, linked as `/feed` |
| `feed/day/index.html`, `feed/month/index.html`, `feed/quarter/index.html`, `feed/year/index.html` | The other windows already offered on the public feed |
| `rss.xml` | Week window, the same items as `index.html` |
| stylesheet, font files, theme script | Visual match for the anonymous feed |

Each HTML page is the anonymous feed only:

- Brand name, bio, and social links from `BRAND_AUTHOR_*`
- Window switcher as links between those files
- Top stories and the rest of the window, including pinned picks, hidden stories omitted, and the practitioner take (`formatPractitionerTake`)
- Source footer from `defaultSources`, the same list the layout footer renders
- Email subscribe form
- RSS link to `/rss.xml`
- Theme bootstrap that reads `localStorage` and `prefers-color-scheme`, matching the script already in `apps/web/src/app/layout.tsx`

Story links on these pages point at the document's canonical `http(s)` URL. Anonymous visitors do not record `document_reads`, so they do not need `/out/[documentId]`. The signed-in app keeps `/out/[documentId]`.

`formatRelativeTime` is evaluated at publish and stays frozen until the next publish. Absolute timestamps still render.

The page is a template fed by `getPublicAiEngineerFeedSnapshot` (or the same snapshot built inside the worker without importing the Next.js app). It is not `output: 'export'` of the Next.js app. The signed-in routes, server actions, and `force-dynamic` pages stay on the origin.

Reuse `buildCuratedRssXml` from `packages/shared` so the RSS item order, pins, and "My Take" notes stay aligned with `apps/web/src/app/rss.xml/route.ts`.

## 5. Requests that still hit the tunnel

These stay on the Next.js app. The static site links or posts to the app hostname.

| Action | Behavior |
|---|---|
| Subscribe | The static form is a normal `POST` to a new route on the app host, for example `POST /newsletter/subscribe`. The current `subscribeNewsletterAction` is a same-origin server action and will not accept a cross-origin form. The route validates the email the same way, then redirects to `PUBLIC_SITE_URL` with `?newsletter=subscribed`, `invalid_email`, or `error`. A few lines of script on the static page read that query and show the existing status copy. |
| Unsubscribe | Email links keep using `APP_BASE_URL/feed/unsubscribe?token=...`. The route still updates `newsletter_subscribers`, then redirects to `PUBLIC_SITE_URL/?newsletter=unsubscribed`. |
| Login, signup, admin, read list, personalized feed, `/out/[documentId]`, `/api/*` | Unchanged, on the app hostname only. |

Subscribe and unsubscribe succeed only while the home machine and the tunnel are up. The public brief does not.

## 6. Daily publish job

Add a worker job, `publish-public-site`, beside `send-daily-newsletter`. Do not fold it into the mail job: a mail failure must still leave a fresh site, and a publish failure must still leave the mail sent.

Scheduling matches the newsletter:

- Enqueue once the local hour in `APP_TIME_ZONE` reaches `NEWSLETTER_SEND_HOUR`
- Singleton key per local calendar date, so a restart or a late wake the same day publishes once
- The check interval can follow `NEWSLETTER_CHECK_INTERVAL_MINUTES`

The job:

1. Builds the five public windows from the curator's feed (the owner and profile `getPublicAiEngineerFeedSnapshot` already resolves).
2. Renders HTML, `rss.xml`, and the copied stylesheet and fonts into a directory.
3. Uploads that directory with Wrangler as a Workers Static Assets deployment.

The upload is an outbound call to the Cloudflare API. It does not travel through the tunnel. A failed upload leaves the previous deployment in place, which is the copy readers keep seeing.

Rendering helpers live in their own module and have unit tests on the Node test runner, with no database and no network. The job file stays thin.

Cloudflare credentials follow the tunnel-token pattern: an ignored file such as `.secrets/cloudflare_api_token`, mounted into the worker, plus the account id. Do not commit the token, do not put it in `.env.example` as a real value, and do not interpolate it into a Compose command. `wrangler.toml` (project name, compatibility date, assets directory) is safe to commit.

The first deploy of the Worker project can be done once from the home machine with Wrangler, which creates the project and the public custom domain. After that, the daily job publishes new versions of the assets.

## 7. Free-tier requirements

These are part of the design, not optional polish.

- The public hostname serves files only. Do not set `run_worker_first` on `/`, `/feed`, `/rss.xml`, or the asset paths. On the free plan, paths forced through the script return 429 after 100,000 Worker requests in a day instead of the file.
- Do not enable Workers Caching in the mode that bills static asset requests as Worker requests.
- One tunnel for the app hostname. Do not put Access in front of it; the app already has its own login.
- Stay on the Workers Free plan. Workers Paid is a $5 per month minimum and is outside this scope.
- The asset bundle is a few HTML pages, one stylesheet, and fonts. The free limit is 20,000 files per version and 25 MiB per file.

A domain registered somewhere is still required so both hostnames can sit on Cloudflare DNS. Cloudflare's DNS and the free website plan for that zone are the expected setup. The registrar fee is separate from this design.

OpenRouter and SMTP costs are unchanged. The Oracle VM is the Always Free Ampere shape, so shutting it down does not change a Cloudflare or Oracle bill.

## 8. Work breakdown

1. **Renderer.** Pure function from a public feed snapshot plus brand fields to the HTML files and RSS. Tests cover pins, hidden stories, practitioner takes, window links, canonical story URLs, and the RSS alignment.
2. **Publish job.** Enqueue rule, singleton key, Wrangler upload, secret mounting, and a failure log that does not throw away the previous site.
3. **Subscribe and unsubscribe redirects.** New subscribe route on the app host. Unsubscribe redirect targets `PUBLIC_SITE_URL`. Static page reads `?newsletter=`.
4. **Env and docs.** `PUBLIC_SITE_URL` on web and worker. Document both hostnames, the secret file, and the home-machine cutover. Update the nearest `AGENTS.md` files when the code lands. `docs/deployment.md` stays the VM runbook until the cutover is done, then gains a home-origin section or a successor.

No schema change is required. Subscriber rows, sessions, and documents stay in the database on the home machine.

## 9. Acceptance

- `GET` of the public hostname returns the published week brief, and Cloudflare's response is the static asset, not a Worker invocation.
- `/rss.xml` lists the same week items, pins, and notes as that page.
- Stopping the home machine does not take the public hostname down. It keeps serving the last successful publish.
- Starting the machine after `NEWSLETTER_SEND_HOUR` on the same local day publishes once and sends the newsletter once.
- Subscribe from the static page inserts a `newsletter_subscribers` row when the tunnel is up, then returns the visitor to the public site with the subscribed message.
- The email unsubscribe link still revokes that row and returns the visitor to the public site.
- Login, the personalized feed, the read list, and admin work on the app hostname and are absent from the static files.
- A second publish the same day replaces the assets. A failed publish leaves the previous assets up.
- The account remains on Workers Free and uses a single tunnel.

## 10. Cutover

Do this after the acceptance checks pass against a hostname that is not the current production name.

1. Dump the VM database and restore it on the home machine with `pnpm ops db-dump` and `pnpm ops db-restore`.
2. Start the home stack with `docker compose --profile tunnel up --build -d`. Point the app hostname at `http://web:3000`.
3. Set `APP_BASE_URL` to the app hostname and `PUBLIC_SITE_URL` to the public hostname.
4. Run one publish. Confirm the public hostname serves it.
5. Move the production DNS name readers already use onto the static project. Keep the app on its own name.
6. Confirm a crawl, a score, a newsletter send, and a publish from the home machine.
7. Stop the VM. Later deploys are a local Compose rebuild. `pnpm ops deploy` remains the VM path and is unused once the VM is gone.

## 11. Out of scope

- Moving the database, the job queue, crawling, or scoring onto Workers, D1, or R2
- Running the Next.js app on Workers
- A personalized static page per user
- Publishing more often than once a day
- Replacing OpenRouter or SMTP
- Putting Cloudflare Access in front of the app
- Backfilling a missed day's email or publish after the local date has rolled over
