import Link from "next/link";
import { requireCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/dashboard";
import {
  formatCategoryLabel,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";
import { getPersonalizedFeedSnapshot, isValidTimeWindow, type TimeWindow } from "@/lib/personalized-feed";
import { createUserProfileAction, updateUserProfileAction } from "./actions";

export const dynamic = "force-dynamic";

interface FeedPageProps {
  searchParams?: Promise<{
    profile?: string;
    window?: string;
  }>;
}

const TIME_WINDOW_OPTIONS: { value: TimeWindow; label: string }[] = [
  { value: "day", label: "Last day" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
  { value: "quarter", label: "Last quarter" },
  { value: "year", label: "Last year" },
];

export default async function FeedPage({ searchParams }: FeedPageProps) {
  await requireCurrentUser();
  const params = searchParams ? await searchParams : undefined;
  const selectedProfileSlug = typeof params?.profile === "string" ? params.profile : undefined;
  const rawWindow = typeof params?.window === "string" ? params.window : "week";
  const timeWindow: TimeWindow = isValidTimeWindow(rawWindow) ? rawWindow : "week";

  const [snapshot, personalizedFeed] = await Promise.all([
    getDashboardSnapshot(),
    getPersonalizedFeedSnapshot(selectedProfileSlug, timeWindow),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-16 pt-6 sm:px-10">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Personalized live feed
        </p>
        <div className="mt-4 flex max-w-4xl flex-col gap-3 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          <p>
            Each profile below stores a plain-English interest statement. We screen the newest stories in
            the active daily window, ask an LLM to pick the top 10 using only the title and first
            paragraph, then order the shortlisted stories by time.
          </p>
          <p>
            Current window: {personalizedFeed.windowLabel}. Screened {personalizedFeed.candidateCount} candidate
            stories. {personalizedFeed.model ? `Model: ${personalizedFeed.model}.` : null}
          </p>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {TIME_WINDOW_OPTIONS.map((option) => {
            const isActive = personalizedFeed.activeTimeWindow === option.value;
            const href = `/feed?${new URLSearchParams({
              ...(selectedProfileSlug ? { profile: selectedProfileSlug } : {}),
              window: option.value,
            }).toString()}`;

            return (
              <Link
                key={option.value}
                href={href}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-[color:var(--ink)] text-white"
                    : "border border-black/10 bg-white/75 text-[color:var(--ink)]"
                }`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <article className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                Interest profiles
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
                Pick a profile to steer the shortlist, or create a new one for a different research lens.
              </p>
            </div>
            <p className="text-sm text-[color:var(--muted)]">{personalizedFeed.profiles.length} saved profiles</p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {personalizedFeed.profiles.map((profile) => {
              const isSelected = profile.slug === personalizedFeed.selectedProfile.slug;

              return (
                <Link
                  key={profile.id}
                  href={`/feed?${new URLSearchParams({ profile: profile.slug, window: timeWindow }).toString()}`}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    isSelected
                      ? "bg-[color:var(--ink)] text-white"
                      : "border border-black/10 bg-white/75 text-[color:var(--ink)]"
                  }`}
                >
                  {profile.displayName}
                </Link>
              );
            })}
          </div>

          <form action={updateUserProfileAction} className="mt-6 grid gap-4">
            <input type="hidden" name="profileId" value={personalizedFeed.selectedProfile.id} />
            <div className="grid gap-2">
              <label htmlFor="displayName" className="text-sm font-medium text-[color:var(--ink)]">
                Profile name
              </label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={personalizedFeed.selectedProfile.displayName}
                className="rounded-2xl border border-black/10 bg-white/85 px-4 py-3 text-sm text-[color:var(--ink)] outline-none"
              />
            </div>

            <div className="grid gap-2">
              <label htmlFor="interestStatement" className="text-sm font-medium text-[color:var(--ink)]">
                Plain-English interest
              </label>
              <textarea
                id="interestStatement"
                name="interestStatement"
                defaultValue={personalizedFeed.selectedProfile.interestStatement}
                rows={7}
                className="rounded-[1.5rem] border border-black/10 bg-white/85 px-4 py-3 text-sm leading-7 text-[color:var(--ink)] outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                Updated {formatRelativeTime(personalizedFeed.selectedProfile.updatedAt)}
              </p>
              <button
                type="submit"
                className="rounded-full bg-[color:var(--ink)] px-5 py-3 text-sm font-medium text-white"
              >
                Save interest
              </button>
            </div>
          </form>
        </article>

        <article className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
            Ranking status
          </p>
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-black/6 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                Current mode
              </p>
              <p className="display-font mt-2 text-2xl font-semibold tracking-tight">
                {personalizedFeed.rankingStatusLabel}
              </p>
              <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">
                {personalizedFeed.rankingSummary}
              </p>
            </div>

            <div className="rounded-2xl border border-black/6 bg-white/75 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                Create another profile
              </p>
              <form action={createUserProfileAction} className="mt-4 grid gap-3">
                <input
                  name="displayName"
                  placeholder="Example: Infra scout"
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[color:var(--ink)] outline-none"
                />
                <textarea
                  name="interestStatement"
                  rows={4}
                  placeholder="Example: Watch inference serving, GPU utilization, model routing, and pricing or latency shifts that create infra bottlenecks."
                  className="rounded-[1.5rem] border border-black/10 bg-white px-4 py-3 text-sm leading-7 text-[color:var(--ink)] outline-none"
                />
                <button
                  type="submit"
                  className="w-fit rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-medium text-[color:var(--ink)]"
                >
                  Add profile
                </button>
              </form>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-4">
        {personalizedFeed.topDocuments.map((document) => (
          <article key={document.id} className="glass-card rounded-[1.5rem] p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-4xl">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                    {document.sourceName}
                  </p>
                  {document.llmRank ? (
                    <span className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      LLM rank #{document.llmRank}
                    </span>
                  ) : null}
                  {document.matchScore ? (
                    <span className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                      Match {formatPercent(document.matchScore)}
                    </span>
                  ) : null}
                </div>
                <a
                  href={document.canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="display-font mt-2 block text-2xl font-semibold tracking-tight"
                >
                  {document.title}
                </a>
                <p className="mt-3 text-sm leading-6 text-[color:var(--muted)] sm:text-base">
                  {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                </p>
                {document.whyRelevant ? (
                  <div className="mt-4 rounded-[1.25rem] border border-black/8 bg-white/65 p-4">
                    <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                      Why Relevant To You
                    </p>
                    <p className="mt-2 text-sm leading-7 text-[color:var(--ink)] sm:text-base">
                      {document.whyRelevant}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 text-left sm:text-right">
                <span className="w-fit rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)] sm:ml-auto">
                  {formatCategoryLabel(document.category)}
                </span>
                <span className="text-sm text-[color:var(--muted)]">{formatRelativeTime(document.sortTime)}</span>
                <span className="text-xs text-[color:var(--muted)]">{formatDateTime(document.sortTime)}</span>
              </div>
            </div>
          </article>
        ))}
      </section>

      {personalizedFeed.remainingDocuments.length > 0 ? (
        <section>
          <details>
            <summary className="mb-4 cursor-pointer list-none">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                  More stories
                </p>
                <span className="text-sm text-[color:var(--muted)]">
                  ({personalizedFeed.remainingDocuments.length})
                </span>
              </div>
            </summary>
            <div className="grid gap-3">
              {personalizedFeed.remainingDocuments.slice(0, 10).map((document) => (
                <article key={document.id} className="glass-card rounded-[1.25rem] px-5 py-4 sm:px-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="max-w-4xl">
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                          {document.sourceName}
                        </p>
                        <span className="text-xs text-[color:var(--muted)]">
                          {formatRelativeTime(document.sortTime)}
                        </span>
                      </div>
                      <a
                        href={document.canonicalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="display-font mt-1 block text-lg font-semibold tracking-tight"
                      >
                        {document.title}
                      </a>
                      <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                        {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                      </p>
                    </div>
                    <span className="w-fit rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)] sm:ml-auto">
                      {formatCategoryLabel(document.category)}
                    </span>
                  </div>
                </article>
              ))}
              {personalizedFeed.remainingDocuments.length > 10 ? (
                <details>
                  <summary className="cursor-pointer list-none">
                    <p className="rounded-full border border-black/10 bg-white/60 px-5 py-3 text-center text-sm font-medium text-[color:var(--ink)]">
                      Show {personalizedFeed.remainingDocuments.length - 10} more
                    </p>
                  </summary>
                  <div className="mt-3 grid gap-3">
                    {personalizedFeed.remainingDocuments.slice(10).map((document) => (
                      <article key={document.id} className="glass-card rounded-[1.25rem] px-5 py-4 sm:px-6">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="max-w-4xl">
                            <div className="flex flex-wrap items-center gap-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                                {document.sourceName}
                              </p>
                              <span className="text-xs text-[color:var(--muted)]">
                                {formatRelativeTime(document.sortTime)}
                              </span>
                            </div>
                            <a
                              href={document.canonicalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="display-font mt-1 block text-lg font-semibold tracking-tight"
                            >
                              {document.title}
                            </a>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                              {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                            </p>
                          </div>
                          <span className="w-fit rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)] sm:ml-auto">
                            {formatCategoryLabel(document.category)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        </section>
      ) : null}

      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <details>
          <summary className="cursor-pointer list-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                  Source registry
                </p>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
                  The shortlist above rides on top of the same live registry, crawl stats, and normalized
                  documents from the worker pipeline.
                </p>
              </div>
              <p className="text-sm text-[color:var(--muted)]">
                {snapshot.overview.sourceCount} sources across {snapshot.overview.endpointCount} endpoints
              </p>
            </div>
          </summary>

          <div className="mt-6 grid gap-4">
            {snapshot.sourceRegistry.map((source) => (
              <article key={source.id} className="rounded-[1.5rem] border border-black/6 bg-white/70 p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="display-font text-2xl font-semibold tracking-tight">{source.name}</h2>
                      <span className="rounded-full border border-black/10 bg-white/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                        {formatCategoryLabel(source.category)}
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--muted)] sm:text-base">
                      {summarizeText(source.description, "This source was seeded and fetched successfully.")}
                    </p>
                  </div>
                  <div className="grid gap-2 text-sm text-[color:var(--muted)] sm:text-right">
                    <p>{source.documentCount} documents captured</p>
                    <p>latest document {formatRelativeTime(source.latestDocumentAt)}</p>
                    <p>trust tier {source.trustTier}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {source.endpoints.map((endpoint) => (
                    <div key={endpoint.id} className="rounded-2xl border border-black/6 bg-white/80 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                        {endpoint.kind}
                      </p>
                      <p className="mt-2 break-all text-sm leading-6 text-[color:var(--muted)]">{endpoint.url}</p>
                      <div className="mt-4 space-y-1 text-xs text-[color:var(--muted)]">
                        <p>cadence every {endpoint.cadenceMinutes} minutes</p>
                        <p>
                          {endpoint.totalRuns} runs, {formatPercent(endpoint.successRate)} success
                        </p>
                        <p>latest fetch {formatRelativeTime(endpoint.latestFetchAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </details>
      </section>
    </main>
  );
}
