import { createHash } from "node:crypto";
import {
  DEFAULT_FURTHER_STUDY_TEXT,
  MAX_INTEREST_STATEMENT_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  computeAdjustedStoryScore,
  extractDocumentPreview,
  normalizeStoryTitle,
  parseWhyRelevantMetadata,
  type SourceCategory,
} from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, asc, desc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { enqueueProfileScoring } from "@/lib/crawler";
import { loadWebEnv } from "@/lib/env";
import { summarizeTopStoriesForProfile } from "@/lib/openrouter";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_SELECTED_DOCUMENTS = 10;
const MAX_PER_SOURCE = 5;
const MIN_TOP_STORY_SCORE = 40;
const MAX_ACTIVE_PROFILES_PER_USER = 10;
export const MAX_CURATOR_NOTE_LENGTH = 1000;
const PUBLIC_FEED_OWNER_EMAIL = "lianglingfan@gmail.com";
const PUBLIC_FEED_PROFILE_SLUG = "founding-analyst";
const PUBLIC_FEED_CACHE_TTL_MS = 30_000;
const TOP_STORIES_SUMMARY_CACHE_PREFIX = "top-stories-summary:v4";
const TOP_STORIES_SUMMARY_CACHE_TTL_HOURS = 24;
const SUMMARY_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
const summaryFailureCooldownUntil = new Map<number, number>();

export type TimeWindow = "day" | "week" | "month" | "quarter" | "year";

const FRESHNESS_BOOST_BY_WINDOW: Record<TimeWindow, number> = {
  day: 12,
  week: 10,
  month: 6,
  quarter: 4,
  year: 2,
};

const TIME_WINDOW_LABELS: Record<TimeWindow, string> = {
  day: "Last 24 hours",
  week: "Last 7 days",
  month: "Last 30 days",
  quarter: "Last 90 days",
  year: "Last 365 days",
};

function getTimeWindowCutoff(window: TimeWindow): Date {
  const now = new Date();
  const daysMap: Record<TimeWindow, number> = {
    day: 1,
    week: 7,
    month: 30,
    quarter: 90,
    year: 365,
  };
  return new Date(now.getTime() - daysMap[window] * 24 * 60 * 60 * 1000);
}

export function isValidTimeWindow(value: string): value is TimeWindow {
  return ["day", "week", "month", "quarter", "year"].includes(value);
}

const defaultUserProfile = {
  slug: "founding-analyst",
  displayName: "Founding analyst",
  interestStatement:
    "I care about AI coding tools, agent tooling, inference infrastructure, model serving, pricing changes, and stories that reveal product wedges or operational bottlenecks.",
  isDefault: true,
};

const PROFILE_NAME_UNIQUE_INDEX = "user_profiles_user_display_name_idx";

export class DuplicateProfileNameError extends Error {
  profileSlug: string | null;

  constructor(displayName: string, profileSlug?: string | null) {
    super(`A profile named "${displayName}" already exists for this user.`);
    this.name = "DuplicateProfileNameError";
    this.profileSlug = profileSlug ?? null;
  }
}

export class LastProfileDeleteError extends Error {
  profileSlug: string | null;

  constructor(profileSlug?: string | null) {
    super("At least one active profile is required.");
    this.name = "LastProfileDeleteError";
    this.profileSlug = profileSlug ?? null;
  }
}

export class ProfileLimitExceededError extends Error {
  constructor() {
    super(`A user may have at most ${MAX_ACTIVE_PROFILES_PER_USER} active profiles.`);
    this.name = "ProfileLimitExceededError";
  }
}

function comparePinnedDocs(
  a: PersonalizedFeedDocument,
  b: PersonalizedFeedDocument,
) {
  const aPinnedTime = a.pinnedAt ? a.pinnedAt.getTime() : 0;
  const bPinnedTime = b.pinnedAt ? b.pinnedAt.getTime() : 0;
  if (bPinnedTime !== aPinnedTime) {
    return bPinnedTime - aPinnedTime;
  }
  return compareBySortTimeDescThenIdDesc(a, b);
}

function selectTopDocuments(
  primaryDocs: PersonalizedFeedDocument[],
  fallbackDocs: PersonalizedFeedDocument[],
  limit: number,
  maxPerSource: number,
) {
  const selected: PersonalizedFeedDocument[] = [];
  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const allCandidates = [...primaryDocs, ...fallbackDocs];

  const pinnedCandidates = allCandidates
    .filter((doc) => doc.isPinned && !doc.isHidden)
    .sort(comparePinnedDocs);

  for (const doc of pinnedCandidates) {
    if (seenIds.has(doc.id)) {
      continue;
    }

    const normalizedTitle = normalizeStoryTitle(doc.title);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      continue;
    }

    selected.push(doc);
    seenIds.add(doc.id);
    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }
    const sourceKey = doc.sourceGroupKey;
    sourceCounts.set(sourceKey, (sourceCounts.get(sourceKey) ?? 0) + 1);

    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const doc of allCandidates) {
    if (doc.isHidden || seenIds.has(doc.id)) {
      continue;
    }

    const normalizedTitle = normalizeStoryTitle(doc.title);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      continue;
    }

    const sourceKey = doc.sourceGroupKey;
    const count = sourceCounts.get(sourceKey) ?? 0;

    if (count >= maxPerSource) {
      continue;
    }

    selected.push(doc);
    seenIds.add(doc.id);
    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }
    sourceCounts.set(sourceKey, count + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function promoteUnreadTopStories(
  topDocuments: PersonalizedFeedDocument[],
  remainingDocuments: PersonalizedFeedDocument[],
  limit: number,
  maxPerSource: number,
) {
  const initialTopIds = new Set(topDocuments.map((document) => document.id));
  const pinnedRemaining = remainingDocuments
    .filter((doc) => doc.isPinned && !doc.isHidden)
    .sort(comparePinnedDocs);
  const qualifyingRemaining = remainingDocuments.filter(
    (doc) => !doc.isPinned && !doc.isHidden && doc.matchScore !== null && doc.matchScore >= MIN_TOP_STORY_SCORE,
  );
  const otherRemaining = remainingDocuments.filter(
    (doc) => !doc.isPinned && !doc.isHidden && (doc.matchScore === null || doc.matchScore < MIN_TOP_STORY_SCORE),
  );
  const priorityPool = [...topDocuments, ...pinnedRemaining, ...qualifyingRemaining, ...otherRemaining];
  const displayPool = [...topDocuments, ...remainingDocuments];
  const seenIds = new Set<number>();
  const seenTitles = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const unreadTop: PersonalizedFeedDocument[] = [];

  for (const document of priorityPool) {
    if (document.isHidden || seenIds.has(document.id)) {
      continue;
    }

    if (document.isRead && !document.isPinned) {
      continue;
    }

    if (
      !document.isPinned &&
      !initialTopIds.has(document.id) &&
      document.matchScore !== null &&
      document.matchScore < MIN_TOP_STORY_SCORE
    ) {
      continue;
    }

    const normalizedTitle = normalizeStoryTitle(document.title);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      continue;
    }

    const sourceCount = sourceCounts.get(document.sourceGroupKey) ?? 0;
    if (!document.isPinned && sourceCount >= maxPerSource) {
      continue;
    }

    unreadTop.push(document);
    seenIds.add(document.id);
    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }
    sourceCounts.set(document.sourceGroupKey, sourceCount + 1);

    if (unreadTop.length >= limit) {
      break;
    }
  }

  const topIds = new Set(unreadTop.map((document) => document.id));
  const dedupedRemaining: PersonalizedFeedDocument[] = [];
  const remainingSeen = new Set<number>();

  for (const document of displayPool) {
    if (topIds.has(document.id) || remainingSeen.has(document.id)) {
      continue;
    }

    dedupedRemaining.push(document);
    remainingSeen.add(document.id);
  }

  dedupedRemaining.sort((a, b) => {
    if (a.isHidden !== b.isHidden) {
      return a.isHidden ? 1 : -1;
    }
    return 0;
  });

  return {
    topDocuments: unreadTop,
    remainingDocuments: dedupedRemaining,
  };
}

