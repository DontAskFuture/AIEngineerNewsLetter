import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";

const STALE_JOB_MINUTES = 30;

export interface ScoringJobState {
  status: "idle" | "running" | "completed" | "failed";
  totalDocuments: number;
  scoredDocuments: number;
  failedDocuments: number;
  currentBatch: number;
  totalBatches: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

const idleState: ScoringJobState = {
  status: "idle",
  totalDocuments: 0,
  scoredDocuments: 0,
  failedDocuments: 0,
  currentBatch: 0,
  totalBatches: 0,
  startedAt: null,
  completedAt: null,
  errorMessage: null,
};

export async function getScoringJobState(): Promise<ScoringJobState> {
  const db = getDb();

  // Mark stale running jobs as failed (crashed process)
  const staleCutoff = new Date(Date.now() - STALE_JOB_MINUTES * 60 * 1000);
  await db
    .update(schema.scoringJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage: "Job timed out (process may have crashed)",
    })
    .where(
      and(
        eq(schema.scoringJobs.status, "running"),
        lt(schema.scoringJobs.startedAt, staleCutoff),
      ),
    );

  const [row] = await db
    .select()
    .from(schema.scoringJobs)
    .orderBy(
      sql`CASE WHEN ${schema.scoringJobs.status} = 'running' THEN 0 ELSE 1 END`,
      desc(schema.scoringJobs.startedAt),
    )
    .limit(1);

  if (!row) return idleState;

  return {
    status: row.status,
    totalDocuments: row.totalDocuments,
    scoredDocuments: row.scoredDocuments,
    failedDocuments: row.failedDocuments,
    currentBatch: row.currentBatch,
    totalBatches: row.totalBatches,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  };
}

export async function startScoringJob(profileId: number, totalDocuments: number, totalBatches: number): Promise<number> {
  const db = getDb();

  const [row] = await db
    .insert(schema.scoringJobs)
    .values({
      profileId,
      status: "running",
      totalDocuments,
      totalBatches,
    })
    .returning({ id: schema.scoringJobs.id });

  return row!.id;
}

export async function updateScoringBatch(jobId: number, batch: number, scored: number, failed: number): Promise<void> {
  const db = getDb();

  await db
    .update(schema.scoringJobs)
    .set({
      currentBatch: batch,
      scoredDocuments: sql`${schema.scoringJobs.scoredDocuments} + ${scored}`,
      failedDocuments: sql`${schema.scoringJobs.failedDocuments} + ${failed}`,
    })
    .where(eq(schema.scoringJobs.id, jobId));
}

export async function completeScoringJob(jobId: number): Promise<void> {
  const db = getDb();

  await db
    .update(schema.scoringJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(schema.scoringJobs.id, jobId));
}

export async function getScoringJobHistory(): Promise<ScoringJobState[]> {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.scoringJobs)
    .orderBy(desc(schema.scoringJobs.startedAt))
    .limit(20);

  return rows.map((row) => ({
    status: row.status,
    totalDocuments: row.totalDocuments,
    scoredDocuments: row.scoredDocuments,
    failedDocuments: row.failedDocuments,
    currentBatch: row.currentBatch,
    totalBatches: row.totalBatches,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    errorMessage: row.errorMessage,
  }));
}

export async function failScoringJob(jobId: number, errorMessage: string): Promise<void> {
  const db = getDb();

  await db
    .update(schema.scoringJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorMessage,
    })
    .where(eq(schema.scoringJobs.id, jobId));
}
