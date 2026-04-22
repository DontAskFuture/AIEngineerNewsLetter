import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/dashboard";
import {
  formatCategoryLabel,
  formatCompactNumber,
  formatDateTime,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";

const launchChecklist = [
  "Postgres-backed source registry and fetch audit tables",
  "Curated source seed set across labs, infra blogs, and research feeds",
  "Worker queue entrypoint for endpoint fetches",
  "Local raw-payload storage ready to swap for object storage",
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireCurrentUser();
  const snapshot = await getDashboardSnapshot();

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 pb-16 pt-6 sm:px-10">
      <section className="glass-card overflow-hidden rounded-[2rem]">
        <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[1.4fr_0.8fr] lg:px-12 lg:py-12">
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Phase 0 foundation
            </p>
            <div className="space-y-4">
              <h1 className="display-font max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                A market intelligence stack for AI builders starts with reliable ingestion.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-[color:var(--muted)] sm:text-lg">
                The dashboard is now reading live Postgres data from the ingestion pipeline. It shows
                source coverage, fresh documents, and crawl health directly from the worker output
                instead of the static seed registry.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/feed"
                className="rounded-full bg-[color:var(--ink)] px-5 py-3 text-sm font-medium text-white"
              >
                Inspect the source registry
              </Link>
              <Link
                href="/admin"
                className="rounded-full border border-black/10 px-5 py-3 text-sm font-medium"
              >
                View phase checklist
              </Link>
            </div>
          </div>
          <div className="rounded-[1.5rem] border border-black/8 bg-[rgba(255,255,255,0.82)] p-6">
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Live shape
            </p>
            <dl className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <div>
                <dt className="text-sm text-[color:var(--muted)]">Active sources</dt>
                <dd className="display-font mt-1 text-3xl font-semibold">
                  {formatCompactNumber(snapshot.overview.sourceCount)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[color:var(--muted)]">Captured documents</dt>
                <dd className="display-font mt-1 text-3xl font-semibold">
                  {formatCompactNumber(snapshot.overview.documentCount)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[color:var(--muted)]">Latest fetch</dt>
                <dd className="display-font mt-1 text-3xl font-semibold">
                  {formatRelativeTime(snapshot.overview.latestFetchAt)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Included in this cut
          </p>
          <ul className="mt-6 space-y-3 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            {launchChecklist.map((item) => (
              <li key={item} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Live coverage
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {snapshot.categoryBreakdown.map((entry) => (
              <div key={entry.category} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                  {formatCategoryLabel(entry.category)}
                </p>
                <p className="display-font mt-2 text-2xl font-semibold tracking-tight">
                  {formatCompactNumber(entry.documentCount)}
                </p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">{entry.sourceCount} tracked sources</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Latest signals
          </p>
          <div className="mt-6 space-y-4">
            {snapshot.latestDocuments.slice(0, 6).map((document) => (
              <article key={document.id} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                      {document.sourceName}
                    </p>
                    <a
                      href={document.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="display-font mt-2 block text-xl font-semibold tracking-tight"
                    >
                      {document.title}
                    </a>
                  </div>
                  <span className="text-sm text-[color:var(--muted)]">{formatRelativeTime(document.sortTime)}</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                  {summarizeText(document.summary, "No summary was extracted for this item yet.")}
                </p>
              </article>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Top sources
          </p>
          <div className="mt-6 space-y-4">
            {snapshot.topSources.map((source) => (
              <article key={source.id} className="rounded-2xl border border-black/6 bg-white/70 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="display-font text-xl font-semibold tracking-tight">{source.name}</h2>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">
                      {formatCategoryLabel(source.category)} on {source.canonicalDomain}
                    </p>
                  </div>
                  <p className="display-font text-2xl font-semibold">{formatCompactNumber(source.documentCount)}</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                  {summarizeText(source.description, "This source has live documents but no description yet.")}
                </p>
                <p className="mt-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  Latest document: {formatDateTime(source.latestDocumentAt)}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
