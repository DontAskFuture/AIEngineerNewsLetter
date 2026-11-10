import {
  OPINION_NOT_REQUIRED,
  OPINION_PENDING_TEXT,
  TAKE_WITHHELD_TEXT,
  applyOpinionToStoredWhyRelevant,
  classifyStoryTopicsBatch,
  computeAdjustedStoryScore,
  decideStoryRelevanceBatch,
  deduplicateScoringCandidates,
  extractDocumentPreview,
  hasStoredPractitionerTake,
  parseWhyRelevantMetadata,
  scoringConfig,
  selectDiverseShortlist,
  type StoryRelevanceInput,
  type StoryRelevanceOutcome,
} from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, gt, gte, isNull, like, notInArray, or, sql } from "drizzle-orm";
import { loadWebEnv } from "@/lib/env";
import { writeStoryOpinions } from "@/lib/openrouter";
import {
  startScoringJob,
  updateScoringBatch,
  completeScoringJob,
  failScoringJob,
} from "@/lib/scoring-tracker";
export type { ScoringJobState } from "@/lib/scoring-tracker";
export { getScoringJobState } from "@/lib/scoring-tracker";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const DEFAULT_LOOKBACK_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_TAKE_CANDIDATE_LIMIT = 200;

async function persistTopics(topics: Array<{ documentId: number; topic: string }>) {
  if (topics.length === 0) return;
  const db = getDb();
  for (const topic of topics) {
    await db
      .update(schema.documents)
      .set({ storyTopic: topic.topic })
      .where(and(eq(schema.documents.id, topic.documentId), isNull(schema.documents.storyTopic)));
  }
}

async function persistOpinions(
  profileId: number,
  model: string,
  opinions: Array<{ documentId: number; whyRelevant: string; matchedSignals: string[] }>,
  duplicateIdsByRepresentative: Map<number, number[]>,
  storedWhyRelevantByDocument: Map<number, string>,
) {
  if (opinions.length === 0) return;
  const db = getDb();
  for (const opinion of opinions) {
    const targetIds = duplicateIdsByRepresentative.get(opinion.documentId) ?? [opinion.documentId];
    for (const documentId of targetIds) {
      const existing = storedWhyRelevantByDocument.get(documentId) ?? storedWhyRelevantByDocument.get(opinion.documentId) ?? "";
      await db
        .update(schema.documentScores)
        .set({
          whyRelevant: applyOpinionToStoredWhyRelevant({
            existingWhyRelevant: existing,
            opinion: opinion.whyRelevant,
            matchedSignals: opinion.matchedSignals,
          }),
          opinionModel: model,
        })
        .where(and(
          eq(schema.documentScores.documentId, documentId),
          eq(schema.documentScores.profileId, profileId),
          or(
            isNull(schema.documentScores.opinionModel),
            eq(schema.documentScores.opinionModel, OPINION_NOT_REQUIRED),
            like(schema.documentScores.whyRelevant, `${OPINION_PENDING_TEXT}%`),
            like(schema.documentScores.whyRelevant, `${TAKE_WITHHELD_TEXT}%`),
          ),
        ));
    }
  }
}

export interface ScoringProgress {
  totalUnscored: number;
  scored: number;
  failed: number;
  batches: number;
}

