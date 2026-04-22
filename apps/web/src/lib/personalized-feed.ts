import type { SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { loadWebEnv } from "@/lib/env";
import { rankDocumentsForInterest } from "@/lib/openrouter";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const MAX_CANDIDATE_DOCUMENTS = 60;
const MAX_SELECTED_DOCUMENTS = 10;

const defaultUserProfile = {
  slug: "founding-analyst",
  displayName: "Founding analyst",
  interestStatement:
    "I care about AI coding tools, agent tooling, inference infrastructure, model serving, pricing changes, and stories that reveal product wedges or operational bottlenecks.",
};

function isDefined<T>(value: T | null): value is T {
  return value !== null;
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
  category: SourceCategory;
  sourcePublishedAt: Date | null;
  discoveredAt: Date;
  sortTime: Date;
  previewParagraph: string;
  llmRank: number | null;
  matchScore: number | null;
  whyRelevant: string | null;
}

export interface PersonalizedFeedSnapshot {
  profiles: FeedUserProfile[];
  selectedProfile: FeedUserProfile;
  topDocuments: PersonalizedFeedDocument[];
  candidateCount: number;
  rankingMode: "interest_ranked" | "latest";
  rankingSummary: string;
  rankingStatusLabel: string;
  model: string | null;
  windowLabel: string;
}

interface CandidateDocumentRow {
  id: number;
  title: string;
  summary: string | null;
  bodyText: string | null;
  canonicalUrl: string;
  sourceName: string;
  sourceSlug: string;
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

function formatDayLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
    timeZoneName: "short",
  }).format(date);
}

function buildTodayWindowFilter(timeZone: string) {
  return sql<boolean>`date(timezone(${timeZone}, ${documentSortKey})) = date(timezone(${timeZone}, now()))`;
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
    category: row.category,
    sourcePublishedAt: row.sourcePublishedAt,
    discoveredAt: row.discoveredAt,
    sortTime: row.sortTime,
    previewParagraph: extractFirstParagraph(row.summary, row.bodyText),
    llmRank: null,
    matchScore: null,
    whyRelevant: null,
  } satisfies PersonalizedFeedDocument;
}

async function getCandidateDocuments(useTodayWindow: boolean, timeZone: string) {
  const db = getDb();
  const selectShape = {
    id: schema.documents.id,
    title: schema.documents.title,
    summary: schema.documents.summary,
    bodyText: schema.documents.bodyText,
    canonicalUrl: schema.documents.canonicalUrl,
    sourceName: schema.sources.name,
    sourceSlug: schema.sources.slug,
    category: schema.sources.category,
    sourcePublishedAt: schema.documents.sourcePublishedAt,
    discoveredAt: schema.documents.discoveredAt,
    sortTime: documentSortKey,
  };

  const rows = useTodayWindow
    ? await db
        .select(selectShape)
        .from(schema.documents)
        .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
        .where(buildTodayWindowFilter(timeZone))
        .orderBy(desc(documentSortKey))
        .limit(MAX_CANDIDATE_DOCUMENTS)
    : await db
        .select(selectShape)
        .from(schema.documents)
        .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
        .orderBy(desc(documentSortKey))
        .limit(MAX_CANDIDATE_DOCUMENTS);

  return rows.map((row) => mapCandidateRow(row));
}

async function ensureDefaultUserProfile() {
  const db = getDb();

  await db.insert(schema.userProfiles).values(defaultUserProfile).onConflictDoNothing({
    target: schema.userProfiles.slug,
  });
}

async function getProfiles() {
  await ensureDefaultUserProfile();

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
    .where(eq(schema.userProfiles.isActive, true))
    .orderBy(asc(schema.userProfiles.displayName));

  return rows.map((row) => normalizeProfileRow(row));
}

