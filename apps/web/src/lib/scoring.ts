import { scoringConfig } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { desc, eq, notInArray, sql } from "drizzle-orm";
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

function stripHtml(value: string): string {
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

function extractPreview(summary: string | null, bodyText: string | null): string {
  const bodyParagraphs = bodyText
    ? stripHtml(bodyText)
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
    : [];

  if (bodyParagraphs.length > 0) {
    return bodyParagraphs[0]!.slice(0, 300);
  }

  const summaryText = summary ? stripHtml(summary) : "";
  return summaryText ? summaryText.slice(0, 300) : "";
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

  const unscoredDocs = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      summary: schema.documents.summary,
      bodyText: schema.documents.bodyText,
    })
    .from(schema.documents)
    .where(notInArray(schema.documents.id, alreadyScoredIds))
    .orderBy(desc(documentSortKey), desc(schema.documents.id))
    .limit(scoringConfig.maxDocumentsPerRun);

  const progress: ScoringProgress = {
    totalUnscored: unscoredDocs.length,
    scored: 0,
    failed: 0,
    batches: Math.ceil(unscoredDocs.length / scoringConfig.batchSize),
  };

  if (unscoredDocs.length === 0) {
    return progress;
  }

  const jobId = await startScoringJob(profileId, unscoredDocs.length, progress.batches);

  try {
    for (let i = 0; i < unscoredDocs.length; i += scoringConfig.batchSize) {
      const batch = unscoredDocs.slice(i, i + scoringConfig.batchSize);
      const batchNumber = Math.floor(i / scoringConfig.batchSize) + 1;

      const candidates: InterestRankingCandidate[] = batch.map((doc) => ({
        id: doc.id,
        title: doc.title,
        previewParagraph: extractPreview(doc.summary, doc.bodyText),
      }));

      try {
        const result = await scoreDocumentBatch({
          interestStatement: profile.interestStatement,
          candidates,
        });

        const validScores = result.scores.filter((s) =>
          batch.some((doc) => doc.id === s.documentId),
        );

        if (validScores.length > 0) {
          await db
            .insert(schema.documentScores)
            .values(
              validScores.map((s) => ({
                documentId: s.documentId,
                profileId,
                score: s.score,
                whyRelevant: s.whyRelevant,
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

          progress.scored += validScores.length;
        }

        const missedCount = batch.length - validScores.length;
        if (missedCount > 0) {
          progress.failed += missedCount;
        }

        await updateScoringBatch(jobId, batchNumber, validScores.length, missedCount);

        console.log(
          `[scoring] Batch ${batchNumber}/${progress.batches}: scored ${validScores.length}/${batch.length} docs`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[scoring] Batch ${batchNumber} failed:`, message);
        progress.failed += batch.length;
        await updateScoringBatch(jobId, batchNumber, 0, batch.length);
      }
    }

    await completeScoringJob(jobId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await failScoringJob(jobId, message);
    throw error;
  }

  return progress;
}

export async function getScoringStats(profileId: number) {
  const db = getDb();

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documents);

  const [scoredResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.documentScores)
    .where(eq(schema.documentScores.profileId, profileId));

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

export async function getScoringStatsBySource(profileId: number): Promise<SourceScoringStatus[]> {
  const db = getDb();

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
      ON ds.document_id = d.id AND ds.profile_id = ${profileId}
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
