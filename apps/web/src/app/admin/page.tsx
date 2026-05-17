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
import { getOperationsSnapshot } from "@/lib/operations";
import { getScoringStats, getScoringStatsBySource } from "@/lib/scoring";
import { getDb, schema } from "@ai-intel/db";
import { scoringConfig } from "@ai-intel/shared";
import { eq, asc } from "drizzle-orm";
import { forceTopStoriesSummaryAction, triggerCrawlAction, triggerScoreAllAction } from "./actions";
import { ActionButton } from "./action-button";
import { ScoringProgress } from "./scoring-progress";

export const dynamic = "force-dynamic";

function formatScore(value: number | null) {
  return value == null ? "-" : value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatQueueName(name: string) {
  if (name === "fetch-source-endpoint") return "Crawl";
  if (name === "score-documents") return "Scoring";
  return name;
}

function formatErrorMessage(message: string | null) {
  return message?.trim() || "No error message captured.";
}

export default async function AdminPage() {
  await requireAdmin();
  const env = loadWebEnv();

  const db = getDb();
  const activeProfiles = await db
    .select({
      id: schema.userProfiles.id,
      displayName: schema.userProfiles.displayName,
      slug: schema.userProfiles.slug,
      updatedAt: schema.userProfiles.updatedAt,
    })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.isActive, true))
    .orderBy(asc(schema.userProfiles.id));
  const firstProfileId = activeProfiles[0]?.id ?? null;

  const [snapshot, crawlStatus, scoringStats, sourceScoringStats, operationsSnapshot] = await Promise.all([
    getDashboardSnapshot(),
    getCrawlJobStatuses(),
    firstProfileId ? getScoringStats(firstProfileId) : Promise.resolve(null),
    firstProfileId ? getScoringStatsBySource(firstProfileId) : Promise.resolve([]),
    getOperationsSnapshot(),
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
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="surface-panel rounded-[1.35rem] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              Ranking model
            </p>
            <p className="display-font mt-2 text-2xl font-semibold tracking-tight">
              {env.openRouterModel}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
              This env-configured model remains an explicit fallback after the configured model candidates.
            </p>
          </div>
          <div className="surface-panel rounded-[1.35rem] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              Scoring models
            </p>
            <p className="display-font mt-2 break-all text-2xl font-semibold tracking-tight">
              {scoringConfig.scoringModelCandidates.join(" → ")}
            </p>
            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
              Ranking and scoring use HY3 Preview first, then fall back to DeepSeek V4 Flash. Top-story summaries use the reverse order.
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Profile briefings
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
              Regenerate the cached weekly top-10 summary for a profile. The feed reuses this cached briefing
              until the story set changes or the cache expires.
            </p>
          </div>
          <span className="surface-chip w-fit px-3 py-2 text-xs uppercase tracking-[0.16em]">
            {activeProfiles.length} active profiles
          </span>
        </div>

        <div className="mt-6 grid gap-3">
          {activeProfiles.map((profile) => (
            <div
              key={profile.id}
              className="surface-panel flex flex-col gap-4 rounded-[1.25rem] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="display-font text-xl font-semibold tracking-tight">{profile.displayName}</p>
                <p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">
                  {profile.slug} - updated {formatRelativeTime(profile.updatedAt)}
                </p>
              </div>
              <ActionButton
                action={forceTopStoriesSummaryAction.bind(null, profile.id)}
                label="Force summary"
                pendingLabel="Summarizing..."
                successMessage="Top-10 profile summary regenerated."
                className="button-secondary"
              />
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Scoring batch jobs
        </p>
        <div className="mt-6">
          <ScoringProgress />
        </div>
      </section>

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Queue status
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
              Live pg-boss status for crawl and scoring jobs created in the last 24 hours.
            </p>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <div className="table-shell min-w-[860px]">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Job</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Queued</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Active</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Retry</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Completed</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Failed</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Latest queued</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Latest done</th>
                </tr>
              </thead>
              <tbody>
                {operationsSnapshot.queueSummaries.map((summary) => (
                  <tr key={summary.name} className="table-row text-[color:var(--muted)]">
                    <td className="px-4 py-3 align-middle font-medium text-[color:var(--ink)]">
                      {formatQueueName(summary.name)}
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums">{summary.created}</td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums text-[color:var(--warning)]">
                      {summary.active}
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums">{summary.retry}</td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums text-[color:var(--leaf)]">
                      {summary.completed}
                    </td>
                    <td
                      className={`px-4 py-3 text-right align-middle tabular-nums ${
                        summary.failed > 0 ? "text-[color:var(--danger)]" : ""
                      }`}
                    >
                      {summary.failed}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                      {formatRelativeTime(summary.latestCreatedAt)}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                      {formatRelativeTime(summary.latestCompletedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {sourceScoringStats.length > 0 && (
        <section className="glass-card rounded-[2rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Scoring status by source
          </p>
          <div className="mt-6 overflow-x-auto">
            <div className="table-shell min-w-[920px]">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[18%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                  <col className="w-[10%]" />
                  <col className="w-[9%]" />
                  <col className="w-[11%]" />
                </colgroup>
                <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Source</th>
                    <th scope="col" className="px-4 py-3 text-left font-medium">Coverage</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Scored</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Unscored</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Avg</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Range</th>
                  </tr>
                </thead>
                <tbody>
              {sourceScoringStats.map((source) => {
                const pct = source.totalDocuments > 0
                  ? Math.round((source.scoredDocuments / source.totalDocuments) * 100)
                  : 0;
                return (
                  <tr
                    key={source.sourceId}
                    className="table-row text-[color:var(--muted)]"
                  >
                    <td className="px-4 py-3 align-middle font-medium leading-6 text-[color:var(--ink)]">
                      {source.sourceName}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--muted)_18%,transparent)]"
                          aria-hidden="true"
                        >
                          <div
                            className="h-full rounded-full bg-[color:var(--leaf)]"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs tabular-nums text-[color:var(--muted)]">
                          {pct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums">
                      {source.totalDocuments.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums text-[color:var(--leaf)]">
                      {source.scoredDocuments.toLocaleString()}
                    </td>
                    <td
                      className={`px-4 py-3 text-right align-middle tabular-nums ${
                        source.unscoredDocuments > 0 ? "text-[color:var(--warning)]" : ""
                      }`}
                    >
                      {source.unscoredDocuments}
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums">
                      {formatScore(source.avgScore)}
                    </td>
                    <td className="px-4 py-3 text-right align-middle tabular-nums">
                      {source.minScore == null || source.maxScore == null
                        ? "-"
                        : `${formatScore(source.minScore)}-${formatScore(source.maxScore)}`}
                    </td>
                  </tr>
                );
              })}
                </tbody>
              </table>
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
          <div className="table-shell min-w-[760px]">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[42%]" />
                <col className="w-[18%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
              </colgroup>
              <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Source</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">State</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Enqueued</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {crawlStatus.jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="table-row text-[color:var(--muted)]"
                  >
                    <td className="px-4 py-3 align-middle font-medium text-[color:var(--ink)]">
                      <span className="block truncate" title={job.sourceName}>
                        {job.sourceName}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 align-middle font-medium ${
                        job.state === "completed"
                          ? "text-[color:var(--leaf)]"
                          : job.state === "failed"
                            ? "text-[color:var(--danger)]"
                            : job.state === "active"
                              ? "text-[color:var(--warning)]"
                              : ""
                      }`}
                    >
                      {job.state}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                      {formatRelativeTime(job.createdOn)}
                    </td>
                    <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums">
                      {job.completedOn ? formatRelativeTime(job.completedOn) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Error logs
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
              Recent crawl failures, scoring failures, and pg-boss job output captured by the pipeline.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            <span className="surface-chip px-3 py-2">{operationsSnapshot.crawlErrors.length} crawl</span>
            <span className="surface-chip px-3 py-2">{operationsSnapshot.scoringErrors.length} scoring</span>
            <span className="surface-chip px-3 py-2">{operationsSnapshot.queueErrors.length} queue</span>
          </div>
        </div>

        <div className="mt-6 grid gap-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">
              Crawl errors
            </p>
            <div className="mt-3 overflow-x-auto">
              <div className="table-shell min-w-[920px]">
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[25%]" />
                    <col className="w-[10%]" />
                    <col className="w-[10%]" />
                    <col className="w-[13%]" />
                    <col className="w-[24%]" />
                  </colgroup>
                  <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Source</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Endpoint</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">HTTP</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Finished</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationsSnapshot.crawlErrors.length > 0 ? (
                      operationsSnapshot.crawlErrors.map((error) => (
                        <tr key={error.id} className="table-row text-[color:var(--muted)]">
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--ink)]">
                            <span className="block truncate" title={error.sourceName}>{error.sourceName}</span>
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className="block truncate" title={error.endpointUrl}>{error.endpointUrl}</span>
                          </td>
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--danger)]">
                            {error.status}
                          </td>
                          <td className="px-4 py-3 text-right align-middle tabular-nums">
                            {error.httpStatus ?? "n/a"}
                          </td>
                          <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums" title={formatDateTime(error.finishedAt)}>
                            {formatRelativeTime(error.finishedAt)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className="line-clamp-2" title={formatErrorMessage(error.errorMessage)}>
                              {formatErrorMessage(error.errorMessage)}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr className="table-row text-[color:var(--muted)]">
                        <td className="px-4 py-4" colSpan={6}>No crawl errors captured.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">
              Scoring errors
            </p>
            <div className="mt-3 overflow-x-auto">
              <div className="table-shell min-w-[920px]">
                <table className="w-full table-fixed border-collapse text-sm">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[12%]" />
                    <col className="w-[13%]" />
                    <col className="w-[34%]" />
                  </colgroup>
                  <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Profile</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Scored</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Failed</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Started</th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationsSnapshot.scoringErrors.length > 0 ? (
                      operationsSnapshot.scoringErrors.map((error) => (
                        <tr key={error.id} className="table-row text-[color:var(--muted)]">
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--ink)]">
                            <span className="block truncate" title={error.profileName}>{error.profileName}</span>
                          </td>
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--danger)]">
                            {error.status}
                          </td>
                          <td className="px-4 py-3 text-right align-middle tabular-nums">
                            {error.scoredDocuments.toLocaleString()} / {error.totalDocuments.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right align-middle tabular-nums text-[color:var(--danger)]">
                            {error.failedDocuments.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums" title={formatDateTime(error.startedAt)}>
                            {formatRelativeTime(error.startedAt)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className="line-clamp-2" title={formatErrorMessage(error.errorMessage)}>
                              {formatErrorMessage(error.errorMessage)}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr className="table-row text-[color:var(--muted)]">
                        <td className="px-4 py-4" colSpan={6}>No scoring errors captured.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {operationsSnapshot.queueErrors.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Queue output
              </p>
              <div className="mt-3 overflow-x-auto">
                <div className="table-shell min-w-[860px]">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-[16%]" />
                      <col className="w-[12%]" />
                      <col className="w-[12%]" />
                      <col className="w-[14%]" />
                      <col className="w-[46%]" />
                    </colgroup>
                    <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left font-medium">Job</th>
                        <th scope="col" className="px-4 py-3 text-left font-medium">State</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Retries</th>
                        <th scope="col" className="px-4 py-3 text-left font-medium">Created</th>
                        <th scope="col" className="px-4 py-3 text-left font-medium">Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {operationsSnapshot.queueErrors.map((error) => (
                        <tr key={error.id} className="table-row text-[color:var(--muted)]">
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--ink)]">
                            {formatQueueName(error.name)}
                          </td>
                          <td className="px-4 py-3 align-middle font-medium text-[color:var(--danger)]">
                            {error.state}
                          </td>
                          <td className="px-4 py-3 text-right align-middle tabular-nums">
                            {error.retryCount} / {error.retryLimit}
                          </td>
                          <td className="px-4 py-3 align-middle whitespace-nowrap tabular-nums" title={formatDateTime(error.createdOn)}>
                            {formatRelativeTime(error.createdOn)}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <span className="line-clamp-2" title={formatErrorMessage(error.output)}>
                              {formatErrorMessage(error.output)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
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
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[30%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead className="table-head text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Source</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Endpoint</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">HTTP</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Duration</th>
                  <th scope="col" className="px-4 py-3 text-left font-medium">Finished</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.recentFetchAttempts.map((attempt) => (
                  <tr
                    key={attempt.id}
                    className="table-row text-[color:var(--muted)]"
                  >
                    <td className="px-4 py-4 align-middle font-medium text-[color:var(--ink)]">
                      <span className="block truncate" title={attempt.sourceName}>
                        {attempt.sourceName}
                      </span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span className="block truncate" title={attempt.endpointUrl}>
                        {attempt.endpointUrl}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-4 align-middle font-medium ${
                        attempt.status === "succeeded" ? "text-[color:var(--leaf)]" : "text-[color:var(--danger)]"
                      }`}
                    >
                      {attempt.status}
                    </td>
                    <td className="px-4 py-4 text-right align-middle tabular-nums">
                      {attempt.httpStatus ?? "n/a"}
                    </td>
                    <td className="px-4 py-4 text-right align-middle whitespace-nowrap tabular-nums">
                      {formatDuration(attempt.durationMs)}
                    </td>
                    <td className="px-4 py-4 align-middle whitespace-nowrap tabular-nums" title={formatDateTime(attempt.finishedAt)}>
                      {formatRelativeTime(attempt.finishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
