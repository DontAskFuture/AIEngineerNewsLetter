import { and, asc, desc, eq, gt, gte, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import {
  WATCHED_MODEL_PROVIDERS,
  WATCHED_OFFICIAL_SOURCE_SLUGS,
  computeAdjustedStoryScore,
  extractWatchedDocumentModelReleases,
  fetchWatchedOpenRouterModelReleases,
  formatPractitionerTake,
  mergeWatchedModelReleases,
  parseWhyRelevantMetadata,
  readDocumentStoryImage,
  selectDiverseShortlist,
  shouldDisplayTopStoryImage,
  type SendDailyNewsletterPayload,
  type WatchedModelRelease,
} from "@ai-intel/shared";
import { loadWorkerEnv } from "../env";
import { logger } from "../logger";
import { sendTransactionalEmail } from "../services/smtp";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_NEWSLETTER_STORIES = 10;
const MAX_PER_SOURCE = 5;
const MIN_NEWSLETTER_SCORE = 40;
const MODEL_RELEASES_LOOKBACK_DAYS = 7;
const MAX_MODEL_RELEASES = 12;
const WATCHED_LABS_SUMMARY = WATCHED_MODEL_PROVIDERS.map((provider) => provider.shortLabel).join(" · ");
const PUBLIC_CURATOR_EMAIL = "lianglingfan@gmail.com";
const defaultNewsletterProfile = {
  slug: "founding-analyst",
  displayName: "Founding analyst",
  interestStatement:
    "I care about AI coding tools, agent tooling, inference infrastructure, model serving, pricing changes, and stories that reveal product wedges or operational bottlenecks.",
  isDefault: true,
};

export interface NewsletterRecipient {
  userId: number;
  email: string;
  profileId: number;
  profileName: string;
}

export interface NewsletterStory {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  sourceGroupKey: string;
  storyTopic: string | null;
  sortTime: Date;
  score: number | null;
  whyRelevant: string | null;
  curatorNote: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  isPinned: boolean;
  isHidden: boolean;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value);
}

function formatShortDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone,
  }).format(value);
}

function sanitizeStoryUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // Fall through to safe placeholder
  }
  return "#";
}

export function selectTopStories(stories: NewsletterStory[]) {
  return selectDiverseShortlist(stories, {
    limit: MAX_NEWSLETTER_STORIES,
    maxPerSource: MAX_PER_SOURCE,
  });
}

async function getRecipients() {
  const db = getDb();
  const activeUsers = await db
    .select({
      id: schema.authUsers.id,
      email: schema.authUsers.email,
    })
    .from(schema.authUsers)
    .where(eq(schema.authUsers.isActive, true))
    .orderBy(asc(schema.authUsers.id));
  const existingProfileRows = await db
    .select({ userId: schema.userProfiles.userId })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.isActive, true));
  const usersWithProfiles = new Set(existingProfileRows.map((row) => row.userId));

  for (const user of activeUsers) {
    if (usersWithProfiles.has(user.id)) {
      continue;
    }

    try {
      await db
        .insert(schema.userProfiles)
        .values({
          userId: user.id,
          ...defaultNewsletterProfile,
        })
        .onConflictDoNothing({
          target: [schema.userProfiles.userId, schema.userProfiles.slug],
        });
    } catch (error) {
      logger.warn({ userId: user.id, email: user.email, error }, "Failed to create default newsletter profile");
    }
  }

  const rows = await db
    .select({
      userId: schema.authUsers.id,
      email: schema.authUsers.email,
      profileId: schema.userProfiles.id,
      profileName: schema.userProfiles.displayName,
    })
    .from(schema.authUsers)
    .innerJoin(schema.userProfiles, eq(schema.userProfiles.userId, schema.authUsers.id))
    .where(and(eq(schema.authUsers.isActive, true), eq(schema.userProfiles.isActive, true)))
    .orderBy(
      asc(schema.authUsers.id),
      desc(schema.userProfiles.isDefault),
      asc(schema.userProfiles.createdAt),
      asc(schema.userProfiles.id),
    );

  const recipientsByUser = new Map<number, NewsletterRecipient>();

  for (const row of rows) {
    if (!recipientsByUser.has(row.userId)) {
      recipientsByUser.set(row.userId, row);
    }
  }

  return Array.from(recipientsByUser.values());
}

