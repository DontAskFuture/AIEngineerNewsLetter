import { requireAdmin } from "@/lib/auth";
import { getCrawlJobStatuses } from "@/lib/crawler";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { loadWebEnv } from "@/lib/env";
import {
  formatCategoryLabel,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelativeTime,
} from "@/lib/formatters";
import { getScoringStats, getScoringStatsBySource } from "@/lib/scoring";
import { getDb, schema } from "@ai-intel/db";
import { eq, asc } from "drizzle-orm";
import { triggerCrawlAction, triggerScoreAllAction } from "./actions";
import { ActionButton } from "./action-button";
import { ScoringProgress } from "./scoring-progress";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const env = loadWebEnv();

  const db = getDb();
  const profiles = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.isActive, true))
    .orderBy(asc(schema.userProfiles.id))
    .limit(1);
  const firstProfileId = profiles[0]?.id ?? null;

  const [snapshot, crawlStatus, scoringStats, sourceScoringStats] = await Promise.all([
    getDashboardSnapshot(),
    getCrawlJobStatuses(),
    firstProfileId ? getScoringStats(firstProfileId) : Promise.resolve(null),
    firstProfileId ? getScoringStatsBySource(firstProfileId) : Promise.resolve([]),
  ]);

  const adminCards = [
    {
      title: "Documents",
      value: formatCompactNumber(snapshot.overview.documentCount),
      body: `Latest live signal ${formatRelativeTime(snapshot.overview.latestDocumentAt)}.`,
    },
    {
      title: "Fetch runs",
      value: formatCompactNumber(snapshot.overview.fetchRunCount),
      body: `${snapshot.overview.successfulFetchCount} succeeded, ${snapshot.overview.failedFetchCount} failed.`,
    },
    {
      title: "Tracked endpoints",
      value: formatCompactNumber(snapshot.overview.endpointCount),
      body: `${snapshot.overview.sourceCount} active sources across ${snapshot.overview.categoryCount} categories.`,
    },
    {
      title: "Latest crawl",
      value: formatRelativeTime(snapshot.overview.latestFetchAt),
      body: `Most recent completion ${formatDateTime(snapshot.overview.latestFetchAt)}.`,
    },
  ];

  return (
    <main className="page-shell">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Admin overview
        </p>
        <h1 className="display-font mt-4 text-4xl font-semibold tracking-tight">Pipeline operations snapshot</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          This route is now backed by the live ingestion tables. It tracks crawl freshness, source
          coverage, and recent fetch attempts so we can spot parser or scheduling issues quickly.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="surface-panel rounded-[1.35rem] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              Ranking model
            </p>
            <p className="display-font mt-2 text-2xl font-semibold tracking-tight">
              {env.openRouterModel}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
              This is the configured OpenRouter model used when the app needs to rank or score stories.
            </p>
          </div>
          <div className="surface-panel rounded-[1.35rem] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              Ranking access
            </p>
            <p className="display-font mt-2 text-2xl font-semibold tracking-tight">
              {env.openRouterApiKey ? "API key configured" : "Fallback only"}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
              When the API key is missing, the feed can still render from cached or fallback ordering.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-4">
          <ActionButton
            action={triggerCrawlAction}
            label="Force crawl all sources"
            pendingLabel="Crawling..."
            successMessage="Crawl triggered — new documents will be scored automatically."
            className="button-secondary"
          />
          <ActionButton
            action={triggerScoreAllAction}
            label="Score all unscored documents"
            pendingLabel="Enqueueing..."
            successMessage="Scoring jobs enqueued — worker will process them."
            className="button-primary"
          />
        </div>
        {scoringStats && (
          <div className="mt-4 flex gap-6 text-sm text-[color:var(--muted)]">
            <span>Scored: <strong>{scoringStats.scoredDocuments}</strong></span>
            <span>Unscored: <strong>{scoringStats.unscoredDocuments}</strong></span>
            <span>Total: <strong>{scoringStats.totalDocuments}</strong></span>
          </div>
        )}
      </section>

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Scoring batch jobs
        </p>
        <div className="mt-6">
          <ScoringProgress />
        </div>
      </section>

      {sourceScoringStats.length > 0 && (
        <section className="glass-card rounded-[2rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Scoring status by source
          </p>
          <div className="mt-6 overflow-x-auto">
            <div className="table-shell min-w-[700px]">
              <div className="table-head grid grid-cols-[1.4fr_0.6fr_0.6fr_0.6fr_0.5fr_0.5fr_0.5fr] gap-4 px-4 py-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                <span>Source</span>
                <span>Total</span>
                <span>Scored</span>
                <span>Unscored</span>
                <span>Avg</span>
                <span>Min</span>
                <span>Max</span>
              </div>
              {sourceScoringStats.map((source) => {
                const pct = source.totalDocuments > 0
                  ? Math.round((source.scoredDocuments / source.totalDocuments) * 100)
                  : 0;
                return (
                  <div
                    key={source.sourceId}
                    className="table-row grid grid-cols-[1.4fr_0.6fr_0.6fr_0.6fr_0.5fr_0.5fr_0.5fr] gap-4 px-4 py-3 text-sm text-[color:var(--muted)]"
                  >
                    <span className="font-medium text-[color:var(--ink)]">
                      {source.sourceName}
                      <span className="ml-2 text-xs text-[color:var(--muted)]">
                        {pct === 100
                          ? "✓"
                          : `${pct}%`}
                      </span>
                    </span>
                    <span>{source.totalDocuments}</span>
                    <span className="text-[color:var(--leaf)]">{source.scoredDocuments}</span>
                    <span className={source.unscoredDocuments > 0 ? "text-[color:var(--warning)]" : ""}>
                      {source.unscoredDocuments}
                    </span>
                    <span>{source.avgScore ?? "—"}</span>
                    <span>{source.minScore ?? "—"}</span>
                    <span>{source.maxScore ?? "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Crawl job status (last 24h)
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-4">
          <div className="surface-panel rounded-2xl px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">Queued</p>
            <p className="display-font mt-2 text-3xl font-semibold">{crawlStatus.summary.created}</p>
          </div>
          <div className="surface-panel rounded-2xl px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--warning)]">Active</p>
            <p className="display-font mt-2 text-3xl font-semibold">{crawlStatus.summary.active}</p>
          </div>
          <div className="surface-panel rounded-2xl px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--leaf)]">Completed</p>
            <p className="display-font mt-2 text-3xl font-semibold">{crawlStatus.summary.completed}</p>
          </div>
          <div className="surface-panel rounded-2xl px-4 py-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--danger)]">Failed</p>
            <p className="display-font mt-2 text-3xl font-semibold">{crawlStatus.summary.failed}</p>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <div className="table-shell min-w-[700px]">
            <div className="table-head grid grid-cols-[1.2fr_0.6fr_0.9fr_0.9fr] gap-4 px-4 py-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              <span>Source</span>
              <span>State</span>
              <span>Enqueued</span>
              <span>Completed</span>
            </div>
            {crawlStatus.jobs.map((job) => (
              <div
                key={job.id}
                className="table-row grid grid-cols-[1.2fr_0.6fr_0.9fr_0.9fr] gap-4 px-4 py-3 text-sm text-[color:var(--muted)]"
              >
                <span className="font-medium text-[color:var(--ink)]">{job.sourceName}</span>
                <span
                  className={
                    job.state === "completed"
                      ? "text-[color:var(--leaf)]"
                      : job.state === "failed"
                        ? "text-[color:var(--danger)]"
                        : job.state === "active"
                          ? "text-[color:var(--warning)]"
                          : ""
                  }
                >
                  {job.state}
                </span>
                <span>{formatRelativeTime(job.createdOn)}</span>
                <span>{job.completedOn ? formatRelativeTime(job.completedOn) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {adminCards.map((card) => (
          <article key={card.title} className="glass-card rounded-[1.5rem] p-5 sm:p-6">
            <p className="text-sm font-medium uppercase tracking-[0.18em] text-[color:var(--leaf)]">
              {card.title}
            </p>
            <h2 className="display-font mt-3 text-3xl font-semibold tracking-tight">{card.value}</h2>
            <p className="mt-3 text-sm leading-7 text-[color:var(--muted)] sm:text-base">{card.body}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Category coverage
          </p>
          <div className="mt-6 space-y-3">
            {snapshot.categoryBreakdown.map((entry) => (
              <div key={entry.category} className="surface-panel rounded-2xl px-4 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                      {formatCategoryLabel(entry.category)}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">{entry.sourceCount} sources</p>
                  </div>
                  <p className="display-font text-2xl font-semibold">{formatCompactNumber(entry.documentCount)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Endpoint health
          </p>
          <div className="mt-6 space-y-3">
            {snapshot.sourceRegistry.flatMap((source) =>
              source.endpoints.map((endpoint) => (
                <div key={endpoint.id} className="surface-panel rounded-2xl px-4 py-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="display-font text-xl font-semibold tracking-tight">{source.name}</p>
                      <p className="mt-1 break-all text-sm leading-6 text-[color:var(--muted)]">
                        {endpoint.url}
                      </p>
                    </div>
                    <div className="grid gap-1 text-sm text-[color:var(--muted)] sm:text-right">
                      <p>{endpoint.totalRuns} runs</p>
                      <p>{formatPercent(endpoint.successRate)} success</p>
                      <p>{formatRelativeTime(endpoint.latestFetchAt)}</p>
                    </div>
                  </div>
                </div>
              )),
            )}
          </div>
        </div>
      </section>

      <section className="glass-card rounded-[1.75rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Recent fetch attempts
        </p>
        <div className="mt-6 overflow-x-auto">
          <div className="table-shell min-w-[880px]">
            <div className="table-head grid grid-cols-[1.1fr_1.6fr_0.65fr_0.6fr_0.75fr_0.95fr] gap-4 px-4 py-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              <span>Source</span>
              <span>Endpoint</span>
              <span>Status</span>
              <span>HTTP</span>
              <span>Duration</span>
              <span>Finished</span>
            </div>
            {snapshot.recentFetchAttempts.map((attempt) => (
              <div
                key={attempt.id}
                className="table-row grid grid-cols-[1.1fr_1.6fr_0.65fr_0.6fr_0.75fr_0.95fr] gap-4 px-4 py-4 text-sm text-[color:var(--muted)]"
              >
                <span className="font-medium text-[color:var(--ink)]">{attempt.sourceName}</span>
                <span className="truncate">{attempt.endpointUrl}</span>
                <span className={attempt.status === "succeeded" ? "text-[color:var(--leaf)]" : "text-[color:var(--danger)]"}>
                  {attempt.status}
                </span>
                <span>{attempt.httpStatus ?? "n/a"}</span>
                <span>{formatDuration(attempt.durationMs)}</span>
                <span title={formatDateTime(attempt.finishedAt)}>{formatRelativeTime(attempt.finishedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
