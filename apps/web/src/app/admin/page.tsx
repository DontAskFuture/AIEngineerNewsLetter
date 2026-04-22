import { requireCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/dashboard";
import {
  formatCategoryLabel,
  formatCompactNumber,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelativeTime,
} from "@/lib/formatters";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireCurrentUser();
  const snapshot = await getDashboardSnapshot();

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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-6 sm:px-10">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Admin overview
        </p>
        <h1 className="display-font mt-4 text-4xl font-semibold tracking-tight">Pipeline operations snapshot</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          This route is now backed by the live ingestion tables. It tracks crawl freshness, source
          coverage, and recent fetch attempts so we can spot parser or scheduling issues quickly.
        </p>
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
              <div key={entry.category} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-4">
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
                <div key={endpoint.id} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-4">
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
          <div className="min-w-[880px] overflow-hidden rounded-[1.25rem] border border-black/6">
            <div className="grid grid-cols-[1.1fr_1.6fr_0.65fr_0.6fr_0.75fr_0.95fr] gap-4 bg-[rgba(255,255,255,0.82)] px-4 py-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
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
                className="grid grid-cols-[1.1fr_1.6fr_0.65fr_0.6fr_0.75fr_0.95fr] gap-4 border-t border-black/6 bg-white/70 px-4 py-4 text-sm text-[color:var(--muted)]"
              >
                <span className="font-medium text-[color:var(--ink)]">{attempt.sourceName}</span>
                <span className="truncate">{attempt.endpointUrl}</span>
                <span className={attempt.status === "succeeded" ? "text-[color:var(--leaf)]" : "text-red-700"}>
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