async function hasNewsletterBeenSent(userId: number, newsletterDate: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.newsletterSends.id })
    .from(schema.newsletterSends)
    .where(and(eq(schema.newsletterSends.userId, userId), eq(schema.newsletterSends.newsletterDate, newsletterDate)))
    .limit(1);

  return Boolean(row);
}

async function getRankedStories(profileId: number, userId: number, cutoff: Date) {
  const db = getDb();
  const now = Date.now();
  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      canonicalUrl: schema.documents.canonicalUrl,
      sourceName: schema.sources.name,
      sourceGroupKey: schema.sources.canonicalDomain,
      storyTopic: schema.documents.storyTopic,
      trustTier: schema.sources.trustTier,
      sortTime: documentSortKey,
      metadata: schema.documents.metadata,
      score: schema.documentScores.score,
      whyRelevant: schema.documentScores.whyRelevant,
      curatorNote: schema.storyCurations.curatorNote,
      isPinned: schema.storyCurations.isPinned,
      isHidden: schema.storyCurations.isHidden,
    })
    .from(schema.documentScores)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .leftJoin(
      schema.storyCurations,
      and(
        eq(schema.storyCurations.documentId, schema.documents.id),
        eq(schema.storyCurations.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.documentScores.profileId, profileId),
        or(
          and(gte(schema.documentScores.score, MIN_NEWSLETTER_SCORE), gt(documentSortKey, cutoff)),
          eq(schema.storyCurations.isPinned, true),
        ),
      ),
    )
    .orderBy(desc(schema.documentScores.score), desc(documentSortKey))
    .limit(MAX_CANDIDATE_DOCUMENTS);

  const scoredCandidates = rows
    .map((row) => {
      const sortTime = new Date(row.sortTime);
      const parsedMeta = parseWhyRelevantMetadata(row.whyRelevant);
      const storyImage = readDocumentStoryImage(row.metadata);
      const adjustedScore = computeAdjustedStoryScore({
        score: row.score,
        sortTime,
        cutoff,
        now,
        freshnessBoostMax: 12,
        trustTier: row.trustTier,
        confidence: parsedMeta.confidence,
        minQualifyingScore: MIN_NEWSLETTER_SCORE,
      });

      return {
        id: row.id,
        title: row.title,
        canonicalUrl: sanitizeStoryUrl(row.canonicalUrl),
        sourceName: row.sourceName,
        sourceGroupKey: row.sourceGroupKey,
        storyTopic: row.storyTopic,
        sortTime,
        score: row.score,
        adjustedScore: adjustedScore ?? row.score,
        whyRelevant: parsedMeta.whyRelevant || null,
        curatorNote: row.curatorNote?.trim() || null,
        imageUrl: storyImage?.imageUrl ?? null,
        imageAlt: storyImage?.imageAlt ?? null,
        isPinned: Boolean(row.isPinned),
        isHidden: Boolean(row.isHidden),
      };
    })
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const scoreDiff = (b.adjustedScore ?? 0) - (a.adjustedScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.sortTime.getTime() - a.sortTime.getTime();
    });

  return selectTopStories(scoredCandidates);
}

