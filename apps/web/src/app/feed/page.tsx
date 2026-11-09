import Link from "next/link";
import { formatPractitionerTake } from "@ai-intel/shared";
import { getCurrentUser } from "@/lib/auth";
import { loadWebEnv } from "@/lib/env";
import {
  formatCategoryLabel,
  formatDateTime,
  formatPercent,
  formatRelativeTime,
  summarizeText,
} from "@/lib/formatters";
import { getActiveNewsletterSubscriberCount } from "@/lib/newsletter-subscribers";
import {
  getPersonalizedFeedSnapshot,
  getPublicAiEngineerFeedSnapshot,
  isValidTimeWindow,
  type TimeWindow,
} from "@/lib/personalized-feed";
import { listUserReadListDocumentIds } from "@/lib/document-read-list";
import {
  createUserProfileAction,
  deleteUserProfileAction,
  setDefaultUserProfileAction,
  subscribeNewsletterAction,
  updateUserProfileAction,
} from "./actions";
import { FeedStoryActions } from "./feed-story-actions";
import { MoreStories } from "./more-stories";
import { ProfileSelector } from "./profile-selector";

export const dynamic = "force-dynamic";

interface FeedPageProps {
  searchParams?: Promise<{
    error?: string;
    profile?: string;
    window?: string;
    newsletter?: string;
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
  const env = loadWebEnv();
  const currentUser = await getCurrentUser();
  const isPublicView = currentUser === null;
  const params = searchParams ? await searchParams : undefined;
  const selectedProfileSlug = currentUser && typeof params?.profile === "string" ? params.profile : undefined;
  const errorCode = typeof params?.error === "string" ? params.error : undefined;
  const newsletterStatus = typeof params?.newsletter === "string" ? params.newsletter : undefined;
  const rawWindow = typeof params?.window === "string" ? params.window : "week";
  const timeWindow: TimeWindow = isValidTimeWindow(rawWindow) ? rawWindow : "week";
  const profileError =
    errorCode === "duplicate_profile_name"
      ? "That profile name is already used on your account. Choose a unique name for each profile."
      : errorCode === "last_profile_delete"
        ? "You need at least one active profile. Create another profile before deleting this one."
        : errorCode === "profile_limit_exceeded"
          ? "You have reached the maximum of 10 active profiles. Delete an existing profile before creating a new one."
          : null;

  const [personalizedFeed, savedDocumentIds, subscriberCount] = await Promise.all([
    currentUser
      ? getPersonalizedFeedSnapshot(selectedProfileSlug, timeWindow, currentUser.id)
      : getPublicAiEngineerFeedSnapshot(timeWindow),
    currentUser ? listUserReadListDocumentIds(currentUser.id) : Promise.resolve([] as number[]),
    currentUser ? getActiveNewsletterSubscriberCount() : Promise.resolve(0),
  ]);
  const savedDocumentIdSet = new Set(savedDocumentIds);
  const orderedProfiles = [
    personalizedFeed.selectedProfile,
    ...personalizedFeed.profiles.filter((profile) => profile.id !== personalizedFeed.selectedProfile.id),
  ];
  const socialLinks = [
    env.brandXUrl ? { label: "X / Twitter", href: env.brandXUrl } : null,
    env.brandLinkedinUrl ? { label: "LinkedIn", href: env.brandLinkedinUrl } : null,
    env.brandGithubUrl ? { label: "GitHub", href: env.brandGithubUrl } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);

  return (
    <main className="page-shell">
      <section className="glass-card rounded-[2rem] p-6 sm:p-8">
        <div className="flex flex-wrap gap-2">
          <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
            {isPublicView ? "Opinionated curation" : "Ranked top 10"}
          </span>
          <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
            Time-aware
          </span>
          {!isPublicView ? (
            <span className="surface-chip px-3 py-2 text-xs font-medium uppercase tracking-[0.16em]">
              {subscriberCount} email subscriber{subscriberCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="mt-4 text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
          Curated by {env.brandAuthorName}
        </p>
        <div className="mt-4 flex max-w-4xl flex-col gap-3 text-sm leading-7 text-[color:var(--muted)] sm:text-base">
          <p>
            {isPublicView
              ? env.brandAuthorBio
              : "Each profile below stores a plain-English interest statement. Pin must-read stories, hide noise, or add your personal My Take commentary to publish your opinionated shortlist."}
          </p>
          <p>
            Current window: {personalizedFeed.windowLabel}. Screened {personalizedFeed.candidateCount} candidate
            stories.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {!isPublicView ? (
            <Link href="/read-list" className="button-secondary">
              Open read list
            </Link>
          ) : null}
          {socialLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="button-secondary"
            >
              {link.label}
            </a>
          ))}
          <a
            href="/rss.xml"
            target="_blank"
            rel="noopener noreferrer"
            className="button-secondary"
          >
            RSS feed
          </a>
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
                isDefault: profile.isDefault,
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
                  {personalizedFeed.selectedProfile.isDefault
                    ? `Default · Updated ${formatRelativeTime(personalizedFeed.selectedProfile.updatedAt)}`
                    : `Updated ${formatRelativeTime(personalizedFeed.selectedProfile.updatedAt)}`}
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
                    maxLength={80}
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
                    maxLength={2000}
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

              {personalizedFeed.selectedProfile.isDefault ? (
                <div className="surface-panel mt-4 rounded-[1rem] px-4 py-3 text-sm leading-6 text-[color:var(--muted)]">
                  This profile is used by default when you open the feed without choosing a profile.
                </div>
              ) : (
                <form action={setDefaultUserProfileAction} className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <input type="hidden" name="profileId" value={personalizedFeed.selectedProfile.id} />
                  <input type="hidden" name="timeWindow" value={timeWindow} />
                  <p className="max-w-lg text-xs leading-6 text-[color:var(--muted)]">
                    Use this profile automatically when opening the feed without a profile link.
                  </p>
                  <button type="submit" className="button-secondary">
                    Make default
                  </button>
                </form>
              )}

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
                    maxLength={80}
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
                    maxLength={2000}
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                Daily AI brief &amp; RSS
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
                Subscribe to get {env.brandAuthorName}&apos;s curated top stories and practitioner notes delivered to your inbox, or follow the feed via RSS.
              </p>
            </div>
            <form action={subscribeNewsletterAction} className="flex w-full max-w-md flex-wrap gap-2">
              <input type="hidden" name="timeWindow" value={timeWindow} />
              <label htmlFor="newsletterEmail" className="sr-only">
                Email address
              </label>
              <input
                id="newsletterEmail"
                name="email"
                type="email"
                required
                maxLength={254}
                placeholder="you@company.com"
                className="field-shell min-w-[14rem] flex-1 px-4 py-3 text-sm"
              />
              <button type="submit" className="button-primary">
                Subscribe
              </button>
            </form>
          </div>
          {newsletterStatus === "subscribed" ? (
            <div className="surface-panel-strong mt-4 rounded-[1rem] px-4 py-3 text-sm text-[color:var(--leaf)]" role="status">
              You&apos;re subscribed! You&apos;ll receive the next daily curated brief in your inbox.
            </div>
          ) : newsletterStatus === "unsubscribed" ? (
            <div className="surface-panel mt-4 rounded-[1rem] px-4 py-3 text-sm text-[color:var(--muted)]" role="status">
              You have been unsubscribed from the daily email brief.
            </div>
          ) : newsletterStatus === "invalid_email" ? (
            <div className="alert-error mt-4 rounded-[1rem] px-4 py-3 text-sm" role="alert">
              Please enter a valid email address to subscribe.
            </div>
          ) : newsletterStatus === "error" ? (
            <div className="alert-error mt-4 rounded-[1rem] px-4 py-3 text-sm" role="alert">
              Could not complete your subscription right now. Please try again.
            </div>
          ) : null}
        </section>
      )}

      {personalizedFeed.topStoriesSummary ? (
        <section
          key={`trend-highlights-${personalizedFeed.selectedProfile.id}`}
          className="glass-card rounded-[2rem] p-6 sm:p-8"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-[color:var(--leaf)]">
                Today&apos;s Industry Trend · Macro Signal &amp; Insights
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
              <span className="surface-chip px-3 py-2">{personalizedFeed.windowLabel}</span>
              <span className="surface-chip px-3 py-2">{env.brandAuthorName}&apos;s Pulse</span>
              {!isPublicView ? (
                <span className="surface-chip w-fit max-w-full break-all px-3 py-2 text-left">
                  {personalizedFeed.topStoriesSummary.model}
                </span>
              ) : null}
            </div>
          </div>

          <div className="surface-panel-strong mt-5 border-l-4 border-[color:var(--leaf)] rounded-[1.25rem] p-5 sm:p-6">
            {personalizedFeed.topStoriesSummary.takeaways.length > 0 ? (
              <ul className="grid gap-3 text-sm leading-7 text-[color:var(--ink)] sm:text-base">
                {personalizedFeed.topStoriesSummary.takeaways.map((takeaway) => (
                  <li key={takeaway} className="flex gap-3">
                    <span
                      className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--leaf)]"
                      aria-hidden="true"
                    />
                    <span>{takeaway}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="max-w-4xl text-sm leading-7 text-[color:var(--ink)] sm:text-base">
                {personalizedFeed.topStoriesSummary.summary}
              </p>
            )}
          </div>
        </section>
      ) : null}

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
              {isPublicView
                ? `The highest-signal AI engineering, model, and infrastructure stories in this window — each with ${env.brandAuthorName}'s take on the real industry trend and takeaway.`
                : "Pre-computed relevance scores are capped for source diversity so you can review the highest-signal items first."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-[color:var(--muted)]">
            <span className="surface-chip px-3 py-2">Top 10 curated</span>
            {!isPublicView ? (
              <>
                <span className="surface-chip px-3 py-2">max 5 per source family</span>
                <span className="surface-chip px-3 py-2">{personalizedFeed.selectedProfile.displayName}</span>
              </>
            ) : (
              <span className="surface-chip px-3 py-2">For AI Engineers</span>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4">
          {personalizedFeed.topDocuments.map((document) => {
            const takeNote = formatPractitionerTake(document.curatorNote, document.whyRelevant);
            return (
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
                    {document.isPinned ? (
                      <span className="surface-chip px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                        Pinned Pick
                      </span>
                    ) : null}
                    {document.isRead ? (
                      <span className="surface-chip px-3 py-1 text-xs uppercase tracking-[0.16em]">
                        Read{document.readAt ? ` ${formatRelativeTime(document.readAt)}` : ""}
                      </span>
                    ) : null}
                    {!isPublicView && document.llmRank ? (
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
                    rel="noopener noreferrer"
                    className="display-font mt-2 block text-2xl font-semibold tracking-tight"
                  >
                    {document.title}
                  </a>
                  <p className="mt-3 text-sm leading-6 text-[color:var(--muted)] sm:text-base">
                    {summarizeText(document.previewParagraph, "No first paragraph was extracted yet.")}
                  </p>
                  {takeNote ? (
                    <div className="surface-panel-strong mt-4 border-l-4 border-[color:var(--leaf)] rounded-[1.25rem] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--leaf)]">
                        {env.brandAuthorName}&apos;s Take
                      </p>
                      <p className="mt-2 text-sm leading-7 text-[color:var(--ink)] sm:text-base">
                        {takeNote}
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
                  {!isPublicView ? (
                    <FeedStoryActions
                      documentId={document.id}
                      isRead={document.isRead}
                      isInReadList={savedDocumentIdSet.has(document.id)}
                      isPinned={document.isPinned}
                      isHidden={document.isHidden}
                      curatorNote={document.curatorNote}
                      whyRelevant={document.whyRelevant}
                      timeWindow={timeWindow}
                      profileSlug={personalizedFeed.selectedProfile.slug}
                    />
                  ) : null}
                </div>
              </div>
            </article>
            );
          })}
        </div>
      </section>

      {personalizedFeed.remainingDocuments.length > 0 && (
        <MoreStories
          key={`more-stories-${personalizedFeed.selectedProfile.id}`}
          showReadListActions={!isPublicView}
          savedDocumentIds={savedDocumentIds}
          timeWindow={timeWindow}
          profileSlug={personalizedFeed.selectedProfile.slug}
          brandAuthorName={env.brandAuthorName}
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
            curatorNote: doc.curatorNote,
            isPinned: doc.isPinned,
            isHidden: doc.isHidden,
            isRead: doc.isRead,
            readAt: doc.readAt ? doc.readAt.toISOString() : null,
          }))}
          showWhyRelevant={personalizedFeed.showWhyRelevant}
        />
      )}
    </main>
  );
}
