import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getDashboardSnapshot } from "@/lib/dashboard";
import {
  formatCategoryLabel,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";
import {
  getPersonalizedFeedSnapshot,
  getPublicAiEngineerFeedSnapshot,
  isValidTimeWindow,
  type TimeWindow,
} from "@/lib/personalized-feed";
import { createUserProfileAction, deleteUserProfileAction, updateUserProfileAction } from "./actions";
import { MoreStories } from "./more-stories";
import { ProfileSelector } from "./profile-selector";

export const dynamic = "force-dynamic";

interface FeedPageProps {
  searchParams?: Promise<{
    error?: string;
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
  const currentUser = await getCurrentUser();
  const isPublicView = currentUser === null;
  const params = searchParams ? await searchParams : undefined;
  const selectedProfileSlug = currentUser && typeof params?.profile === "string" ? params.profile : undefined;
  const errorCode = typeof params?.error === "string" ? params.error : undefined;
  const rawWindow = typeof params?.window === "string" ? params.window : "week";
  const timeWindow: TimeWindow = isValidTimeWindow(rawWindow) ? rawWindow : "week";
  const profileError =
    errorCode === "duplicate_profile_name"
      ? "That profile name is already used on your account. Choose a unique name for each profile."
      : errorCode === "last_profile_delete"
        ? "You need at least one active profile. Create another profile before deleting this one."
      : null;

  const [snapshot, personalizedFeed] = await Promise.all([
    getDashboardSnapshot(),
    currentUser
      ? getPersonalizedFeedSnapshot(selectedProfileSlug, timeWindow, currentUser.id)
      : getPublicAiEngineerFeedSnapshot(timeWindow),
  ]);
  const orderedProfiles = [
    personalizedFeed.selectedProfile,
    ...personalizedFeed.profiles.filter((profile) => profile.id !== personalizedFeed.selectedProfile.id),
  ];

  return (
    <main className="page-shell">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-wrap gap-2">
          <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
            {isPublicView ? "Public preview" : "Ranked top 10"}
          </span>
          <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
            Time-aware
          </span>
        </div>
        <p className="mt-4 text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Personalized live feed
        </p>
        <div className="mt-4 flex max-w-4xl flex-col gap-3 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          <p>
            {isPublicView
              ? "Browse the public AI Engineer feed, powered by the AI Engineer profile from lianglingfan@gmail.com."
              : "Each profile below stores a plain-English interest statement. We screen the newest stories in the active daily window, use pre-computed relevance scores when the worker has them, then fall back to newest stories while scoring catches up."}
          </p>
          <p>
            Current window: {personalizedFeed.windowLabel}. Screened {personalizedFeed.candidateCount} candidate
            stories.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {TIME_WINDOW_OPTIONS.map((option) => {
            const isActive = personalizedFeed.activeTimeWindow === option.value;
            const params = new URLSearchParams({ window: option.value });
            if (!isPublicView) {
              params.set("profile", personalizedFeed.selectedProfile.slug);
            }
            const href = `/feed?${params.toString()}`;

            return (
              <Link
                key={option.value}
                href={href}
                className={isActive ? "button-primary" : "button-secondary"}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </section>

      {!isPublicView ? (
      <section className="glass-card rounded-[1.75rem] p-6 sm:p-8">
        <article>
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

          <div className="mt-6">
            <ProfileSelector
              profiles={orderedProfiles.map((profile) => ({
                id: profile.id,
                slug: profile.slug,
                displayName: profile.displayName,
              }))}
              selectedSlug={personalizedFeed.selectedProfile.slug}
              timeWindow={timeWindow}
            />
          </div>

          {profileError ? (
            <div className="alert-error mt-5 rounded-[1.25rem] px-4 py-3 text-sm leading-6" role="alert">
              {profileError}
            </div>
          ) : null}

          <div className="mt-7 grid gap-7 border-t border-[color:var(--line)] pt-7 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8">
            <div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                    Edit selected
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                    Tune the profile that is currently driving this feed.
                  </p>
                </div>
                <p className="text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
                  Updated {formatRelativeTime(personalizedFeed.selectedProfile.updatedAt)}
                </p>
              </div>

              <form
                key={personalizedFeed.selectedProfile.id}
                action={updateUserProfileAction}
                className="mt-5 grid gap-4"
              >
                <input type="hidden" name="profileId" value={personalizedFeed.selectedProfile.id} />
                <input type="hidden" name="timeWindow" value={timeWindow} />
                <div className="grid gap-2">
                  <label htmlFor="displayName" className="text-sm font-medium text-[color:var(--ink)]">
                    Profile name
                  </label>
                  <input
                    id="displayName"
                    name="displayName"
                    defaultValue={personalizedFeed.selectedProfile.displayName}
                    className="field-shell px-4 py-3 text-sm"
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
                    className="field-shell rounded-[1.5rem] px-4 py-3 text-sm leading-7"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="submit"
                    className="button-primary"
                  >
                    Save interest
                  </button>
                </div>
              </form>

              <form action={deleteUserProfileAction} className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="profileId" value={personalizedFeed.selectedProfile.id} />
                <input type="hidden" name="timeWindow" value={timeWindow} />
                <p className="max-w-lg text-xs leading-6 text-[color:var(--muted)]">
                  Delete this profile when you no longer want its shortlist. Existing read history and scores stay archived.
                </p>
                <button
                  type="submit"
                  className="button-secondary border-[color:color-mix(in_srgb,var(--danger)_35%,var(--button-secondary-border))] text-[color:var(--danger)]"
                >
                  Delete profile
                </button>
              </form>
            </div>

            <div className="border-t border-[color:var(--line)] pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                Add new
              </p>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                Create a separate research lens for a different shortlist.
              </p>
              <form action={createUserProfileAction} className="mt-5 grid gap-3">
                <input type="hidden" name="timeWindow" value={timeWindow} />
                <div className="grid gap-2">
                  <label htmlFor="newDisplayName" className="text-sm font-medium text-[color:var(--ink)]">
                    Profile name
                  </label>
                  <input
                    id="newDisplayName"
                    name="displayName"
                    placeholder="Example: Infra scout"
                    className="field-shell px-4 py-3 text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="newInterestStatement" className="text-sm font-medium text-[color:var(--ink)]">
                    Plain-English interest
                  </label>
                  <textarea
                    id="newInterestStatement"
                    name="interestStatement"
                    rows={7}
                    placeholder="Example: Watch inference serving, GPU utilization, model routing, and pricing or latency shifts that create infra bottlenecks."
                    className="field-shell rounded-[1.5rem] px-4 py-3 text-sm leading-7"
                  />
                </div>
                <button
                  type="submit"
                  className="button-secondary w-fit"
                >
                  Add profile
                </button>
              </form>
            </div>
          </div>
        </article>
      </section>
      ) : (
        <section className="glass-card rounded-[1.75rem] p-6 sm:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                Public profile
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
                You are viewing {personalizedFeed.selectedProfile.displayName} as a read-only public feed.
                Contact us to create and tune your own profiles.
              </p>
            </div>
            <a href="mailto:michael@audivolt.ai" className="button-primary w-fit">
              Contact us
            </a>
          </div>
        </section>
      )}

      <section
        key={`top-stories-${personalizedFeed.selectedProfile.id}`}
        className="glass-card rounded-[2rem] p-6 sm:p-8"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
              Top stories
            </p>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
              {personalizedFeed.topStoriesSummary
                ? "Pre-computed relevance scores are capped for source diversity, then summarized for the selected profile before you review the individual stories."
                : "Pre-computed relevance scores are capped for source diversity so you can review the most recent high-signal items first."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            <span className="surface-chip px-3 py-2">10 stories</span>
            <span className="surface-chip px-3 py-2">max 5 per source family</span>
            <span className="surface-chip px-3 py-2">{personalizedFeed.selectedProfile.displayName}</span>
          </div>
        </div>

        {personalizedFeed.topStoriesSummary ? (
          <div className="surface-panel-strong mt-6 rounded-[1.25rem] p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                  Profile briefing
                </p>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-[color:var(--ink)] sm:text-base">
                  {personalizedFeed.topStoriesSummary.summary}
                </p>
              </div>
              <span className="surface-chip w-fit max-w-full break-all px-3 py-1 text-left text-xs uppercase tracking-[0.16em]">
                {personalizedFeed.topStoriesSummary.model}
              </span>
            </div>
            {personalizedFeed.topStoriesSummary.takeaways.length > 0 ? (
              <ul className="mt-4 grid gap-2 text-sm leading-6 text-[color:var(--muted)] sm:grid-cols-2">
                {personalizedFeed.topStoriesSummary.takeaways.map((takeaway) => (
                  <li key={takeaway} className="surface-panel rounded-[1rem] px-4 py-3">
                    {takeaway}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid gap-4">
          {personalizedFeed.topDocuments.map((document) => (
            <article
              key={document.id}
              className={`surface-panel rounded-[1.5rem] p-5 transition sm:p-6 ${document.isRead ? "opacity-80" : ""}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[color:var(--leaf)]">
                      {document.sourceName}
                    </p>
                    {document.isRead ? (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        Read{document.readAt ? ` ${formatRelativeTime(document.readAt)}` : ""}
                      </span>
                    ) : null}
                    {document.llmRank ? (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        LLM rank #{document.llmRank}
                      </span>
                    ) : null}
                    {document.matchScore ? (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        Match {formatPercent(document.matchScore)}
                      </span>
                    ) : null}
                  </div>
                  <a
                    href={`/out/${document.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="display-font mt-2 block text-2xl font-semibold tracking-tight"
                  >
                    {document.title}
                  </a>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)] sm:text-base">
                    {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                  </p>
                  {personalizedFeed.showWhyRelevant && document.whyRelevant ? (
                    <div className="surface-panel-strong mt-4 rounded-[1.25rem] p-4">
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
                  <span className="surface-chip w-fit px-3 py-1 text-xs uppercase tracking-[0.18em] sm:ml-auto">
                    {formatCategoryLabel(document.category)}
                  </span>
                  <span className="text-sm text-[color:var(--muted)]">{formatRelativeTime(document.sortTime)}</span>
                  <span className="text-xs text-[color:var(--muted)]">{formatDateTime(document.sortTime)}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {personalizedFeed.remainingDocuments.length > 0 && (
        <MoreStories
          key={`more-stories-${personalizedFeed.selectedProfile.id}`}
          documents={personalizedFeed.remainingDocuments.map((doc) => ({
            id: doc.id,
            title: doc.title,
            canonicalUrl: doc.canonicalUrl,
            sourceName: doc.sourceName,
            category: doc.category,
            sortTime: (doc.sortTime instanceof Date ? doc.sortTime : new Date(doc.sortTime)).toISOString(),
            previewParagraph: doc.previewParagraph,
            matchScore: doc.matchScore,
            whyRelevant: doc.whyRelevant,
            isRead: doc.isRead,
            readAt: doc.readAt ? doc.readAt.toISOString() : null,
          }))}
          showWhyRelevant={personalizedFeed.showWhyRelevant}
        />
      )}

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
              <article key={source.id} className="surface-panel rounded-[1.5rem] p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="display-font text-2xl font-semibold tracking-tight">{source.name}</h2>
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.18em]">
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
                    <div key={endpoint.id} className="surface-panel-strong rounded-2xl p-4">
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