export async function scoreUnscoredDocuments(profileId: number): Promise<ScoringProgress> {
  const db = getDb();
  const env = loadWebEnv();

  if (!env.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const [profile] = await db
    .select({
      id: schema.userProfiles.id,
      userId: schema.userProfiles.userId,
      displayName: schema.userProfiles.displayName,
      interestStatement: schema.userProfiles.interestStatement,
    })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.id, profileId))
    .limit(1);

  if (!profile || !profile.interestStatement.trim()) {
    throw new Error(`Profile ${profileId} not found or has no interest statement`);
  }

  const alreadyScoredIds = db
    .select({ documentId: schema.documentScores.documentId })
    .from(schema.documentScores)
    .where(eq(schema.documentScores.profileId, profileId));
  const cutoff = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS);

  const unscoredDocs = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      storyTopic: schema.documents.storyTopic,
      sortTime: documentSortKey,
    })
    .from(schema.documents)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(
      and(
        notInArray(schema.documents.id, alreadyScoredIds),
        gt(documentSortKey, cutoff),
      ),
    )
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(scoringConfig.maxDocumentsPerRun);

  const docsWithPreviews = unscoredDocs.map((doc) => ({
    ...doc,
    previewParagraph: extractDocumentPreview(doc.summary, doc.bodyText),
  }));
  const deduplicatedGroups = deduplicateScoringCandidates(docsWithPreviews);

  const progress: ScoringProgress = {
    totalUnscored: unscoredDocs.length,
    scored: 0,
    failed: 0,
    batches: Math.ceil(deduplicatedGroups.length / scoringConfig.batchSize),
  };

  if (unscoredDocs.length === 0) {
    await backfillStoryTopics(env.openRouterApiKey ?? "", env.appBaseUrl ?? "http://localhost:3000", cutoff);
    await writeDailyTakes({
      profileId,
      userId: profile.userId,
      profileName: profile.displayName,
      interestStatement: profile.interestStatement,
    });
    return progress;
  }

  const jobId = await startScoringJob(profileId, unscoredDocs.length, progress.batches);
  let lastBatchError: string | null = null;

  try {
    for (let i = 0; i < deduplicatedGroups.length; i += scoringConfig.batchSize) {
      const batchGroups = deduplicatedGroups.slice(i, i + scoringConfig.batchSize);
      const batchNumber = Math.floor(i / scoringConfig.batchSize) + 1;
      const batchDocumentCount = batchGroups.reduce(
        (sum, group) => sum + group.duplicateIds.length,
        0,
      );

      const duplicateTargetIdsByRepresentative = new Map<number, number[]>();
      const stories: StoryRelevanceInput[] = batchGroups.map((group) => {
        const doc = group.representative;
        duplicateTargetIdsByRepresentative.set(doc.id, group.duplicateIds);
        return {
          id: doc.id,
          title: doc.title,
          excerpt: doc.previewParagraph,
          sourceName: doc.sourceName,
          sourceCategory: doc.sourceCategory,
          storyTopic: doc.storyTopic,
        };
      });

      try {
        const outcomes = await decideStoryRelevanceBatch({
          apiKey: env.openRouterApiKey ?? "",
          interestStatement: profile.interestStatement,
          stories,
          referer: env.appBaseUrl ?? "http://localhost:3000",
        });
        const successes = outcomes.filter((outcome): outcome is Extract<StoryRelevanceOutcome, { ok: true }> => outcome.ok);
        const failures = outcomes.filter((outcome) => !outcome.ok);

        const [currentProfile] = await db
          .select({ interestStatement: schema.userProfiles.interestStatement })
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.id, profileId))
          .limit(1);

        if (
          !currentProfile ||
          currentProfile.interestStatement.trim() !== profile.interestStatement.trim()
        ) {
          break;
        }

        if (successes.length === 0) {
          throw new Error(failures[0] && "error" in failures[0] ? failures[0].error : "Decider returned no relevance scores");
        }

        const expandedScores = successes.flatMap((decision) => {
          const targetIds = duplicateTargetIdsByRepresentative.get(decision.documentId) ?? [decision.documentId];
          return targetIds.map((documentId) => ({
            documentId,
            score: decision.score,
            whyRelevant: decision.whyRelevant,
            model: decision.model,
            opinionModel: decision.opinionModel,
          }));
        });

        await db
          .insert(schema.documentScores)
          .values(
            expandedScores.map((s) => ({
              documentId: s.documentId,
              profileId,
              score: s.score,
              whyRelevant: s.whyRelevant,
              model: s.model,
              opinionModel: s.opinionModel,
            })),
          )
          .onConflictDoUpdate({
            target: [schema.documentScores.documentId, schema.documentScores.profileId],
            set: {
              score: sql`excluded.score`,
              whyRelevant: sql`excluded.why_relevant`,
              model: sql`excluded.model`,
              opinionModel: sql`excluded.opinion_model`,
              scoredAt: new Date(),
            },
          });

        const topicWrites = successes.flatMap((decision) => {
          const story = stories.find((candidate) => candidate.id === decision.documentId);
          if (!decision.topic || story?.storyTopic) return [];
          const targetIds = duplicateTargetIdsByRepresentative.get(decision.documentId) ?? [decision.documentId];
          return targetIds.map((documentId) => ({ documentId, topic: decision.topic as string }));
        });
        await persistTopics(topicWrites);

        progress.scored += expandedScores.length;

        const missedCount = Math.max(0, batchDocumentCount - expandedScores.length);
        if (missedCount > 0) {
          progress.failed += missedCount;
        }

        await updateScoringBatch(jobId, batchNumber, expandedScores.length, missedCount);

        console.log(
          `[scoring] Batch ${batchNumber}/${progress.batches}: scored ${expandedScores.length}/${batchDocumentCount} docs`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        lastBatchError = message;
        console.error(`[scoring] Batch ${batchNumber} failed:`, message);
        progress.failed += batchDocumentCount;
        await updateScoringBatch(jobId, batchNumber, 0, batchDocumentCount);
      }
    }

    if (progress.scored === 0 && progress.failed > 0) {
      await failScoringJob(jobId, lastBatchError ?? "All scoring batches failed");
    } else {
      await completeScoringJob(jobId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await failScoringJob(jobId, message);
    throw error;
  }

  await backfillStoryTopics(env.openRouterApiKey ?? "", env.appBaseUrl ?? "http://localhost:3000", cutoff);
  await writeDailyTakes({
    profileId,
    userId: profile.userId,
    profileName: profile.displayName,
    interestStatement: profile.interestStatement,
  });
  return progress;
}

