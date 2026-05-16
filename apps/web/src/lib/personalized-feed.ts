import { createHash } from "node:crypto";
import type { SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { loadWebEnv } from "@/lib/env";
import { summarizeTopStoriesForProfile } from "@/lib/openrouter";
import { applyReadStateToDocuments } from "@/lib/read-tracking";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_SELECTED_DOCUMENTS = 10;
const MAX_PER_SOURCE = 5;
const MAX_FRESHNESS_BOOST = 20;
const PUBLIC_FEED_OWNER_EMAIL = "lianglingfan@gmail.com";
const PUBLIC_FEED_PROFILE_SLUG = "founding-analyst";
const TOP_STORIES_SUMMARY_CACHE_PREFIX = "top-stories-summary:v3";
const TOP_STORIES_SUMMARY_CACHE_TTL_HOURS = 24;

export type TimeWindow = "day" | "week" | "month" | "quarter" | "year";

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

function selectTopDocuments(
  primaryDocs: PersonalizedFeedDocument[],
  fallbackDocs: PersonalizedFeedDocument[],
  limit: number,
  maxPerSource: number,
) {
  const selected: PersonalizedFeedDocument[] = [];
  const seenIds = new Set<number>();
  const sourceCounts = new Map<string, number>();

  for (const doc of [...primaryDocs, ...fallbackDocs]) {
    if (seenIds.has(doc.id)) {
      continue;
    }

    const sourceKey = doc.sourceGroupKey;
    const count = sourceCounts.get(sourceKey) ?? 0;

    if (count >= maxPerSource) {
      continue;
    }

    selected.push(doc);
    seenIds.add(doc.id);
    sourceCounts.set(sourceKey, count + 1);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function getFreshnessAdjustedScore(score: number, sortTime: Date, cutoff: Date, now: Date) {
  const windowMs = Math.max(now.getTime() - cutoff.getTime(), 1);
  const ageMs = Math.max(now.getTime() - sortTime.getTime(), 0);
  const freshnessRatio = Math.max(0, 1 - ageMs / windowMs);
  return score + freshnessRatio * MAX_FRESHNESS_BOOST;
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
  updatedAt: Date;
}

export interface PersonalizedFeedDocument {
  id: number;
  title: string;
  summary: string | null;
  canonicalUrl: string;
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
  sourceName: string;
  sourceSlug: string;
  canonicalDomain: string;
  category: SourceCategory;
  sourcePublishedAt: Date | null;
  discoveredAt: Date;
  sortTime: Date;
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
  return value.trim().replace(/\s+/g, " ") || fallback;
}

function normalizedProfileNameSql(value: string) {
  return value.trim().toLowerCase();
}

function stripHtml(value: string) {
  return value
    .replace(/<\/(p|div|li|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractFirstParagraph(summary: string | null, bodyText: string | null) {
  const bodyParagraphs = bodyText
    ? stripHtml(bodyText)
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
    : [];

  if (bodyParagraphs.length > 0) {
    return bodyParagraphs[0]!.slice(0, 420);
  }

  const summaryText = summary ? stripHtml(summary) : "";
  return summaryText ? summaryText.slice(0, 420) : "No first paragraph was extracted yet.";
}


function normalizeProfileRow(row: {
  id: number;
  slug: string;
  displayName: string;
  interestStatement: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    interestStatement: row.interestStatement,
    updatedAt: row.updatedAt,
  } satisfies FeedUserProfile;
}

function mapCandidateRow(row: CandidateDocumentRow) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    canonicalUrl: row.canonicalUrl,
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
    isRead: false,
    readAt: null,
  } satisfies PersonalizedFeedDocument;
}

function buildTopStoriesSummaryCacheKey(timeWindow: TimeWindow, documents: PersonalizedFeedDocument[]) {
  const storyIds = documents.slice(0, MAX_SELECTED_DOCUMENTS).map((document) => document.id);
  const cacheInput = `${TOP_STORIES_SUMMARY_CACHE_PREFIX}:${timeWindow}:${storyIds.join(",")}`;
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
        : "Use the top stories as a reading list: compare the recurring technologies, companies, and product decisions they mention, then follow the highest-signal topics into primary docs, technical posts, benchmarks, and market analysis.",
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

  await db
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
    });
}

async function summarizeTopDocumentsForProfile(
  profile: FeedUserProfile,
  documents: PersonalizedFeedDocument[],
  timeWindow: TimeWindow,
  options: { forceRefresh?: boolean } = {},
): Promise<ProfileTopStoriesSummary | null> {
  const env = loadWebEnv();

  if (!profile.interestStatement.trim() || documents.length === 0) {
    return null;
  }

  const storyIds = documents.slice(0, MAX_SELECTED_DOCUMENTS).map((document) => document.id);
  const cacheKey = buildTopStoriesSummaryCacheKey(timeWindow, documents);

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

  if (!env.openRouterApiKey) {
    return null;
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
        whyRelevant: document.whyRelevant,
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

    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`[feed] Failed to summarize top stories for profile ${profile.id}: ${message}`);
    return null;
  }
}

async function getCandidateDocuments(cutoff: Date) {
  const db = getDb();
  const selectShape = {
    id: schema.documents.id,
    title: schema.documents.title,
    summary: schema.documents.summary,
    bodyText: schema.documents.bodyText,
    canonicalUrl: schema.documents.canonicalUrl,
    sourceName: schema.sources.name,
    sourceSlug: schema.sources.slug,
    canonicalDomain: schema.sources.canonicalDomain,
    category: schema.sources.category,
    sourcePublishedAt: schema.documents.sourcePublishedAt,
    discoveredAt: schema.documents.discoveredAt,
    sortTime: documentSortKey,
  };

  const rows = await db
    .select(selectShape)
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(gt(documentSortKey, cutoff))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
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
}

async function getProfiles(userId: number) {
  await ensureDefaultUserProfile(userId);

  const db = getDb();
  const rows = await db
    .select({
      id: schema.userProfiles.id,
      slug: schema.userProfiles.slug,
      displayName: schema.userProfiles.displayName,
      interestStatement: schema.userProfiles.interestStatement,
      updatedAt: schema.userProfiles.updatedAt,
    })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.userId, userId), eq(schema.userProfiles.isActive, true)))
    .orderBy(desc(schema.userProfiles.updatedAt), asc(schema.userProfiles.displayName));

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
  const normalizedDisplayName = normalizeProfileDisplayName(displayName, "New analyst");
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
        interestStatement: interestStatement.trim(),
      })
      .returning({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
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
    })
    .from(schema.userProfiles)
    .where(and(eq(schema.userProfiles.id, profileId), eq(schema.userProfiles.userId, userId)))
    .limit(1);

  if (!existingProfile) {
    throw new Error(`User profile ${profileId} was not found`);
  }

  const normalizedDisplayName = normalizeProfileDisplayName(displayName, "Untitled analyst");
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
        updatedAt: Date;
      }
    | undefined;

  try {
    [updatedProfile] = await db
      .update(schema.userProfiles)
      .set({
        displayName: normalizedDisplayName,
        interestStatement: interestStatement.trim(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.userProfiles.id, profileId), eq(schema.userProfiles.userId, userId)))
      .returning({
        id: schema.userProfiles.id,
        slug: schema.userProfiles.slug,
        displayName: schema.userProfiles.displayName,
        interestStatement: schema.userProfiles.interestStatement,
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

  await db
    .update(schema.userProfiles)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.userProfiles.id, profileId), eq(schema.userProfiles.userId, userId)));

  const nextProfile = profiles.find((profile) => profile.id !== profileId) ?? null;

  return {
    deletedProfile: profileToDelete,
    nextProfile,
  };
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
  const profiles = await getProfiles(ownerUserId);
  const selectedProfile = profiles.find((profile) => profile.slug === profileSlug) ?? profiles[0];

  if (!selectedProfile) {
    throw new Error("Expected at least one active user profile");
  }

  const cutoff = getTimeWindowCutoff(timeWindow);
  const windowLabel = TIME_WINDOW_LABELS[timeWindow];
  const candidateDocuments = await getCandidateDocuments(cutoff);
  const defaultShortlist = selectTopDocuments(candidateDocuments, [], MAX_SELECTED_DOCUMENTS, MAX_PER_SOURCE);

  function buildRemainingDocuments(excludeIds: Set<number>) {
    return candidateDocuments
      .filter((d) => !excludeIds.has(d.id))
      .sort(compareBySortTimeDescThenIdDesc);
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

  async function withReadState(topDocuments: PersonalizedFeedDocument[], remainingDocuments: PersonalizedFeedDocument[]) {
    if (!readStateUserId) {
      return {
        topDocuments,
        remainingDocuments,
      };
    }

    const [readTopDocuments, readRemainingDocuments] = await Promise.all([
      applyReadStateToDocuments(readStateUserId, topDocuments),
      applyReadStateToDocuments(readStateUserId, remainingDocuments),
    ]);

    return {
      topDocuments: readTopDocuments,
      remainingDocuments: readRemainingDocuments,
    };
  }

  if (!selectedProfile.interestStatement.trim()) {
    const topIds = new Set(defaultShortlist.map((d) => d.id));
    const documentsWithReadState = await withReadState(defaultShortlist, buildRemainingDocuments(topIds));
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

  // Try pre-computed scores — fetch top scored documents directly from DB
  const db = getDb();
  const scoredRows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: schema.documents.bodyText,
      canonicalUrl: schema.documents.canonicalUrl,
      sourceName: schema.sources.name,
      sourceSlug: schema.sources.slug,
      canonicalDomain: schema.sources.canonicalDomain,
      category: schema.sources.category,
      sourcePublishedAt: schema.documents.sourcePublishedAt,
      discoveredAt: schema.documents.discoveredAt,
      sortTime: documentSortKey,
      score: schema.documentScores.score,
      whyRelevant: schema.documentScores.whyRelevant,
      model: schema.documentScores.model,
    })
    .from(schema.documentScores)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(
      and(
        eq(schema.documentScores.profileId, selectedProfile.id),
        gt(documentSortKey, cutoff),
      ),
    )
    .orderBy(desc(schema.documentScores.score), desc(documentSortKey), desc(schema.documents.id))
    .limit(MAX_CANDIDATE_DOCUMENTS);

  if (scoredRows.length > 0) {
    const rankedScoredRows = scoredRows
      .map((row) => ({
        row,
        adjustedScore: getFreshnessAdjustedScore(
          row.score,
          row.sortTime instanceof Date ? row.sortTime : new Date(row.sortTime),
          cutoff,
          new Date(),
        ),
      }))
      .sort((a, b) => {
        if (b.adjustedScore !== a.adjustedScore) {
          return b.adjustedScore - a.adjustedScore;
        }

        return compareBySortTimeDescThenIdDesc(a.row, b.row);
      });

    const scoredDocs: PersonalizedFeedDocument[] = rankedScoredRows.map(({ row }, index) => ({
      ...mapCandidateRow(row),
      llmRank: index + 1,
      matchScore: row.score,
      whyRelevant: row.whyRelevant,
    }));

    const scoredIds = new Set(scoredDocs.map((d) => d.id));
    const unscoredCandidates = candidateDocuments.filter((d) => !scoredIds.has(d.id));

    const topDocuments = selectTopDocuments(scoredDocs, unscoredCandidates, MAX_SELECTED_DOCUMENTS, MAX_PER_SOURCE);
    const topIds = new Set(topDocuments.map((d) => d.id));
    const remaining = [
      ...scoredDocs.filter((d) => !topIds.has(d.id)),
      ...unscoredCandidates,
    ];

    const firstModel = rankedScoredRows[0]?.row.model ?? null;
    const [documentsWithReadState, topStoriesSummary] = await Promise.all([
      withReadState(topDocuments, remaining),
      summarizeTopDocumentsForProfile(selectedProfile, topDocuments, timeWindow, {
        forceRefresh: forceSummaryRefresh,
      }),
    ]);

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
  const [documentsWithReadState, topStoriesSummary] = await Promise.all([
    withReadState(defaultShortlist, remainingDocuments),
    summarizeTopDocumentsForProfile(selectedProfile, defaultShortlist, timeWindow, {
      forceRefresh: forceSummaryRefresh,
    }),
  ]);
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

export async function getPublicAiEngineerFeedSnapshot(timeWindow: TimeWindow = "week"): Promise<PersonalizedFeedSnapshot> {
  const db = getDb();
  const [publicOwner] = await db
    .select({ id: schema.authUsers.id })
    .from(schema.authUsers)
    .where(and(eq(schema.authUsers.email, PUBLIC_FEED_OWNER_EMAIL), eq(schema.authUsers.isActive, true)))
    .limit(1);

  if (!publicOwner) {
    throw new Error(`Public feed owner ${PUBLIC_FEED_OWNER_EMAIL} was not found`);
  }

  return buildPersonalizedFeedSnapshot({
    profileSlug: PUBLIC_FEED_PROFILE_SLUG,
    timeWindow,
    ownerUserId: publicOwner.id,
    readStateUserId: null,
  });
}