async function getLatestFallbackStories(userId: number, cutoff: Date) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      canonicalUrl: schema.documents.canonicalUrl,
      sourceName: schema.sources.name,
      sourceGroupKey: schema.sources.canonicalDomain,
      storyTopic: schema.documents.storyTopic,
      sortTime: documentSortKey,
      metadata: schema.documents.metadata,
      curatorNote: schema.storyCurations.curatorNote,
      isPinned: schema.storyCurations.isPinned,
      isHidden: schema.storyCurations.isHidden,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .leftJoin(
      schema.storyCurations,
      and(
        eq(schema.storyCurations.documentId, schema.documents.id),
        eq(schema.storyCurations.userId, userId),
      ),
    )
    .where(or(gt(documentSortKey, cutoff), eq(schema.storyCurations.isPinned, true)))
    .orderBy(desc(documentSortKey))
    .limit(MAX_CANDIDATE_DOCUMENTS);

  return selectTopStories(
    rows.map((row) => {
      const storyImage = readDocumentStoryImage(row.metadata);
      return {
        id: row.id,
        title: row.title,
        canonicalUrl: sanitizeStoryUrl(row.canonicalUrl),
        sourceName: row.sourceName,
        sourceGroupKey: row.sourceGroupKey,
        storyTopic: row.storyTopic,
        sortTime: new Date(row.sortTime),
        score: null,
        whyRelevant: null,
        curatorNote: row.curatorNote?.trim() || null,
        imageUrl: storyImage?.imageUrl ?? null,
        imageAlt: storyImage?.imageAlt ?? null,
        isPinned: Boolean(row.isPinned),
        isHidden: Boolean(row.isHidden),
      };
    }),
  );
}

const DEFAULT_BRAND_AUTHOR_NAME = "Michael";
const DEFAULT_BRAND_AUTHOR_BIO =
  "AI engineering curation — high-signal papers, model releases, agent tooling, and inference infrastructure, with practical notes on why each story matters.";

function resolveBrandSettings() {
  const authorName = process.env.BRAND_AUTHOR_NAME?.trim() || DEFAULT_BRAND_AUTHOR_NAME;
  const authorBio = process.env.BRAND_AUTHOR_BIO?.trim() || DEFAULT_BRAND_AUTHOR_BIO;
  const baseUrl = (process.env.APP_BASE_URL?.trim() || "https://news.michaelliang.dev").replace(/\/+$/, "");
  const xUrl = process.env.BRAND_X_URL?.trim() || null;
  const linkedinUrl = process.env.BRAND_LINKEDIN_URL?.trim() || null;
  const githubUrl = process.env.BRAND_GITHUB_URL?.trim() || null;

  return { authorName, authorBio, baseUrl, xUrl, linkedinUrl, githubUrl };
}

async function getProfileTrendBullets(profileId: number): Promise<string[]> {
  try {
    const db = getDb();
    const [cached] = await db
      .select({ rankingJson: schema.rankingCache.rankingJson })
      .from(schema.rankingCache)
      .where(and(eq(schema.rankingCache.profileId, profileId), gt(schema.rankingCache.expiresAt, new Date())))
      .orderBy(desc(schema.rankingCache.createdAt))
      .limit(1);

    const record =
      cached?.rankingJson && typeof cached.rankingJson === "object"
        ? (cached.rankingJson as Record<string, unknown>)
        : null;
    if (!record || !Array.isArray(record.takeaways)) {
      return [];
    }

    return record.takeaways
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}

export async function getRecentWatchedModelReleases(
  userId: number,
  options?: {
    lookbackDays?: number;
    preloadedOpenRouterReleases?: WatchedModelRelease[];
  },
): Promise<WatchedModelRelease[]> {
  try {
    const env = loadWorkerEnv();
    const db = getDb();
    const lookbackDays = options?.lookbackDays ?? MODEL_RELEASES_LOOKBACK_DAYS;
    const now = new Date();
    const cutoff = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const officialSlugs = [...WATCHED_OFFICIAL_SOURCE_SLUGS];
    const [docRows, openRouterReleases] = await Promise.all([
      db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          canonicalUrl: schema.documents.canonicalUrl,
          sourceName: schema.sources.name,
          sourceSlug: schema.sources.slug,
          category: schema.sources.category,
          storyTopic: schema.documents.storyTopic,
          sortTime: documentSortKey,
          isHidden: schema.storyCurations.isHidden,
        })
        .from(schema.documents)
        .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
        .leftJoin(
          schema.storyCurations,
          and(
            eq(schema.storyCurations.documentId, schema.documents.id),
            eq(schema.storyCurations.userId, userId),
          ),
        )
        .where(
          and(
            gt(documentSortKey, cutoff),
            officialSlugs.length > 0
              ? or(eq(schema.documents.storyTopic, "models"), inArray(schema.sources.slug, officialSlugs))
              : eq(schema.documents.storyTopic, "models"),
          ),
        )
        .orderBy(desc(documentSortKey))
        .limit(MAX_CANDIDATE_DOCUMENTS),
      options?.preloadedOpenRouterReleases !== undefined
        ? Promise.resolve(options.preloadedOpenRouterReleases)
        : fetchWatchedOpenRouterModelReleases({
            cutoffDate: cutoff,
            now,
            apiKey: env.OPENROUTER_API_KEY,
          }),
    ]);

    const documentReleases = extractWatchedDocumentModelReleases(
      docRows.map((row) => ({
        id: row.id,
        title: row.title,
        canonicalUrl: row.canonicalUrl,
        sourceName: row.sourceName,
        sourceSlug: row.sourceSlug,
        category: row.category,
        storyTopic: row.storyTopic,
        sortTime: new Date(row.sortTime),
        isHidden: Boolean(row.isHidden),
      })),
      { cutoffDate: cutoff, now },
    );

    return mergeWatchedModelReleases(openRouterReleases, documentReleases, {
      limit: MAX_MODEL_RELEASES,
    });
  } catch (error) {
    logger.warn({ userId, error }, "Failed to load watched AI model releases for newsletter");
    return [];
  }
}