async function backfillStoryTopics(apiKey: string, referer: string, cutoff: Date) {
  if (!apiKey) return;
  const db = getDb();
  const skipped = new Set<number>();
  let considered = 0;

  while (considered < scoringConfig.maxDocumentsPerRun) {
    const filters = [isNull(schema.documents.storyTopic), gt(documentSortKey, cutoff)];
    if (skipped.size > 0) {
      filters.push(notInArray(schema.documents.id, Array.from(skipped)));
    }
    const rows = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        summary: schema.documents.summary,
        bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
        sourceName: schema.sources.name,
        sourceCategory: schema.sources.category,
      })
      .from(schema.documents)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
      .where(and(...filters))
      .orderBy(desc(documentSortKey), desc(schema.documents.id))
      .limit(Math.min(scoringConfig.batchSize, scoringConfig.maxDocumentsPerRun - considered));

    if (rows.length === 0) return;

    const classified = await classifyStoryTopicsBatch({
      apiKey,
      referer,
      stories: rows.map((row) => ({
        id: row.id,
        title: row.title,
        excerpt: extractDocumentPreview(row.summary, row.bodyText),
        sourceName: row.sourceName,
        sourceCategory: row.sourceCategory,
        storyTopic: null,
      })),
    });
    const writes = classified.flatMap((row) => (row.topic ? [{ documentId: row.documentId, topic: row.topic }] : []));
    await persistTopics(writes);
    const written = new Set(writes.map((row) => row.documentId));
    for (const row of rows) {
      if (!written.has(row.id)) skipped.add(row.id);
    }
    considered += rows.length;
  }
}