function compareBySortTimeDescThenIdDesc(
  a: { sortTime: Date; id: number },
  b: { sortTime: Date; id: number },
) {
  const aTime = a.sortTime instanceof Date ? a.sortTime.getTime() : new Date(a.sortTime).getTime();
  const bTime = b.sortTime instanceof Date ? b.sortTime.getTime() : new Date(b.sortTime).getTime();

  if (bTime !== aTime) {
    return bTime - aTime;
  }

  return b.id - a.id;
}

export interface FeedUserProfile {
  id: number;
  slug: string;
  displayName: string;
  interestStatement: string;
  isDefault: boolean;
  updatedAt: Date;
}

export interface PersonalizedFeedDocument {
  id: number;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  sourceId: number;
  sourceName: string;
  sourceSlug: string;
  sourceGroupKey: string;
  category: SourceCategory;
  sourcePublishedAt: Date | null;
  discoveredAt: Date;
  sortTime: Date;
  previewParagraph: string;
  llmRank: number | null;
  matchScore: number | null;
  whyRelevant: string | null;
  curatorNote: string | null;
  isPinned: boolean;
  isHidden: boolean;
  pinnedAt: Date | null;
  isRead: boolean;
  readAt: Date | null;
}

export interface ProfileTopStoriesSummary {
  summary: string;
  takeaways: string[];
  furtherStudy: string;
  model: string;
  generatedAt: Date;
}

export interface PersonalizedFeedSnapshot {
  profiles: FeedUserProfile[];
  selectedProfile: FeedUserProfile;
  topDocuments: PersonalizedFeedDocument[];
  remainingDocuments: PersonalizedFeedDocument[];
  topStoriesSummary: ProfileTopStoriesSummary | null;
  showWhyRelevant: boolean;
  candidateCount: number;
  rankingMode: "interest_ranked" | "latest";
  rankingSummary: string;
  rankingStatusLabel: string;
  model: string | null;
  windowLabel: string;
  activeTimeWindow: TimeWindow;
}

interface CandidateDocumentRow {
  id: number;
  title: string;
  summary: string | null;
  bodyText: string | null;
  canonicalUrl: string;
  sourceId: number;
  sourceName: string;
  sourceSlug: string;
  canonicalDomain: string;
  category: SourceCategory;
  sourcePublishedAt: Date | null;
  discoveredAt: Date;
  sortTime: Date;
  readAt?: Date | null;
  curatorNote?: string | null;
  isPinned?: boolean | null;
  isHidden?: boolean | null;
  pinnedAt?: Date | null;
}

interface TopStoriesSummaryCachePayload {
  type: "top_stories_summary";
  summary: string;
  takeaways: string[];
  furtherStudy: string;
  storyIds: number[];
  timeWindow: TimeWindow;
}

function slugifyDisplayName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeProfileDisplayName(value: string, fallback: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_PROFILE_NAME_LENGTH) || fallback;
}

function normalizeInterestStatement(value: string) {
  return value.trim().slice(0, MAX_INTEREST_STATEMENT_LENGTH);
}

function normalizedProfileNameSql(value: string) {
  return value.trim().toLowerCase();
}

function selectDefaultProfile(profiles: FeedUserProfile[]) {
  return profiles.find((profile) => profile.isDefault);
}

function extractFirstParagraph(summary: string | null, bodyText: string | null) {
  return extractDocumentPreview(summary, bodyText, {
    maxChars: 600,
    fallback: "No first paragraph was extracted yet.",
  });
}


function normalizeProfileRow(row: {
  id: number;
  slug: string;
  displayName: string;
  interestStatement: string;
  isDefault: boolean;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    interestStatement: row.interestStatement,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt,
  } satisfies FeedUserProfile;
}

function mapCandidateRow(row: CandidateDocumentRow) {
  const readAt = row.readAt ? (row.readAt instanceof Date ? row.readAt : new Date(row.readAt)) : null;
  const pinnedAt = row.pinnedAt ? (row.pinnedAt instanceof Date ? row.pinnedAt : new Date(row.pinnedAt)) : null;
  const curatorNote = row.curatorNote?.trim() ? row.curatorNote.trim() : null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    canonicalUrl: row.canonicalUrl,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceSlug: row.sourceSlug,
    sourceGroupKey: row.canonicalDomain || row.sourceSlug,
    category: row.category,
    sourcePublishedAt: row.sourcePublishedAt,
    discoveredAt: row.discoveredAt,
    sortTime: row.sortTime instanceof Date ? row.sortTime : new Date(row.sortTime),
    previewParagraph: extractFirstParagraph(row.summary, row.bodyText),
    llmRank: null,
    matchScore: null,
    whyRelevant: null,
    curatorNote,
    isPinned: Boolean(row.isPinned),
    isHidden: Boolean(row.isHidden),
    pinnedAt,
    isRead: Boolean(readAt),
    readAt,
  } satisfies PersonalizedFeedDocument;
}

