import { createHash } from "node:crypto";
import type { SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, asc, desc, eq, gt, ne, sql } from "drizzle-orm";
import { loadWebEnv } from "@/lib/env";
import type { InterestRankingResponse } from "@/lib/openrouter";
import { rankDocumentsForInterest } from "@/lib/openrouter";
import { applyReadStateToDocuments } from "@/lib/read-tracking";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 200;
const MAX_SELECTED_DOCUMENTS = 10;
const MAX_PER_SOURCE = 5;
const RANKING_CACHE_TTL_HOURS = 6;
const RANKING_CACHE_VERSION = 2;

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

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}

function capPerSource(docs: PersonalizedFeedDocument[], maxPerSource: number): PersonalizedFeedDocument[] {
  const sourceCounts = new Map<string, number>();
  return docs.filter((doc) => {
    const sourceKey = doc.sourceGroupKey;
    const count = sourceCounts.get(sourceKey) ?? 0;
    if (count >= maxPerSource) return false;
    sourceCounts.set(sourceKey, count + 1);
    return true;
  });
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

export interface PersonalizedFeedSnapshot {
  profiles: FeedUserProfile[];
  selectedProfile: FeedUserProfile;
  topDocuments: PersonalizedFeedDocument[];
  remainingDocuments: PersonalizedFeedDocument[];
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
    .orderBy(desc(documentSortKey))
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

function buildCandidatesHash(profileId: number, interestStatement: string, candidateIds: number[]): string {
  const payload = [RANKING_CACHE_VERSION, profileId, interestStatement, ...candidateIds.sort((a, b) => a - b)].join(
    "|",
  );
  return createHash("sha256").update(payload).digest("hex");
}

async function getCachedRanking(profileId: number, candidatesHash: string): Promise<{ model: string | null; ranking: InterestRankingResponse } | null> {
  const db = getDb();

  const [cached] = await db
    .select({
      model: schema.rankingCache.model,
      rankingJson: schema.rankingCache.rankingJson,
    })
    .from(schema.rankingCache)
    .where(
      and(
        eq(schema.rankingCache.profileId, profileId),
        eq(schema.rankingCache.candidatesHash, candidatesHash),
        gt(schema.rankingCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!cached) return null;

  return {
    model: cached.model,
    ranking: cached.rankingJson as InterestRankingResponse,
  };
}

async function setCachedRanking(profileId: number, candidatesHash: string, model: string | null, ranking: InterestRankingResponse): Promise<void> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + RANKING_CACHE_TTL_HOURS * 60 * 60 * 1000);

  await db
    .insert(schema.rankingCache)
    .values({
      profileId,
      candidatesHash,
      model,
      rankingJson: ranking,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [schema.rankingCache.profileId, schema.rankingCache.candidatesHash],
      set: {
        model,
        rankingJson: ranking,
        expiresAt,
        createdAt: new Date(),
      },
    });
}

export async function getPersonalizedFeedSnapshot(
  profileSlug?: string | null,
  timeWindow: TimeWindow = "week",
  currentUserId?: number,
): Promise<PersonalizedFeedSnapshot> {
  const env = loadWebEnv();

  if (!currentUserId) {
    throw new Error("Expected current user id when building personalized feed");
  }

  const profiles = await getProfiles(currentUserId);
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
      .sort((a, b) => {
        const aTime = a.sortTime instanceof Date ? a.sortTime.getTime() : new Date(a.sortTime).getTime();
        const bTime = b.sortTime instanceof Date ? b.sortTime.getTime() : new Date(b.sortTime).getTime();
        return bTime - aTime;
      });
  }

  if (candidateDocuments.length === 0) {
    return {
      profiles,
      selectedProfile,
      topDocuments: [],
      remainingDocuments: [],
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
    if (!currentUserId) {
      return {
        topDocuments,
        remainingDocuments,
      };
    }

    const [readTopDocuments, readRemainingDocuments] = await Promise.all([
      applyReadStateToDocuments(currentUserId, topDocuments),
      applyReadStateToDocuments(currentUserId, remainingDocuments),
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
    .orderBy(desc(schema.documentScores.score))
    .limit(MAX_CANDIDATE_DOCUMENTS);

  if (scoredRows.length > 0) {
    const scoredDocs: PersonalizedFeedDocument[] = scoredRows.map((row, index) => ({
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

    const firstModel = scoredRows[0]?.model ?? null;
    const documentsWithReadState = await withReadState(topDocuments, remaining);

    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      candidateCount: candidateDocuments.length,
      rankingMode: "interest_ranked",
      rankingSummary: "Ranked by pre-computed relevance scores.",
      rankingStatusLabel: "Ranked by relevance",
      model: firstModel,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }

  // Fallback: on-demand ranking via OpenRouter
  if (!env.openRouterApiKey) {
    const topIds = new Set(defaultShortlist.map((d) => d.id));
    const documentsWithReadState = await withReadState(defaultShortlist, buildRemainingDocuments(topIds));
    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary:
        "OpenRouter is not configured yet, so the feed is falling back to the newest stories. Add OPENROUTER_API_KEY to enable interest-based ranking.",
      rankingStatusLabel: "Newest first",
      model: null,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }

  try {
    const candidateIds = candidateDocuments.map((d) => d.id);
    const candidatesHash = buildCandidatesHash(selectedProfile.id, selectedProfile.interestStatement, candidateIds);

    const cached = await getCachedRanking(selectedProfile.id, candidatesHash);

    const rankingResult = cached ?? await (async () => {
      const fresh = await rankDocumentsForInterest({
        interestStatement: selectedProfile.interestStatement,
        profileSlug: selectedProfile.slug,
        candidates: candidateDocuments.map((document) => ({
          id: document.id,
          title: document.title,
          previewParagraph: document.previewParagraph,
        })),
      });

      await setCachedRanking(selectedProfile.id, candidatesHash, fresh.model, fresh.ranking);

      return { model: fresh.model, ranking: fresh.ranking };
    })();

    const candidateById = new Map(candidateDocuments.map((document) => [document.id, document]));
    const seenIds = new Set<number>();
    const rankedDocuments = rankingResult.ranking.selectedDocuments
      .map<PersonalizedFeedDocument | null>((selection, index) => {
        if (seenIds.has(selection.documentId)) {
          return null;
        }

        const document = candidateById.get(selection.documentId);

        if (!document) {
          return null;
        }

        seenIds.add(selection.documentId);

        return {
          ...document,
          llmRank: index + 1,
          matchScore: selection.score,
          whyRelevant: selection.whyRelevant,
        } satisfies PersonalizedFeedDocument;
      })
      .filter(isDefined);

    const rankedCapped = selectTopDocuments(rankedDocuments, candidateDocuments, MAX_SELECTED_DOCUMENTS, MAX_PER_SOURCE);

    if (rankedCapped.length === 0) {
      throw new Error("The ranking response did not map to any candidate documents");
    }

    const fromCache = cached !== null;
    const rankingSummary = rankingResult.ranking.shortlistSummary;

    const rankedIds = new Set(rankedCapped.map((d) => d.id));
    const remaining = [
      ...rankedDocuments.filter((d) => !rankedIds.has(d.id)),
      ...candidateDocuments.filter((d) => !rankedIds.has(d.id) && !rankedDocuments.some((ranked) => ranked.id === d.id)),
    ];
    const documentsWithReadState = await withReadState(rankedCapped, remaining);

    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      candidateCount: candidateDocuments.length,
      rankingMode: "interest_ranked",
      rankingSummary: fromCache ? `${rankingSummary} (cached)` : rankingSummary,
      rankingStatusLabel: "Ranked by relevance",
      model: rankingResult.model,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ranking error";
    console.error("[personalized-feed] Interest ranking failed:", message, error);

    const topIds = new Set(defaultShortlist.map((d) => d.id));
    const documentsWithReadState = await withReadState(defaultShortlist, buildRemainingDocuments(topIds));
    return {
      profiles,
      selectedProfile,
      topDocuments: documentsWithReadState.topDocuments,
      remainingDocuments: documentsWithReadState.remainingDocuments,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary: `Interest ranking fell back to the newest stories because the OpenRouter request failed: ${message}`,
      rankingStatusLabel: "Newest first",
      model: env.openRouterModel,
      windowLabel,
      activeTimeWindow: timeWindow,
    };
  }
}