async function getUniqueProfileSlug(baseSlug: string) {
  const db = getDb();
  const existingRows = await db.select({ slug: schema.userProfiles.slug }).from(schema.userProfiles);
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

export async function createUserProfile({
  displayName,
  interestStatement,
}: {
  displayName: string;
  interestStatement: string;
}) {
  await ensureDefaultUserProfile();

  const db = getDb();
  const normalizedDisplayName = displayName.trim() || "New analyst";
  const slug = await getUniqueProfileSlug(slugifyDisplayName(normalizedDisplayName));

  const [createdProfile] = await db
    .insert(schema.userProfiles)
    .values({
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

  if (!createdProfile) {
    throw new Error("Failed to create user profile");
  }

  return normalizeProfileRow(createdProfile);
}

export async function updateUserProfile({
  profileId,
  displayName,
  interestStatement,
}: {
  profileId: number;
  displayName: string;
  interestStatement: string;
}) {
  const db = getDb();

  const [updatedProfile] = await db
    .update(schema.userProfiles)
    .set({
      displayName: displayName.trim() || "Untitled analyst",
      interestStatement: interestStatement.trim(),
      updatedAt: new Date(),
    })
    .where(eq(schema.userProfiles.id, profileId))
    .returning({
      id: schema.userProfiles.id,
      slug: schema.userProfiles.slug,
      displayName: schema.userProfiles.displayName,
      interestStatement: schema.userProfiles.interestStatement,
      updatedAt: schema.userProfiles.updatedAt,
    });

  if (!updatedProfile) {
    throw new Error(`User profile ${profileId} was not found`);
  }

  return normalizeProfileRow(updatedProfile);
}

export async function getPersonalizedFeedSnapshot(profileSlug?: string | null): Promise<PersonalizedFeedSnapshot> {
  const env = loadWebEnv();
  const profiles = await getProfiles();
  const selectedProfile = profiles.find((profile) => profile.slug === profileSlug) ?? profiles[0];

  if (!selectedProfile) {
    throw new Error("Expected at least one active user profile");
  }

  const todayWindowLabel = `Stories published on ${formatDayLabel(new Date(), env.appTimeZone)}`;
  const todayCandidates = await getCandidateDocuments(true, env.appTimeZone);
  const fallbackCandidates = todayCandidates.length > 0 ? todayCandidates : await getCandidateDocuments(false, env.appTimeZone);
  const usingTodayWindow = todayCandidates.length > 0;
  const candidateDocuments = fallbackCandidates;
  const defaultShortlist = candidateDocuments.slice(0, MAX_SELECTED_DOCUMENTS);
  const windowLabel = usingTodayWindow
    ? todayWindowLabel
    : `Latest captured stories as of ${formatDayLabel(new Date(), env.appTimeZone)}`;

  if (candidateDocuments.length === 0) {
    return {
      profiles,
      selectedProfile,
      topDocuments: [],
      candidateCount: 0,
      rankingMode: "latest",
      rankingSummary: "No documents are available yet. Run the worker again after more sources publish updates.",
      rankingStatusLabel: "Awaiting documents",
      model: null,
      windowLabel,
    };
  }

  if (!selectedProfile.interestStatement.trim()) {
    return {
      profiles,
      selectedProfile,
      topDocuments: defaultShortlist,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary: `No interest statement is saved for ${selectedProfile.displayName} yet, so this feed is showing the newest stories in the current window.`,
      rankingStatusLabel: "Newest first",
      model: null,
      windowLabel,
    };
  }

  if (!env.openRouterApiKey) {
    return {
      profiles,
      selectedProfile,
      topDocuments: defaultShortlist,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary:
        "OpenRouter is not configured yet, so the feed is falling back to the newest stories. Add OPENROUTER_API_KEY to enable interest-based ranking.",
      rankingStatusLabel: "Newest first",
      model: null,
      windowLabel,
    };
  }

  try {
    const rankingResult = await rankDocumentsForInterest({
      interestStatement: selectedProfile.interestStatement,
      profileSlug: selectedProfile.slug,
      windowLabel,
      candidates: candidateDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        previewParagraph: document.previewParagraph,
      })),
    });

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
      .filter(isDefined)
      .slice(0, MAX_SELECTED_DOCUMENTS)
      .sort((left, right) => right.sortTime.getTime() - left.sortTime.getTime());

    if (rankedDocuments.length === 0) {
      throw new Error("The ranking response did not map to any candidate documents");
    }

    const rankingSummary = usingTodayWindow
      ? rankingResult.ranking.shortlistSummary
      : `No stories were captured in today's ${env.appTimeZone} window yet, so the model ranked the latest captured stories instead. ${rankingResult.ranking.shortlistSummary}`;

    return {
      profiles,
      selectedProfile,
      topDocuments: rankedDocuments,
      candidateCount: candidateDocuments.length,
      rankingMode: "interest_ranked",
      rankingSummary,
      rankingStatusLabel: "Matched by interest, then ordered by time",
      model: rankingResult.model,
      windowLabel,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ranking error";

    return {
      profiles,
      selectedProfile,
      topDocuments: defaultShortlist,
      candidateCount: candidateDocuments.length,
      rankingMode: "latest",
      rankingSummary: `Interest ranking fell back to the newest stories because the OpenRouter request failed: ${message}`,
      rankingStatusLabel: "Newest first",
      model: env.openRouterModel,
      windowLabel,
    };
  }
}