function buildTopStoriesSummaryCacheKey(
  timeWindow: TimeWindow,
  interestStatement: string,
  documents: PersonalizedFeedDocument[],
) {
  const storyFingerprint = documents
    .slice(0, MAX_SELECTED_DOCUMENTS)
    .map((document) => document.id)
    .join(",");
  const cacheInput = `${TOP_STORIES_SUMMARY_CACHE_PREFIX}:${timeWindow}:${interestStatement.trim()}:${storyFingerprint}`;
  return createHash("sha256").update(cacheInput).digest("hex");
}

function parseTopStoriesSummaryCachePayload(
  value: unknown,
  expectedTimeWindow: TimeWindow,
  expectedStoryIds: number[],
) {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;

  if (
    record?.type !== "top_stories_summary" ||
    record.timeWindow !== expectedTimeWindow ||
    typeof record.summary !== "string" ||
    !Array.isArray(record.storyIds)
  ) {
    return null;
  }

  const cachedStoryIds = record.storyIds.map((id) => Number(id));
  const sameStories =
    cachedStoryIds.length === expectedStoryIds.length &&
    cachedStoryIds.every((id, index) => id === expectedStoryIds[index]);

  if (!sameStories) {
    return null;
  }

  return {
    summary: record.summary.trim(),
    takeaways: Array.isArray(record.takeaways)
      ? record.takeaways
          .map((takeaway) => (typeof takeaway === "string" ? takeaway.trim() : ""))
          .filter(Boolean)
          .slice(0, 4)
      : [],
    furtherStudy:
      typeof record.furtherStudy === "string" && record.furtherStudy.trim()
        ? record.furtherStudy.trim()
        : DEFAULT_FURTHER_STUDY_TEXT,
  };
}