export function buildNewsletterHtml(
  recipient: NewsletterRecipient,
  stories: NewsletterStory[],
  newsletterDate: string,
  unsubscribeUrl?: string,
  timeZone?: string,
  trendBullets: string[] = [],
  modelReleases: WatchedModelRelease[] = [],
) {
  const resolvedTimeZone = timeZone ?? loadWorkerEnv().APP_TIME_ZONE;
  const brand = resolveBrandSettings();
  const feedUrl = `${brand.baseUrl}/feed`;
  const rssUrl = `${brand.baseUrl}/rss.xml`;

  const socialLinks = [
    `<a href="${escapeHtml(feedUrl)}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">Web Feed</a>`,
    `<a href="${escapeHtml(rssUrl)}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">RSS</a>`,
    brand.xUrl ? `<a href="${escapeHtml(sanitizeStoryUrl(brand.xUrl))}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">X</a>` : null,
    brand.linkedinUrl
      ? `<a href="${escapeHtml(sanitizeStoryUrl(brand.linkedinUrl))}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">LinkedIn</a>`
      : null,
    brand.githubUrl
      ? `<a href="${escapeHtml(sanitizeStoryUrl(brand.githubUrl))}" style="color:#2e5b4f;text-decoration:none;font-weight:600;">GitHub</a>`
      : null,
  ]
    .filter(Boolean)
    .join(' &nbsp;·&nbsp; ');

  const trendSection =
    trendBullets.length > 0
      ? `
        <div style="margin:0 0 28px 0;padding:18px 20px;background:#eef5f2;border-left:4px solid #2e5b4f;border-radius:14px;">
          <p style="margin:0 0 10px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;">
            Today's Industry Trend · Macro Signal &amp; Insights
          </p>
          <ul style="margin:0;padding-left:18px;color:#182126;font-size:15px;line-height:1.6;">
            ${trendBullets
              .map(
                (bullet) =>
                  `<li style="margin:0 0 8px 0;">${escapeHtml(bullet)}</li>`,
              )
              .join("")}
          </ul>
        </div>
      `
      : "";

  const modelReleasesSection =
    modelReleases.length > 0
      ? `
        <div style="margin:0 0 28px 0;padding:18px 20px;background:#f8f5ec;border:1px solid #e3dccd;border-left:4px solid #2e5b4f;border-radius:14px;">
          <p style="margin:0 0 4px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.16em;">
            New AI Model Releases · Watched Labs (Last ${MODEL_RELEASES_LOOKBACK_DAYS} Days)
          </p>
          <p style="margin:0 0 14px 0;color:#5f6a6f;font-size:11px;line-height:1.5;">
            Tracking ${escapeHtml(WATCHED_LABS_SUMMARY)}
          </p>
          <ul style="margin:0;padding:0;list-style:none;">
            ${modelReleases
              .map((release, idx) => {
                const detailParts = [
                  release.contextLabel,
                  release.pricingLabel,
                  release.origin === "announcement" ? release.sourceLabel : release.modelId,
                ].filter((part): part is string => Boolean(part));
                const announcementLink =
                  release.announcementUrl && release.announcementUrl !== release.url
                    ? ` &nbsp;·&nbsp; <a href="${escapeHtml(sanitizeStoryUrl(release.announcementUrl))}" style="color:#2e5b4f;text-decoration:underline;font-weight:600;">Official post</a>`
                    : "";
                const borderStyle = idx < modelReleases.length - 1 ? "border-bottom:1px solid #e3dccd;padding:0 0 11px 0;margin:0 0 11px 0;" : "padding:0;margin:0;";
                return `
                  <li style="${borderStyle}">
                    <p style="margin:0 0 4px 0;font-size:11px;line-height:1.4;">
                      <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#eef5f2;border:1px solid #cfe0d8;color:#2e5b4f;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(release.providerLabel)}</span>${
                        release.isNew
                          ? ` &nbsp;<span style="display:inline-block;padding:2px 6px;border-radius:999px;background:#2e5b4f;color:#fffaf0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">NEW</span>`
                          : ""
                      }
                      <span style="color:#5f6a6f;"> &nbsp;·&nbsp; ${escapeHtml(formatShortDate(release.releasedAt, resolvedTimeZone))}</span>
                    </p>
                    <a href="${escapeHtml(sanitizeStoryUrl(release.url))}" style="color:#182126;font-size:15px;font-weight:700;text-decoration:none;line-height:1.35;">
                      ${escapeHtml(release.modelName)}
                    </a>
                    ${
                      detailParts.length > 0 || announcementLink
                        ? `<p style="margin:4px 0 0 0;color:#5f6a6f;font-size:12px;line-height:1.45;">${escapeHtml(detailParts.join(" · "))}${announcementLink}</p>`
                        : ""
                    }
                  </li>
                `;
              })
              .join("")}
          </ul>
        </div>
      `
      : "";

  const storyItems = stories
    .map(
      (story, index) => `
        <li style="margin:0 0 24px 0;padding:0 0 20px 0;border-bottom:1px solid #e5e7eb;">
          <p style="margin:0 0 6px 0;color:#2e5b4f;font-size:12px;text-transform:uppercase;letter-spacing:0.12em;">
            ${index + 1}. ${escapeHtml(story.sourceName)}${story.isPinned ? " · Pinned Pick" : ""}${story.score ? ` · Match ${story.score}/100` : ""}
          </p>
          <a href="${escapeHtml(story.canonicalUrl)}" style="color:#182126;font-size:20px;font-weight:700;text-decoration:none;">
            ${escapeHtml(story.title)}
          </a>
          <p style="margin:8px 0 0 0;color:#5f6a6f;font-size:13px;">
            ${escapeHtml(formatDate(story.sortTime, resolvedTimeZone))}
          </p>
          ${(() => {
            const validStoryImage = readDocumentStoryImage(
              story.imageUrl ? { imageUrl: story.imageUrl, imageAlt: story.imageAlt ?? null } : null,
            );
            if (!shouldDisplayTopStoryImage(index, story.isPinned, validStoryImage) || !validStoryImage) {
              return "";
            }
            const altText = validStoryImage.imageAlt ?? `${story.title} diagram`;
            return `<div style="margin:12px 0 0 0;border:1px solid #e3dccd;border-radius:12px;overflow:hidden;background:#fbfaf6;">
                <a href="${escapeHtml(story.canonicalUrl)}" style="display:block;text-decoration:none;">
                  <img src="${escapeHtml(validStoryImage.imageUrl)}" alt="${escapeHtml(altText)}" referrerpolicy="no-referrer" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
                </a>
                ${
                  validStoryImage.imageAlt
                    ? `<p style="margin:0;padding:8px 12px;background:#fffaf0;border-top:1px solid #e3dccd;color:#5f6a6f;font-size:12px;line-height:1.45;">${escapeHtml(validStoryImage.imageAlt)}</p>`
                    : ""
                }
              </div>`;
          })()}
          ${(() => {
            const take = formatPractitionerTake(story.curatorNote, story.whyRelevant);
            return take
              ? `<div style="margin:10px 0 0 0;padding:12px 14px;background:#eef5f2;border-left:3px solid #2e5b4f;border-radius:8px;">
                  <p style="margin:0 0 4px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;">${escapeHtml(brand.authorName)}'s Take</p>
                  <p style="margin:0;color:#182126;font-size:15px;line-height:1.55;">${escapeHtml(take)}</p>
                </div>`
              : "";
          })()}
        </li>
      `,
    )
    .join("");

  const emptyState = `
    <p style="margin:0;color:#5f6a6f;font-size:16px;line-height:1.6;">
      No new stories were found in the last 24 hours for this profile. The crawler will keep watching sources and try again tomorrow.
    </p>
  `;

  const footerHtml = `
    <div style="margin:24px 0 0 0;padding-top:16px;border-top:1px solid #e3dccd;color:#5f6a6f;font-size:12px;line-height:1.6;">
      <p style="margin:0 0 6px 0;">
        Curated by <strong style="color:#182126;">${escapeHtml(brand.authorName)}</strong> · ${socialLinks}
      </p>
      ${
        unsubscribeUrl
          ? `<p style="margin:0;">
              You are subscribed to ${escapeHtml(brand.authorName)}'s Newsletter. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#2e5b4f;text-decoration:underline;">Unsubscribe in one click</a>.
            </p>`
          : ""
      }
    </div>
  `;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,sans-serif;color:#182126;">
        <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
          <div style="background:#fffaf0;border:1px solid #e3dccd;border-radius:24px;padding:28px;">
            <p style="margin:0 0 8px 0;color:#2e5b4f;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;">
              ${escapeHtml(brand.authorName)}'s Newsletter · ${escapeHtml(newsletterDate)}
            </p>
            <h1 style="margin:0;color:#182126;font-size:30px;line-height:1.15;">What AI Engineers Should Read Today</h1>
            <p style="margin:10px 0 14px 0;color:#5f6a6f;font-size:15px;line-height:1.6;">
              ${escapeHtml(brand.authorBio)}
            </p>
            <p style="margin:0 0 24px 0;font-size:13px;color:#2e5b4f;">
              ${socialLinks}
            </p>
            ${trendSection}
            ${modelReleasesSection}
            ${stories.length > 0 ? `<ol style="margin:0;padding-left:22px;">${storyItems}</ol>` : emptyState}
            ${footerHtml}
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildNewsletterText(
  recipient: NewsletterRecipient,
  stories: NewsletterStory[],
  newsletterDate: string,
  unsubscribeUrl?: string,
  timeZone?: string,
  trendBullets: string[] = [],
  modelReleases: WatchedModelRelease[] = [],
) {
  const resolvedTimeZone = timeZone ?? loadWorkerEnv().APP_TIME_ZONE;
  const brand = resolveBrandSettings();
  const lines = [
    `${brand.authorName}'s Newsletter (${newsletterDate})`,
    "What AI Engineers Should Read Today",
    brand.authorBio,
    `Web: ${brand.baseUrl}/feed | RSS: ${brand.baseUrl}/rss.xml`,
    "",
  ];

  if (trendBullets.length > 0) {
    lines.push("TODAY'S INDUSTRY TREND · MACRO SIGNAL & INSIGHTS");
    trendBullets.forEach((bullet) => {
      lines.push(`- ${bullet}`);
    });
    lines.push("");
  }

  if (modelReleases.length > 0) {
    lines.push(`NEW AI MODEL RELEASES (WATCHED LABS · LAST ${MODEL_RELEASES_LOOKBACK_DAYS} DAYS)`);
    modelReleases.forEach((release) => {
      const specs = [
        formatShortDate(release.releasedAt, resolvedTimeZone),
        release.contextLabel,
        release.pricingLabel,
        release.origin === "announcement" ? release.sourceLabel : release.modelId,
      ].filter((part): part is string => Boolean(part));
      lines.push(
        `- [${release.providerLabel}]${release.isNew ? " [NEW]" : ""} ${release.modelName} (${specs.join(" · ")})`,
      );
      lines.push(`  ${sanitizeStoryUrl(release.url)}`);
      if (release.announcementUrl && release.announcementUrl !== release.url) {
        lines.push(`  Official post: ${sanitizeStoryUrl(release.announcementUrl)}`);
      }
    });
    lines.push("");
  }

  if (stories.length === 0) {
    lines.push("No new stories were found in the last 24 hours for this profile.");
    if (unsubscribeUrl) {
      lines.push("", `Unsubscribe: ${unsubscribeUrl}`);
    }
    return lines.join("\n");
  }

  stories.forEach((story, index) => {
    lines.push(`${index + 1}. ${story.title}${story.isPinned ? " [Pinned Pick]" : ""}`);
    lines.push(`${story.sourceName}${story.score ? ` · Match ${story.score}/100` : ""}`);
    lines.push(formatDate(story.sortTime, resolvedTimeZone));
    const take = formatPractitionerTake(story.curatorNote, story.whyRelevant);
    if (take) {
      lines.push(`${brand.authorName}'s Take: ${take}`);
    }
    lines.push(story.canonicalUrl);
    lines.push("");
  });

  if (unsubscribeUrl) {
    lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  }

  return lines.join("\n");
}