async function writeDailyTakes({
  profileId,
  userId,
  profileName,
  interestStatement,
}: {
  profileId: number;
  userId: number;
  profileName: string;
  interestStatement: string;
}) {
  const db = getDb();
  const dayCutoff = new Date(Date.now() - DAY_MS);
  const now = Date.now();
  const rows = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceCategory: schema.sources.category,
      sourceGroupKey: schema.sources.canonicalDomain,
      storyTopic: schema.documents.storyTopic,
      trustTier: schema.sources.trustTier,
      sortTime: documentSortKey,
      score: schema.documentScores.score,
      whyRelevant: schema.documentScores.whyRelevant,
      opinionModel: schema.documentScores.opinionModel,
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
    .where(and(
      eq(schema.documentScores.profileId, profileId),
      or(
        and(
          gte(schema.documentScores.score, scoringConfig.minOpinionScore),
          gt(documentSortKey, dayCutoff),
        ),
        eq(schema.storyCurations.isPinned, true),
      ),
    ))
    .orderBy(desc(schema.documentScores.score), desc(documentSortKey))
    .limit(DAILY_TAKE_CANDIDATE_LIMIT);

  const ranked = rows
    .map((row) => {
      const sortTime = new Date(row.sortTime);
      const parsed = parseWhyRelevantMetadata(row.whyRelevant);
      const adjustedScore = computeAdjustedStoryScore({
        score: row.score,
        sortTime,
        cutoff: dayCutoff,
        now,
        freshnessBoostMax: 12,
        trustTier: row.trustTier,
        confidence: parsed.confidence,
        minQualifyingScore: scoringConfig.minOpinionScore,
      });
      return {
        ...row,
        sortTime,
        adjustedScore: adjustedScore ?? row.score,
        isPinned: Boolean(row.isPinned),
        isHidden: Boolean(row.isHidden),
        previewParagraph: extractDocumentPreview(row.summary, row.bodyText),
      };
    })
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      const scoreDiff = (b.adjustedScore ?? 0) - (a.adjustedScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return b.sortTime.getTime() - a.sortTime.getTime();
    });

  const shortlist = selectDiverseShortlist(ranked);
  const shortlistIds = shortlist.map((story) => story.id);
  const retireFilters = [
    eq(schema.documentScores.profileId, profileId),
    like(schema.documentScores.whyRelevant, `${OPINION_PENDING_TEXT}%`),
  ];
  if (shortlistIds.length > 0) {
    retireFilters.push(notInArray(schema.documentScores.documentId, shortlistIds));
  }
  await db
    .update(schema.documentScores)
    .set({
      whyRelevant: sql`replace(${schema.documentScores.whyRelevant}, ${OPINION_PENDING_TEXT}, ${TAKE_WITHHELD_TEXT})`,
      opinionModel: OPINION_NOT_REQUIRED,
    })
    .where(and(...retireFilters));

  const missing = shortlist.filter((story) => !hasStoredPractitionerTake(story.whyRelevant, story.opinionModel));
  if (missing.length === 0) return;

  const storedWhyRelevant = new Map(missing.map((story) => [story.id, story.whyRelevant]));
  const duplicateIds = new Map(missing.map((story) => [story.id, [story.id]]));
  try {
    const opinions = await writeStoryOpinions({
      profileName,
      interestStatement,
      candidates: missing.map((story) => ({
        id: story.id,
        title: story.title,
        previewParagraph: story.previewParagraph ?? "",
        sourceName: story.sourceName,
        sourceCategory: story.sourceCategory,
        publishedAt: story.sortTime,
      })),
    });
    await persistOpinions(profileId, opinions.model, opinions.opinions, duplicateIds, storedWhyRelevant);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[scoring] Daily take generation failed; scores were kept: ${message}`);
  }
}

export async function getScoringStats(profileId: number) {
  const db = getDb();

  const [[totalResult], [scoredResult]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(schema.documents),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.documentScores)
      .where(eq(schema.documentScores.profileId, profileId)),
  ]);

  const totalDocs = totalResult?.count ?? 0;
  const scoredDocs = scoredResult?.count ?? 0;

  return {
    totalDocuments: totalDocs,
    scoredDocuments: scoredDocs,
    unscoredDocuments: totalDocs - scoredDocs,
  };
}

export interface SourceScoringStatus {
  sourceId: number;
  sourceName: string;
  totalDocuments: number;
  scoredDocuments: number;
  unscoredDocuments: number;
  avgScore: number | null;
  minScore: number | null;
  maxScore: number | null;
}

export async function getScoringStatsBySource(profileId?: number | null): Promise<SourceScoringStatus[]> {
  const db = getDb();
  const profileCondition =
    typeof profileId === "number"
      ? sql`${profileId}`
      : sql`(SELECT id FROM user_profiles WHERE is_active = true ORDER BY id ASC LIMIT 1)`;

  const rows = await db.execute(sql`
    SELECT
      s.id AS source_id,
      s.name AS source_name,
      COUNT(d.id)::int AS total_documents,
      COUNT(ds.id)::int AS scored_documents,
      (COUNT(d.id) - COUNT(ds.id))::int AS unscored_documents,
      ROUND(AVG(ds.score), 1) AS avg_score,
      MIN(ds.score) AS min_score,
      MAX(ds.score) AS max_score
    FROM sources s
    INNER JOIN documents d ON d.source_id = s.id
    LEFT JOIN document_scores ds
      ON ds.document_id = d.id AND ds.profile_id = ${profileCondition}
    WHERE s.is_active = true
    GROUP BY s.id, s.name
    ORDER BY s.name
  `);

  return rows.rows.map((row: Record<string, unknown>) => ({
    sourceId: Number(row.source_id),
    sourceName: String(row.source_name),
    totalDocuments: Number(row.total_documents),
    scoredDocuments: Number(row.scored_documents),
    unscoredDocuments: Number(row.unscored_documents),
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    minScore: row.min_score != null ? Number(row.min_score) : null,
    maxScore: row.max_score != null ? Number(row.max_score) : null,
  }));
}