async function getCachedTopStoriesSummary({
  profileId,
  cacheKey,
  timeWindow,
  storyIds,
}: {
  profileId: number;
  cacheKey: string;
  timeWindow: TimeWindow;
  storyIds: number[];
}): Promise<ProfileTopStoriesSummary | null> {
  const db = getDb();
  const [cached] = await db
    .select({
      rankingJson: schema.rankingCache.rankingJson,
      model: schema.rankingCache.model,
      createdAt: schema.rankingCache.createdAt,
    })
    .from(schema.rankingCache)
    .where(
      and(
        eq(schema.rankingCache.profileId, profileId),
        eq(schema.rankingCache.candidatesHash, cacheKey),
        gt(schema.rankingCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!cached) {
    return null;
  }

  const payload = parseTopStoriesSummaryCachePayload(cached.rankingJson, timeWindow, storyIds);
  if (!payload?.summary) {
    return null;
  }

  return {
    ...payload,
    model: cached.model ?? "unknown",
    generatedAt: cached.createdAt,
  };
}

async function saveTopStoriesSummary({
  profileId,
  cacheKey,
  timeWindow,
  storyIds,
  summary,
}: {
  profileId: number;
  cacheKey: string;
  timeWindow: TimeWindow;
  storyIds: number[];
  summary: ProfileTopStoriesSummary;
}) {
  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOP_STORIES_SUMMARY_CACHE_TTL_HOURS * 60 * 60 * 1000);
  const payload: TopStoriesSummaryCachePayload = {
    type: "top_stories_summary",
    summary: summary.summary,
    takeaways: summary.takeaways,
    furtherStudy: summary.furtherStudy,
    storyIds,
    timeWindow,
  };

  await Promise.all([
    db
      .insert(schema.rankingCache)
      .values({
        profileId,
        candidatesHash: cacheKey,
        model: summary.model,
        rankingJson: payload,
        createdAt: now,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [schema.rankingCache.profileId, schema.rankingCache.candidatesHash],
        set: {
          model: sql`excluded.model`,
          rankingJson: sql`excluded.ranking_json`,
          createdAt: now,
          expiresAt,
        },
      }),
    db
      .delete(schema.rankingCache)
      .where(
        and(
          eq(schema.rankingCache.profileId, profileId),
          lt(schema.rankingCache.expiresAt, now),
        ),
      ),
  ]);
}

async function summarizeTopDocumentsForProfile(
  profile: FeedUserProfile,
  documents: PersonalizedFeedDocument[],
  timeWindow: TimeWindow,
  options: { forceRefresh?: boolean; allowGenerate?: boolean } = {},
): Promise<ProfileTopStoriesSummary | null> {
  const env = loadWebEnv();
  const allowGenerate = options.allowGenerate ?? true;

  if (!profile.interestStatement.trim() || documents.length === 0) {
    return null;
  }

  const storyIds = documents.slice(0, MAX_SELECTED_DOCUMENTS).map((document) => document.id);
  const cacheKey = buildTopStoriesSummaryCacheKey(
    timeWindow,
    profile.interestStatement,
    documents,
  );

  if (!options.forceRefresh) {
    const cachedSummary = await getCachedTopStoriesSummary({
      profileId: profile.id,
      cacheKey,
      timeWindow,
      storyIds,
    });

    if (cachedSummary) {
      return cachedSummary;
    }
  }

  if (!allowGenerate || !env.openRouterApiKey) {
    return null;
  }

  if (!options.forceRefresh) {
    const cooldownUntil = summaryFailureCooldownUntil.get(profile.id) ?? 0;
    if (cooldownUntil > Date.now()) {
      return null;
    }
  }

  try {
    const result = await summarizeTopStoriesForProfile({
      profileName: profile.displayName,
      interestStatement: profile.interestStatement,
      candidates: documents.slice(0, MAX_SELECTED_DOCUMENTS).map((document, index) => ({
        id: document.id,
        rank: index + 1,
        title: document.title,
        previewParagraph: document.previewParagraph,
        sourceName: document.sourceName,
        sourceCategory: document.category,
        publishedAt: document.sortTime,
        score: document.matchScore,
        whyRelevant: document.curatorNote
          ? `Curator's take: ${document.curatorNote}${document.whyRelevant ? ` | ${document.whyRelevant}` : ""}`
          : document.whyRelevant,
      })),
    });

    const summary = {
      summary: result.summary.summary,
      takeaways: result.summary.takeaways,
      furtherStudy: result.summary.furtherStudy,
      model: result.model,
      generatedAt: new Date(),
    };

    await saveTopStoriesSummary({
      profileId: profile.id,
      cacheKey,
      timeWindow,
      storyIds,
      summary,
    });

    summaryFailureCooldownUntil.delete(profile.id);
    return summary;
  } catch (error) {
    summaryFailureCooldownUntil.set(profile.id, Date.now() + SUMMARY_FAILURE_COOLDOWN_MS);
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[feed] Failed to summarize top stories for profile ${profile.id}: ${message}`);
    return null;
  }
}

async function getCandidateDocuments(
  cutoff: Date,
  readStateUserId: number | null,
  ownerUserId: number,
) {
  const db = getDb();
  const baseSelect = {
    id: schema.documents.id,
    title: schema.documents.title,
    summary: schema.documents.summary,
    bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
    canonicalUrl: schema.documents.canonicalUrl,
    sourceId: schema.sources.id,
    sourceName: schema.sources.name,
    sourceSlug: schema.sources.slug,
    canonicalDomain: schema.sources.canonicalDomain,
    category: schema.sources.category,
    sourcePublishedAt: schema.documents.sourcePublishedAt,
    discoveredAt: schema.documents.discoveredAt,
    sortTime: documentSortKey,
    curatorNote: schema.storyCurations.curatorNote,
    isPinned: schema.storyCurations.isPinned,
    isHidden: schema.storyCurations.isHidden,
    pinnedAt: schema.storyCurations.pinnedAt,
  };
  const pinnedFirstOrder = sql<boolean>`coalesce(${schema.storyCurations.isPinned}, false) AND NOT coalesce(${schema.storyCurations.isHidden}, false)`;

  if (readStateUserId) {
    const rows = await db
      .select({
        ...baseSelect,
        readAt: schema.documentReads.readAt,
      })
      .from(schema.documents)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
      .leftJoin(
        schema.storyCurations,
        and(
          eq(schema.storyCurations.documentId, schema.documents.id),
          eq(schema.storyCurations.userId, ownerUserId),
        ),
      )
      .leftJoin(
        schema.documentReads,
        and(
          eq(schema.documentReads.documentId, schema.documents.id),
          eq(schema.documentReads.userId, readStateUserId),
        ),
      )
      .where(or(gt(documentSortKey, cutoff), eq(schema.storyCurations.isPinned, true)))
      .orderBy(desc(pinnedFirstOrder), desc(documentSortKey), desc(schema.documents.id))
      .limit(MAX_CANDIDATE_DOCUMENTS);

    return rows.map((row) => mapCandidateRow(row));
  }

  const rows = await db
    .select(baseSelect)
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .leftJoin(
      schema.storyCurations,
      and(
        eq(schema.storyCurations.documentId, schema.documents.id),
        eq(schema.storyCurations.userId, ownerUserId),
      ),
    )
    .where(or(gt(documentSortKey, cutoff), eq(schema.storyCurations.isPinned, true)))
    .orderBy(desc(pinnedFirstOrder), desc(documentSortKey), desc(schema.documents.id))
    .limit(MAX_CANDIDATE_DOCUMENTS);

  return rows.map((row) => mapCandidateRow(row));
}

async function ensureDefaultUserProfile(userId: number) {
  const db = getDb();

  await db
    .insert(schema.userProfiles)
    .values({
      userId,
      ...defaultUserProfile,
    })
    .onConflictDoNothing({
      target: [schema.userProfiles.userId, schema.userProfiles.slug],
    });

  const [existingDefault] = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(
      and(
        eq(schema.userProfiles.userId, userId),
        eq(schema.userProfiles.isActive, true),
        eq(schema.userProfiles.isDefault, true),
      ),
    )
    .limit(1);

  if (existingDefault) {
    return;
  }

  const [firstActiveProfile] = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.userId, userId), eq(schema.userProfiles.isActive, true)))
    .orderBy(asc(schema.userProfiles.createdAt), asc(schema.userProfiles.id))
    .limit(1);

  if (!firstActiveProfile) {
    return;
  }

  await db
    .update(schema.userProfiles)
    .set({
      isDefault: true,
    })
    .where(eq(schema.userProfiles.id, firstActiveProfile.id));
}

async function queryActiveProfiles(userId: number) {
  const db = getDb();
  return db
    .select({
      id: schema.userProfiles.id,
      slug: schema.userProfiles.slug,
      displayName: schema.userProfiles.displayName,
      interestStatement: schema.userProfiles.interestStatement,
      isDefault: schema.userProfiles.isDefault,
      updatedAt: schema.userProfiles.updatedAt,
    })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.userId, userId), eq(schema.userProfiles.isActive, true)))
    .orderBy(desc(schema.userProfiles.updatedAt), asc(schema.userProfiles.displayName));
}

async function getProfiles(userId: number) {
  let rows = await queryActiveProfiles(userId);

  if (rows.length === 0 || !rows.some((row) => row.isDefault)) {
    await ensureDefaultUserProfile(userId);
    rows = await queryActiveProfiles(userId);
  }

  return rows.map((row) => normalizeProfileRow(row));
}

async function getUniqueProfileSlug(userId: number, baseSlug: string) {
  const db = getDb();
  const existingRows = await db
    .select({ slug: schema.userProfiles.slug })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId));
  const existingSlugs = new Set(existingRows.map((row) => row.slug));
  const normalizedBase = baseSlug || "analyst";

  if (!existingSlugs.has(normalizedBase)) {
    return normalizedBase;
  }

  let suffix = 2;
  let candidate = `${normalizedBase}-${suffix}`;

  while (existingSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${normalizedBase}-${suffix}`;
  }

  return candidate;
}

async function findProfileByDisplayName(userId: number, displayName: string, excludeProfileId?: number) {
  const db = getDb();
  const filters = [
    eq(schema.userProfiles.userId, userId),
    sql`lower(btrim(${schema.userProfiles.displayName})) = ${normalizedProfileNameSql(displayName)}`,
  ];

  if (excludeProfileId) {
    filters.push(ne(schema.userProfiles.id, excludeProfileId));
  }

  const [profile] = await db
    .select({
      id: schema.userProfiles.id,
      slug: schema.userProfiles.slug,
    })
    .from(schema.userProfiles)
    .where(and(...filters))
    .limit(1);

  return profile ?? null;
}

function isProfileNameUniqueViolation(error: unknown) {
  const candidates: unknown[] = [error];
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : null;

  if (cause) {
    candidates.push(cause);
  }

  return candidates.some((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }

    const errorLike = candidate as { code?: string; constraint?: string; detail?: string };
    return (
      errorLike.code === "23505" &&
      (errorLike.constraint === PROFILE_NAME_UNIQUE_INDEX ||
        Boolean(errorLike.detail?.includes(PROFILE_NAME_UNIQUE_INDEX)))
    );
  });
}