async function recordNewsletterSend(
  recipient: NewsletterRecipient,
  newsletterDate: string,
  storyCount: number,
  providerMessageId: string | null,
) {
  const db = getDb();
  await db
    .insert(schema.newsletterSends)
    .values({
      userId: recipient.userId,
      profileId: recipient.profileId,
      newsletterDate,
      recipientEmail: recipient.email,
      storyCount,
      providerMessageId,
    })
    .onConflictDoNothing({
      target: [schema.newsletterSends.userId, schema.newsletterSends.newsletterDate],
    });
}

export async function sendDailyNewsletter({ newsletterDate }: SendDailyNewsletterPayload) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newsletterDate)) {
    throw new Error(`Invalid newsletterDate format: ${newsletterDate}`);
  }
  const env = loadWorkerEnv();
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const modelReleaseCutoff = new Date(Date.now() - MODEL_RELEASES_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const [recipients, openRouterModelReleases] = await Promise.all([
    getRecipients(),
    fetchWatchedOpenRouterModelReleases({
      cutoffDate: modelReleaseCutoff,
      apiKey: env.OPENROUTER_API_KEY,
    }),
  ]);
  const modelReleasesByUser = new Map<number, WatchedModelRelease[]>();
  const getReleasesForUser = async (userId: number) => {
    const cached = modelReleasesByUser.get(userId);
    if (cached) return cached;
    const loaded = await getRecentWatchedModelReleases(userId, {
      lookbackDays: MODEL_RELEASES_LOOKBACK_DAYS,
      preloadedOpenRouterReleases: openRouterModelReleases,
    });
    modelReleasesByUser.set(userId, loaded);
    return loaded;
  };
  let sentCount = 0;
  let skippedCount = 0;
  const activeAuthEmails = new Set(recipients.map((r) => r.email.toLowerCase()));
  const baseUrl = env.APP_BASE_URL.replace(/\/+$/, "");

  for (const recipient of recipients) {
    if (await hasNewsletterBeenSent(recipient.userId, newsletterDate)) {
      skippedCount += 1;
      continue;
    }

    const [rankedStories, trendBullets, modelReleases] = await Promise.all([
      getRankedStories(recipient.profileId, recipient.userId, cutoff),
      getProfileTrendBullets(recipient.profileId),
      getReleasesForUser(recipient.userId),
    ]);
    const stories = rankedStories.length > 0 ? rankedStories : await getLatestFallbackStories(recipient.userId, cutoff);
    const subject = `${env.BRAND_AUTHOR_NAME}'s Newsletter: ${stories.length} stories for ${newsletterDate}`;
    const unsubscribeUrl = `${baseUrl}/feed/unsubscribe?token=account-${recipient.userId}`;
    const result = await sendTransactionalEmail({
      to: { email: recipient.email },
      subject,
      html: buildNewsletterHtml(
        recipient,
        stories,
        newsletterDate,
        unsubscribeUrl,
        env.APP_TIME_ZONE,
        trendBullets,
        modelReleases,
      ),
      text: buildNewsletterText(
        recipient,
        stories,
        newsletterDate,
        unsubscribeUrl,
        env.APP_TIME_ZONE,
        trendBullets,
        modelReleases,
      ),
      unsubscribeUrl,
    });

    await recordNewsletterSend(recipient, newsletterDate, stories.length, result.providerMessageId);
    sentCount += 1;
  }

  const publicCurator =
    recipients.find((r) => r.email.toLowerCase() === PUBLIC_CURATOR_EMAIL) ?? recipients[0];

  if (publicCurator) {
    const subscribers = await db
      .select({
        id: schema.newsletterSubscribers.id,
        email: schema.newsletterSubscribers.email,
        unsubscribeToken: schema.newsletterSubscribers.unsubscribeToken,
        lastSentDate: schema.newsletterSubscribers.lastSentDate,
      })
      .from(schema.newsletterSubscribers)
      .where(eq(schema.newsletterSubscribers.isActive, true))
      .orderBy(asc(schema.newsletterSubscribers.id));

    const pendingSubscribers = subscribers.filter(
      (sub) =>
        sub.lastSentDate !== newsletterDate &&
        !activeAuthEmails.has(sub.email.toLowerCase()),
    );

    if (pendingSubscribers.length > 0) {
      const [rankedStories, trendBullets, modelReleases] = await Promise.all([
        getRankedStories(publicCurator.profileId, publicCurator.userId, cutoff),
        getProfileTrendBullets(publicCurator.profileId),
        getReleasesForUser(publicCurator.userId),
      ]);
      const stories =
        rankedStories.length > 0
          ? rankedStories
          : await getLatestFallbackStories(publicCurator.userId, cutoff);
      const subject = `${env.BRAND_AUTHOR_NAME}'s Newsletter: ${stories.length} stories for ${newsletterDate}`;

      for (const subscriber of pendingSubscribers) {
        const unsubscribeUrl = `${baseUrl}/feed/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`;
        await sendTransactionalEmail({
          to: { email: subscriber.email },
          subject,
          html: buildNewsletterHtml(
            publicCurator,
            stories,
            newsletterDate,
            unsubscribeUrl,
            env.APP_TIME_ZONE,
            trendBullets,
            modelReleases,
          ),
          text: buildNewsletterText(
            publicCurator,
            stories,
            newsletterDate,
            unsubscribeUrl,
            env.APP_TIME_ZONE,
            trendBullets,
            modelReleases,
          ),
          unsubscribeUrl,
        });

        await db
          .update(schema.newsletterSubscribers)
          .set({
            lastSentDate: newsletterDate,
            updatedAt: new Date(),
          })
          .where(eq(schema.newsletterSubscribers.id, subscriber.id));

        sentCount += 1;
      }
    }
  }

  logger.info(
    {
      newsletterDate,
      sentCount,
      skippedCount,
      recipientCount: recipients.length,
      appTimeZone: env.APP_TIME_ZONE,
    },
    "Daily newsletter job completed",
  );

  return { sentCount, skippedCount };
}
