import {
  deduplicateScoringCandidates,
  extractDocumentPreview,
  formatWhyRelevant,
  scoringConfig,
} from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, gt, notInArray, sql } from "drizzle-orm";
import { loadWebEnv } from "@/lib/env";
import type { InterestRankingCandidate } from "@/lib/openrouter";
import { scoreDocumentBatch } from "@/lib/openrouter";
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
      const uniqueCandidates: InterestRankingCandidate[] = batchGroups.map((group) => {
        const doc = group.representative;
        duplicateTargetIdsByRepresentative.set(doc.id, group.duplicateIds);
        return {
          id: doc.id,
          title: doc.title,
          previewParagraph: doc.previewParagraph,
          sourceName: doc.sourceName,
          sourceCategory: doc.sourceCategory,
          publishedAt: doc.sortTime,
        };
      });

      try {
        const result = await scoreDocumentBatch({
          profileName: profile.displayName,
          interestStatement: profile.interestStatement,
          candidates: uniqueCandidates,
        });

        const expandedScores = result.scores.flatMap((s) => {
          const targetIds = duplicateTargetIdsByRepresentative.get(s.documentId) ?? [s.documentId];
          return targetIds.map((documentId) => ({
            ...s,
            documentId,
          }));
        });

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

        if (expandedScores.length > 0) {
          await db
            .insert(schema.documentScores)
            .values(
              expandedScores.map((s) => ({
                documentId: s.documentId,
                profileId,
                score: s.score,
                whyRelevant: formatWhyRelevant(s),
                model: result.model,
              })),
            )
            .onConflictDoUpdate({
              target: [schema.documentScores.documentId, schema.documentScores.profileId],
              set: {
                score: sql`excluded.score`,
                whyRelevant: sql`excluded.why_relevant`,
                model: sql`excluded.model`,
                scoredAt: new Date(),
              },
            });

          progress.scored += expandedScores.length;
        }

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

  return progress;
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