export async function createUserProfile({
  userId,
  displayName,
  interestStatement,
}: {
  userId: number;
  displayName: string;
  interestStatement: string;
}) {
  await ensureDefaultUserProfile(userId);

  const db = getDb();
  const activeProfiles = await queryActiveProfiles(userId);
  if (activeProfiles.length >= MAX_ACTIVE_PROFILES_PER_USER) {
    throw new ProfileLimitExceededError();
  }

  const normalizedDisplayName = normalizeProfileDisplayName(displayName, "New analyst");
  const normalizedInterest = normalizeInterestStatement(interestStatement);
  const duplicateProfile = await findProfileByDisplayName(userId, normalizedDisplayName);

  if (duplicateProfile) {
    throw new DuplicateProfileNameError(normalizedDisplayName, duplicateProfile.slug);
  }

  const slug = await getUniqueProfileSlug(userId, slugifyDisplayName(normalizedDisplayName));

  let createdProfile:
    | {
        id: number;
        slug: string;
        displayName: string;
        interestStatement: string;
        isDefault: boolean;
        updatedAt: Date;
      }
    | undefined;

  try {
    [createdProfile] = await db
      .insert(schema.userProfiles)
      .values({
        userId,
        slug,
        displayName: normalizedDisplayName,
        interestStatement: normalizedInterest,
      })
      .returning({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
        isDefault: schema.userProfiles.isDefault,
        updatedAt: schema.userProfiles.updatedAt,
      });
  } catch (error) {
    if (isProfileNameUniqueViolation(error)) {
      throw new DuplicateProfileNameError(normalizedDisplayName);
    }

    throw error;
  }

  if (!createdProfile) {
    throw new Error("Failed to create user profile");
  }

  if (normalizedInterest) {
    await enqueueProfileScoring(createdProfile.id);
  }

  return normalizeProfileRow(createdProfile);
}

export async function updateUserProfile({
  userId,
  profileId,
  displayName,
  interestStatement,
}: {
  userId: number;
  profileId: number;
  displayName: string;
  interestStatement: string;
}) {
  const db = getDb();
  const [existingProfile] = await db
    .select({
      slug: schema.userProfiles.slug,
      interestStatement: schema.userProfiles.interestStatement,
    })
    .from(schema.userProfiles)
    .where(
      and(
        eq(schema.userProfiles.id, profileId),
        eq(schema.userProfiles.userId, userId),
        eq(schema.userProfiles.isActive, true),
      ),
    )
    .limit(1);

  if (!existingProfile) {
    throw new Error(`User profile ${profileId} was not found`);
  }

  const normalizedDisplayName = normalizeProfileDisplayName(displayName, "Untitled analyst");
  const normalizedInterest = normalizeInterestStatement(interestStatement);
  const interestChanged = existingProfile.interestStatement.trim() !== normalizedInterest;
  const duplicateProfile = await findProfileByDisplayName(userId, normalizedDisplayName, profileId);

  if (duplicateProfile) {
    throw new DuplicateProfileNameError(normalizedDisplayName, existingProfile.slug);
  }

  let updatedProfile:
    | {
        id: number;
        slug: string;
        displayName: string;
        interestStatement: string;
        isDefault: boolean;
        updatedAt: Date;
      }
    | undefined;

  try {
    [updatedProfile] = await db
      .update(schema.userProfiles)
      .set({
        displayName: normalizedDisplayName,
        interestStatement: normalizedInterest,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.userProfiles.id, profileId),
          eq(schema.userProfiles.userId, userId),
          eq(schema.userProfiles.isActive, true),
        ),
      )
      .returning({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
        isDefault: schema.userProfiles.isDefault,
        updatedAt: schema.userProfiles.updatedAt,
      });
  } catch (error) {
    if (isProfileNameUniqueViolation(error)) {
      throw new DuplicateProfileNameError(normalizedDisplayName, existingProfile.slug);
    }

    throw error;
  }

  if (!updatedProfile) {
    throw new Error(`User profile ${profileId} was not found`);
  }

  if (interestChanged) {
    await Promise.all([
      db.delete(schema.documentScores).where(eq(schema.documentScores.profileId, profileId)),
      db.delete(schema.rankingCache).where(eq(schema.rankingCache.profileId, profileId)),
    ]);

    if (normalizedInterest) {
      await enqueueProfileScoring(profileId);
    }
  }

  return normalizeProfileRow(updatedProfile);
}

export async function deleteUserProfile({
  userId,
  profileId,
}: {
  userId: number;
  profileId: number;
}) {
  await ensureDefaultUserProfile(userId);

  const db = getDb();
  const profiles = await getProfiles(userId);
  const profileToDelete = profiles.find((profile) => profile.id === profileId);

  if (!profileToDelete) {
    throw new Error(`User profile ${profileId} was not found`);
  }

  if (profiles.length <= 1) {
    throw new LastProfileDeleteError(profileToDelete.slug);
  }

  const nextProfile = profiles.find((profile) => profile.id !== profileId) ?? null;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(schema.userProfiles)
      .set({
        isActive: false,
        isDefault: false,
        updatedAt: now,
      })
      .where(and(eq(schema.userProfiles.id, profileId), eq(schema.userProfiles.userId, userId)));

    if (profileToDelete.isDefault && nextProfile) {
      await tx
        .update(schema.userProfiles)
        .set({
          isDefault: false,
        })
        .where(eq(schema.userProfiles.userId, userId));

      await tx
        .update(schema.userProfiles)
        .set({
          isDefault: true,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.userProfiles.id, nextProfile.id),
            eq(schema.userProfiles.userId, userId),
            eq(schema.userProfiles.isActive, true),
          ),
        );
    }
  });

  return {
    deletedProfile: profileToDelete,
    nextProfile,
  };
}

