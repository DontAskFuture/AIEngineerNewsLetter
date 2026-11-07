import { and, asc, desc, eq, gt, gte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import {
  computeAdjustedStoryScore,
  normalizeStoryTitle,
  parseWhyRelevantMetadata,
  type SendDailyNewsletterPayload,
} from "@ai-intel/shared";
import { loadWorkerEnv } from "../env";
import { logger } from "../logger";
import { sendTransactionalEmail } from "../services/smtp";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_NEWSLETTER_STORIES = 10;
const MAX_PER_SOURCE = 5;
const MIN_NEWSLETTER_SCORE = 40;
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
  sortTime: Date;
  score: number | null;
  whyRelevant: string | null;
  curatorNote: string | null;
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
  const sourceCounts = new Map<string, number>();
  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  const selected: NewsletterStory[] = [];

  const pinnedStories = stories.filter((story) => story.isPinned && !story.isHidden);
  const regularStories = stories.filter((story) => !story.isPinned && !story.isHidden);

  for (const story of [...pinnedStories, ...regularStories]) {
    if (seenIds.has(story.id)) {
      continue;
    }

    const normalizedTitle = normalizeStoryTitle(story.title);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      continue;
    }

    const count = sourceCounts.get(story.sourceGroupKey) ?? 0;

    if (!story.isPinned && count >= MAX_PER_SOURCE) {
      continue;
    }

    selected.push(story);
    seenIds.add(story.id);
    sourceCounts.set(story.sourceGroupKey, count + 1);
    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }

    if (selected.length >= MAX_NEWSLETTER_STORIES) {
      break;
    }
  }

  return selected;
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
      trustTier: schema.sources.trustTier,
      sortTime: documentSortKey,
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
        sortTime,
        score: row.score,
        adjustedScore: adjustedScore ?? row.score,
        whyRelevant: parsedMeta.whyRelevant || null,
        curatorNote: row.curatorNote?.trim() || null,
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
      sortTime: documentSortKey,
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
    rows.map((row) => ({
      id: row.id,
      title: row.title,
      canonicalUrl: sanitizeStoryUrl(row.canonicalUrl),
      sourceName: row.sourceName,
      sourceGroupKey: row.sourceGroupKey,
      sortTime: new Date(row.sortTime),
      score: null,
      whyRelevant: null,
      curatorNote: row.curatorNote?.trim() || null,
      isPinned: Boolean(row.isPinned),
      isHidden: Boolean(row.isHidden),
    })),
  );
}

export function buildNewsletterHtml(
  recipient: NewsletterRecipient,
  stories: NewsletterStory[],
  newsletterDate: string,
  unsubscribeUrl?: string,
  timeZone?: string,
) {
  const resolvedTimeZone = timeZone ?? loadWorkerEnv().APP_TIME_ZONE;
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
          ${
            story.curatorNote
              ? `<div style="margin:10px 0 0 0;padding:12px 14px;background:#eef5f2;border-left:3px solid #2e5b4f;border-radius:8px;">
                  <p style="margin:0 0 4px 0;color:#2e5b4f;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;">Curator's Take</p>
                  <p style="margin:0;color:#182126;font-size:15px;line-height:1.55;">${escapeHtml(story.curatorNote)}</p>
                </div>`
              : story.whyRelevant
                ? `<p style="margin:10px 0 0 0;color:#42525b;font-size:15px;line-height:1.55;">${escapeHtml(story.whyRelevant)}</p>`
                : ""
          }
        </li>
      `,
    )
    .join("");

  const emptyState = `
    <p style="margin:0;color:#5f6a6f;font-size:16px;line-height:1.6;">
      No new stories were found in the last 24 hours for this profile. The crawler will keep watching sources and try again tomorrow.
    </p>
  `;

  const unsubscribeFooter = unsubscribeUrl
    ? `<p style="margin:24px 0 0 0;padding-top:16px;border-top:1px solid #e3dccd;color:#5f6a6f;font-size:12px;line-height:1.6;">
        You are subscribed to this curated AI intelligence brief. <a href="${escapeHtml(unsubscribeUrl)}" style="color:#2e5b4f;text-decoration:underline;">Unsubscribe in one click</a>.
      </p>`
    : "";

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f6f1e7;font-family:Arial,sans-serif;color:#182126;">
        <div style="max-width:680px;margin:0 auto;padding:32px 20px;">
          <div style="background:#fffaf0;border:1px solid #e3dccd;border-radius:24px;padding:28px;">
            <p style="margin:0 0 8px 0;color:#2e5b4f;font-size:12px;text-transform:uppercase;letter-spacing:0.18em;">
              Daily AI intelligence brief
            </p>
            <h1 style="margin:0;color:#182126;font-size:30px;line-height:1.15;">Top stories for ${escapeHtml(recipient.profileName)}</h1>
            <p style="margin:12px 0 24px 0;color:#5f6a6f;font-size:15px;line-height:1.6;">
              ${escapeHtml(newsletterDate)} · Selected from your first saved interest profile.
            </p>
            ${stories.length > 0 ? `<ol style="margin:0;padding-left:22px;">${storyItems}</ol>` : emptyState}
            ${unsubscribeFooter}
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
) {
  const resolvedTimeZone = timeZone ?? loadWorkerEnv().APP_TIME_ZONE;
  const lines = [
    `Daily AI intelligence brief for ${recipient.profileName}`,
    newsletterDate,
    "",
  ];

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
    if (story.curatorNote) {
      lines.push(`Curator's Take: ${story.curatorNote}`);
    } else if (story.whyRelevant) {
      lines.push(story.whyRelevant);
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
  const recipients = await getRecipients();
  let sentCount = 0;
  let skippedCount = 0;
  const activeAuthEmails = new Set(recipients.map((r) => r.email.toLowerCase()));

  for (const recipient of recipients) {
    if (await hasNewsletterBeenSent(recipient.userId, newsletterDate)) {
      skippedCount += 1;
      continue;
    }

    const rankedStories = await getRankedStories(recipient.profileId, recipient.userId, cutoff);
    const stories = rankedStories.length > 0 ? rankedStories : await getLatestFallbackStories(recipient.userId, cutoff);
    const subject = `Your AI brief: ${stories.length} stories for ${newsletterDate}`;
    const result = await sendTransactionalEmail({
      to: { email: recipient.email },
      subject,
      html: buildNewsletterHtml(recipient, stories, newsletterDate),
      text: buildNewsletterText(recipient, stories, newsletterDate),
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
      const rankedStories = await getRankedStories(publicCurator.profileId, publicCurator.userId, cutoff);
      const stories =
        rankedStories.length > 0
          ? rankedStories
          : await getLatestFallbackStories(publicCurator.userId, cutoff);
      const subject = `Your AI brief: ${stories.length} stories for ${newsletterDate}`;
      const baseUrl = env.APP_BASE_URL.replace(/\/+$/, "");

      for (const subscriber of pendingSubscribers) {
        const unsubscribeUrl = `${baseUrl}/feed/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`;
        await sendTransactionalEmail({
          to: { email: subscriber.email },
          subject,
          html: buildNewsletterHtml(publicCurator, stories, newsletterDate, unsubscribeUrl),
          text: buildNewsletterText(publicCurator, stories, newsletterDate, unsubscribeUrl),
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