export async function setDefaultUserProfile({
  userId,
  profileId,
}: {
  userId: number;
  profileId: number;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
        isDefault: schema.userProfiles.isDefault,
        updatedAt: schema.userProfiles.updatedAt,
      })
      .from(schema.userProfiles)
      .where(
        and(
          eq(schema.userProfiles.id, profileId),
          eq(schema.userProfiles.userId, userId),
          eq(schema.userProfiles.isActive, true),
        ),
      )
      .limit(1);

    if (!profile) {
      throw new Error(`Active user profile ${profileId} was not found`);
    }

    const now = new Date();
    await tx
      .update(schema.userProfiles)
      .set({
        isDefault: false,
      })
      .where(and(eq(schema.userProfiles.userId, userId), eq(schema.userProfiles.isActive, true)));

    const [updatedProfile] = await tx
      .update(schema.userProfiles)
      .set({
        isDefault: true,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.userProfiles.id, profileId),
          eq(schema.userProfiles.userId, userId),
          eq(schema.userProfiles.isActive, true),
        ),
      )
      .returning({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
        isDefault: schema.userProfiles.isDefault,
        updatedAt: schema.userProfiles.updatedAt,
      });

    if (!updatedProfile) {
      throw new Error(`Active user profile ${profileId} was not updated`);
    }

    return normalizeProfileRow(updatedProfile);
  });
}

function buildSelectedProfileIdSubquery(ownerUserId: number, profileSlug?: string | null) {
  const db = getDb();
  if (profileSlug) {
    return db
      .select({ id: schema.userProfiles.id })
      .from(schema.userProfiles)
      .where(
        and(
          eq(schema.userProfiles.userId, ownerUserId),
          eq(schema.userProfiles.isActive, true),
          eq(schema.userProfiles.slug, profileSlug),
        ),
      )
      .limit(1);
  }

  return db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.userId, ownerUserId), eq(schema.userProfiles.isActive, true)))
    .orderBy(
      desc(schema.userProfiles.isDefault),
      desc(schema.userProfiles.updatedAt),
      asc(schema.userProfiles.displayName),
    )
    .limit(1);
}

async function queryScoredDocumentsForProfile({
  profileIdFilter,
  cutoff,
  readStateUserId,
  ownerUserId,
}: {
  profileIdFilter: number | ReturnType<typeof buildSelectedProfileIdSubquery>;
  cutoff: Date;
  readStateUserId: number | null;
  ownerUserId: number;
}) {
  const db = getDb();
  const baseSelect = {
    id: schema.documents.id,
    title: schema.documents.title,
    summary: schema.documents.summary,
    bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
    canonicalUrl: schema.documents.canonicalUrl,
    sourceId: schema.sources.id,
    sourceName: schema.sources.name,
    sourceSlug: schema.sources.slug,
    canonicalDomain: schema.sources.canonicalDomain,
    category: schema.sources.category,
    trustTier: schema.sources.trustTier,
    sourcePublishedAt: schema.documents.sourcePublishedAt,
    discoveredAt: schema.documents.discoveredAt,
    sortTime: documentSortKey,
    score: schema.documentScores.score,
    whyRelevant: schema.documentScores.whyRelevant,
    model: schema.documentScores.model,
    curatorNote: schema.storyCurations.curatorNote,
    isPinned: schema.storyCurations.isPinned,
    isHidden: schema.storyCurations.isHidden,
    pinnedAt: schema.storyCurations.pinnedAt,
  };
  const pinnedFirstOrder = sql<boolean>`coalesce(${schema.storyCurations.isPinned}, false) AND NOT coalesce(${schema.storyCurations.isHidden}, false)`;

  if (readStateUserId) {
    return db
      .select({
        ...baseSelect,
        readAt: schema.documentReads.readAt,
      })
      .from(schema.documentScores)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
      .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
      .leftJoin(
        schema.storyCurations,
        and(
          eq(schema.storyCurations.documentId, schema.documents.id),
          eq(schema.storyCurations.userId, ownerUserId),
        ),
      )
      .leftJoin(
        schema.documentReads,
        and(
          eq(schema.documentReads.documentId, schema.documents.id),
          eq(schema.documentReads.userId, readStateUserId),
        ),
      )
      .where(
        and(
          eq(schema.documentScores.profileId, profileIdFilter),
          or(gt(documentSortKey, cutoff), eq(schema.storyCurations.isPinned, true)),
        ),
      )
      .orderBy(desc(pinnedFirstOrder), desc(schema.documentScores.score), desc(documentSortKey), desc(schema.documents.id))
      .limit(MAX_CANDIDATE_DOCUMENTS);
  }

  return db
    .select(baseSelect)
    .from(schema.documentScores)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .leftJoin(
      schema.storyCurations,
      and(
        eq(schema.storyCurations.documentId, schema.documents.id),
        eq(schema.storyCurations.userId, ownerUserId),
      ),
    )
    .where(
      and(
        eq(schema.documentScores.profileId, profileIdFilter),
        or(gt(documentSortKey, cutoff), eq(schema.storyCurations.isPinned, true)),
      ),
    )
    .orderBy(desc(pinnedFirstOrder), desc(schema.documentScores.score), desc(documentSortKey), desc(schema.documents.id))
    .limit(MAX_CANDIDATE_DOCUMENTS);
}

async function buildPersonalizedFeedSnapshot({
  profileSlug,
  timeWindow,
  ownerUserId,
  readStateUserId,
  forceSummaryRefresh = false,
}: {
  profileSlug?: string | null;
  timeWindow: TimeWindow;
  ownerUserId: number;
  readStateUserId: number | null;
  forceSummaryRefresh?: boolean;
}): Promise<PersonalizedFeedSnapshot> {
  const showWhyRelevant = loadWebEnv().feedShowWhyRelevant;
  const cutoff = getTimeWindowCutoff(timeWindow);
  const windowLabel = TIME_WINDOW_LABELS[timeWindow];
  const profileSubquery = buildSelectedProfileIdSubquery(ownerUserId, profileSlug);
  const [profiles, candidateDocuments, initialScoredRows] = await Promise.all([
    getProfiles(ownerUserId),
    getCandidateDocuments(cutoff, readStateUserId, ownerUserId),
    queryScoredDocumentsForProfile({
      profileIdFilter: profileSubquery,
      cutoff,
      readStateUserId,
      ownerUserId,
    }),
  ]);
  const matchedBySlug = profileSlug
    ? profiles.find((profile) => profile.slug === profileSlug) ?? null
    : null;
  const selectedProfile =
    matchedBySlug ??
    (profileSlug ? null : selectDefaultProfile(profiles)) ??
    profiles[0];

  if (!selectedProfile) {
    throw new Error("Expected at least one active user profile");
  }

  const defaultShortlist = selectTopDocuments(candidateDocuments, [], MAX_SELECTED_DOCUMENTS, MAX_PER_SOURCE);

  function buildRemainingDocuments(excludeIds: Set<number>) {
    return candidateDocuments
      .filter((d) => !excludeIds.has(d.id) && (readStateUserId !== null || !d.isHidden))
      .sort((a, b) => {
        if (a.isHidden !== b.isHidden) {
          return a.isHidden ? 1 : -1;
        }
        return compareBySortTimeDescThenIdDesc(a, b);
      });
  }

  if (candidateDocuments.length === 0) {
    return {
      profiles,
      selectedProfile,
      topDocuments: [],
      remainingDocuments: [],
      topStoriesSummary: null,
      showWhyRelevant,
      candidateCount: 0,
      rankingMode: "latest",
      rankingSummary: "No documents are available yet. Run the worker again after more sources publish updates.",
      rankingStatusLabel: "Awaiting documents",
      model: null,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }

  function withReadState(
    topDocuments: PersonalizedFeedDocument[],
    remainingDocuments: PersonalizedFeedDocument[],
  ) {
    if (!readStateUserId) {
      return {
        topDocuments,
        remainingDocuments: remainingDocuments.filter((d) => !d.isHidden),
      };
    }

    return promoteUnreadTopStories(
      topDocuments,
      remainingDocuments,
      MAX_SELECTED_DOCUMENTS,
      MAX_PER_SOURCE,
    );
  }

  if (!selectedProfile.interestStatement.trim()) {
    const topIds = new Set(defaultShortlist.map((d) => d.id));
    const documentsWithReadState = withReadState(defaultShortlist, buildRemainingDocuments(topIds));
    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      topStoriesSummary: null,
      showWhyRelevant,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary: `No interest statement is saved for ${selectedProfile.displayName} yet, so this feed is showing the newest stories in the current window.`,
      rankingStatusLabel: "Newest first",
      model: null,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }

  const scoredRows =
    profileSlug && !matchedBySlug
      ? await queryScoredDocumentsForProfile({
          profileIdFilter: selectedProfile.id,
          cutoff,
          readStateUserId,
          ownerUserId,
        })
      : initialScoredRows;

  if (scoredRows.length > 0) {
    const nowMs = Date.now();
    const rankedScoredRows = scoredRows
      .map((row) => {
        const sortTime = row.sortTime instanceof Date ? row.sortTime : new Date(row.sortTime);
        const parsedMeta = parseWhyRelevantMetadata(row.whyRelevant);
        const adjustedScore =
          computeAdjustedStoryScore({
            score: row.score,
            sortTime,
            cutoff,
            now: nowMs,
            freshnessBoostMax: FRESHNESS_BOOST_BY_WINDOW[timeWindow],
            trustTier: row.trustTier,
            confidence: parsedMeta.confidence,
            minQualifyingScore: MIN_TOP_STORY_SCORE,
          }) ?? row.score;

        return {
          row,
          cleanWhyRelevant: parsedMeta.whyRelevant || null,
          adjustedScore,
        };
      })
      .sort((a, b) => {
        if (b.adjustedScore !== a.adjustedScore) {
          return b.adjustedScore - a.adjustedScore;
        }

        return compareBySortTimeDescThenIdDesc(a.row, b.row);
      });

    const scoredDocs: PersonalizedFeedDocument[] = rankedScoredRows.map(
      ({ row, cleanWhyRelevant }, index) => ({
        ...mapCandidateRow(row),
        llmRank: index + 1,
        matchScore: row.score,
        whyRelevant: cleanWhyRelevant,
      }),
    );

    const scoredIds = new Set(scoredDocs.map((d) => d.id));
    const unscoredCandidates = candidateDocuments.filter((d) => !scoredIds.has(d.id));
    const qualifyingScoredDocs = scoredDocs.filter(
      (d) => d.isPinned || (d.matchScore ?? 0) >= MIN_TOP_STORY_SCORE,
    );

    const topDocuments = selectTopDocuments(
      qualifyingScoredDocs,
      unscoredCandidates,
      MAX_SELECTED_DOCUMENTS,
      MAX_PER_SOURCE,
    );
    const topIds = new Set(topDocuments.map((d) => d.id));
    const remaining = [
      ...scoredDocs.filter((d) => !topIds.has(d.id)),
      ...unscoredCandidates.filter((d) => !topIds.has(d.id)),
    ];

    const firstModel = rankedScoredRows[0]?.row.model ?? null;
    const documentsWithReadState = withReadState(topDocuments, remaining);
    const topStoriesSummary = await summarizeTopDocumentsForProfile(
      selectedProfile,
      topDocuments,
      timeWindow,
      {
        forceRefresh: forceSummaryRefresh,
        allowGenerate: true,
      },
    );

    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      topStoriesSummary,
      showWhyRelevant,
      candidateCount: candidateDocuments.length,
      rankingMode: "interest_ranked",
      rankingSummary: "Ranked by pre-computed relevance scores with a freshness boost.",
      rankingStatusLabel: "Ranked by relevance",
      model: firstModel,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }

  const topIds = new Set(defaultShortlist.map((d) => d.id));
  const remainingDocuments = buildRemainingDocuments(topIds);
  const documentsWithReadState = withReadState(defaultShortlist, remainingDocuments);
  const topStoriesSummary = await summarizeTopDocumentsForProfile(
    selectedProfile,
    defaultShortlist,
    timeWindow,
    {
      forceRefresh: forceSummaryRefresh,
      allowGenerate: forceSummaryRefresh,
    },
  );
  return {
    profiles,
    selectedProfile,
    topDocuments: documentsWithReadState.topDocuments,
    remainingDocuments: documentsWithReadState.remainingDocuments,
    topStoriesSummary,
    showWhyRelevant,
    candidateCount: candidateDocuments.length,
    rankingMode: "latest",
    rankingSummary:
      "No pre-computed relevance scores are available for this profile and window yet, so this feed is showing the newest stories while the worker catches up.",
    rankingStatusLabel: "Newest first",
    model: null,
    windowLabel,
    activeTimeWindow: timeWindow,
  };
}

export async function getPersonalizedFeedSnapshot(
  profileSlug?: string | null,
  timeWindow: TimeWindow = "week",
  currentUserId?: number,
): Promise<PersonalizedFeedSnapshot> {
  if (!currentUserId) {
    throw new Error("Expected current user id when building personalized feed");
  }

  return buildPersonalizedFeedSnapshot({
    profileSlug: profileSlug ?? null,
    timeWindow,
    ownerUserId: currentUserId,
    readStateUserId: currentUserId,
  });
}

export async function forceTopStoriesSummaryForProfile(profileId: number, timeWindow: TimeWindow = "week") {
  const db = getDb();
  const [profile] = await db
    .select({
      id: schema.userProfiles.id,
      userId: schema.userProfiles.userId,
      slug: schema.userProfiles.slug,
      displayName: schema.userProfiles.displayName,
    })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.id, profileId), eq(schema.userProfiles.isActive, true)))
    .limit(1);

  if (!profile) {
    throw new Error(`Active profile ${profileId} was not found`);
  }

  const snapshot = await buildPersonalizedFeedSnapshot({
    profileSlug: profile.slug,
    timeWindow,
    ownerUserId: profile.userId,
    readStateUserId: null,
    forceSummaryRefresh: true,
  });

  if (!snapshot.topStoriesSummary) {
    throw new Error(`No top-story summary was generated for ${profile.displayName}`);
  }

  return {
    profileId: profile.id,
    profileName: profile.displayName,
    storyCount: snapshot.topDocuments.length,
    summary: snapshot.topStoriesSummary,
  };
}

let cachedPublicFeedOwnerId: number | null = null;
const publicFeedCache = new Map<
  TimeWindow,
  { expiresAt: number; snapshot: PersonalizedFeedSnapshot }
>();
const publicFeedInFlight = new Map<TimeWindow, Promise<PersonalizedFeedSnapshot>>();

export function invalidatePublicFeedCache() {
  publicFeedCache.clear();
}

export async function saveStoryCurationNote({
  userId,
  documentId,
  curatorNote,
}: {
  userId: number;
  documentId: number;
  curatorNote: string;
}) {
  const db = getDb();
  const normalizedNote = curatorNote.trim().slice(0, MAX_CURATOR_NOTE_LENGTH) || null;
  const now = new Date();

  await db
    .insert(schema.storyCurations)
    .values({
      userId,
      documentId,
      curatorNote: normalizedNote,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.storyCurations.userId, schema.storyCurations.documentId],
      set: {
        curatorNote: normalizedNote,
        updatedAt: now,
      },
    });

  invalidatePublicFeedCache();
}

export async function setStoryPinned({
  userId,
  documentId,
  isPinned,
}: {
  userId: number;
  documentId: number;
  isPinned: boolean;
}) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.storyCurations)
    .values({
      userId,
      documentId,
      isPinned,
      isHidden: false,
      pinnedAt: isPinned ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.storyCurations.userId, schema.storyCurations.documentId],
      set: {
        isPinned,
        isHidden: isPinned ? false : sql`${schema.storyCurations.isHidden}`,
        pinnedAt: isPinned ? now : null,
        updatedAt: now,
      },
    });

  invalidatePublicFeedCache();
}

export async function setStoryHidden({
  userId,
  documentId,
  isHidden,
}: {
  userId: number;
  documentId: number;
  isHidden: boolean;
}) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.storyCurations)
    .values({
      userId,
      documentId,
      isHidden,
      isPinned: false,
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.storyCurations.userId, schema.storyCurations.documentId],
      set: {
        isHidden,
        isPinned: isHidden ? false : sql`${schema.storyCurations.isPinned}`,
        pinnedAt: isHidden ? null : sql`${schema.storyCurations.pinnedAt}`,
        updatedAt: now,
      },
    });

  invalidatePublicFeedCache();
}

export async function getPublicAiEngineerFeedSnapshot(timeWindow: TimeWindow = "week"): Promise<PersonalizedFeedSnapshot> {
  const now = Date.now();
  const cached = publicFeedCache.get(timeWindow);
  if (cached && cached.expiresAt > now) {
    return cached.snapshot;
  }

  const inFlight = publicFeedInFlight.get(timeWindow);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = (async () => {
    try {
      if (!cachedPublicFeedOwnerId) {
        const db = getDb();
        const [publicOwner] = await db
          .select({ id: schema.authUsers.id })
          .from(schema.authUsers)
          .where(
            and(
              eq(schema.authUsers.email, PUBLIC_FEED_OWNER_EMAIL),
              eq(schema.authUsers.isActive, true),
            ),
          )
          .limit(1);

        if (!publicOwner) {
          throw new Error(`Public feed owner ${PUBLIC_FEED_OWNER_EMAIL} was not found`);
        }
        cachedPublicFeedOwnerId = publicOwner.id;
      }

      const snapshot = await buildPersonalizedFeedSnapshot({
        profileSlug: PUBLIC_FEED_PROFILE_SLUG,
        timeWindow,
        ownerUserId: cachedPublicFeedOwnerId,
        readStateUserId: null,
      });

      publicFeedCache.set(timeWindow, {
        expiresAt: Date.now() + PUBLIC_FEED_CACHE_TTL_MS,
        snapshot,
      });

      return snapshot;
    } finally {
      publicFeedInFlight.delete(timeWindow);
    }
  })();

  publicFeedInFlight.set(timeWindow, loadPromise);
  return loadPromise;
}
