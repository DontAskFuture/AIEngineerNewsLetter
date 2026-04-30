import { getDb, schema } from "@ai-intel/db";
import { desc, eq, or, sql } from "drizzle-orm";

const OBSERVED_QUEUE_NAMES = ["fetch-source-endpoint", "score-documents"] as const;

export interface QueueJobSummary {
  name: string;
  created: number;
  active: number;
  completed: number;
  failed: number;
  retry: number;
  latestCreatedAt: Date | null;
  latestCompletedAt: Date | null;
}

export interface CrawlErrorLog {
  id: number;
  sourceName: string;
  endpointUrl: string;
  status: string;
  httpStatus: number | null;
  durationMs: number;
  finishedAt: Date;
  errorMessage: string | null;
}

export interface ScoringErrorLog {
  id: number;
  profileName: string;
  status: string;
  totalDocuments: number;
  scoredDocuments: number;
  failedDocuments: number;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface QueueErrorLog {
  id: string;
  name: string;
  state: string;
  retryCount: number;
  retryLimit: number;
  createdOn: Date;
  completedOn: Date | null;
  output: string | null;
}

export interface OperationsSnapshot {
  queueSummaries: QueueJobSummary[];
  crawlErrors: CrawlErrorLog[];
  scoringErrors: ScoringErrorLog[];
  queueErrors: QueueErrorLog[];
}

function emptyQueueSummary(name: string): QueueJobSummary {
  return {
    name,
    created: 0,
    active: 0,
    completed: 0,
    failed: 0,
    retry: 0,
    latestCreatedAt: null,
    latestCompletedAt: null,
  };
}

function summarizeOutput(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const db = getDb();

  const [queueRows, crawlErrors, scoringErrors, queueErrorRows] = await Promise.all([
    db.execute<{
      name: string;
      state: string;
      count: string;
      latest_created_at: Date | null;
      latest_completed_at: Date | null;
    }>(
      sql`SELECT
            name,
            state::text,
            count(*)::text,
            max(created_on) AS latest_created_at,
            max(completed_on) AS latest_completed_at
          FROM pgboss.job
          WHERE name IN ('fetch-source-endpoint', 'score-documents')
            AND created_on > now() - interval '24 hours'
          GROUP BY name, state
          ORDER BY name, state`,
    ),
    db
      .select({
        id: schema.fetchAttempts.id,
        sourceName: schema.sources.name,
        endpointUrl: schema.sourceEndpoints.url,
        status: schema.fetchAttempts.status,
        httpStatus: schema.fetchAttempts.httpStatus,
        durationMs: schema.fetchAttempts.durationMs,
        finishedAt: schema.fetchAttempts.finishedAt,
        errorMessage: schema.fetchAttempts.errorMessage,
      })
      .from(schema.fetchAttempts)
      .innerJoin(schema.fetchJobs, eq(schema.fetchJobs.id, schema.fetchAttempts.fetchJobId))
      .innerJoin(schema.sourceEndpoints, eq(schema.sourceEndpoints.id, schema.fetchJobs.sourceEndpointId))
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceEndpoints.sourceId))
      .where(or(eq(schema.fetchAttempts.status, "failed"), eq(schema.fetchJobs.status, "failed")))
      .orderBy(desc(schema.fetchAttempts.finishedAt))
      .limit(20),
    db
      .select({
        id: schema.scoringJobs.id,
        profileName: schema.userProfiles.displayName,
        status: schema.scoringJobs.status,
        totalDocuments: schema.scoringJobs.totalDocuments,
        scoredDocuments: schema.scoringJobs.scoredDocuments,
        failedDocuments: schema.scoringJobs.failedDocuments,
        startedAt: schema.scoringJobs.startedAt,
        completedAt: schema.scoringJobs.completedAt,
        errorMessage: schema.scoringJobs.errorMessage,
      })
      .from(schema.scoringJobs)
      .innerJoin(schema.userProfiles, eq(schema.userProfiles.id, schema.scoringJobs.profileId))
      .where(or(eq(schema.scoringJobs.status, "failed"), sql`${schema.scoringJobs.errorMessage} IS NOT NULL`))
      .orderBy(desc(schema.scoringJobs.startedAt))
      .limit(20),
    db.execute<{
      id: string;
      name: string;
      state: string;
      retry_count: number;
      retry_limit: number;
      created_on: Date;
      completed_on: Date | null;
      output: unknown;
    }>(
      sql`SELECT
            id::text,
            name,
            state::text,
            retry_count,
            retry_limit,
            created_on,
            completed_on,
            output
          FROM pgboss.job
          WHERE name IN ('fetch-source-endpoint', 'score-documents')
            AND (state = 'failed' OR output IS NOT NULL)
          ORDER BY created_on DESC
          LIMIT 20`,
    ),
  ]);

  const summariesByName = new Map<string, QueueJobSummary>(
    OBSERVED_QUEUE_NAMES.map((name) => [name, emptyQueueSummary(name)]),
  );

  for (const row of queueRows.rows) {
    const summary = summariesByName.get(row.name) ?? emptyQueueSummary(row.name);
    const count = Number(row.count);

    if (row.state === "created") summary.created += count;
    else if (row.state === "active") summary.active += count;
    else if (row.state === "completed") summary.completed += count;
    else if (row.state === "failed") summary.failed += count;
    else if (row.state === "retry") summary.retry += count;

    if (row.latest_created_at && (!summary.latestCreatedAt || row.latest_created_at > summary.latestCreatedAt)) {
      summary.latestCreatedAt = new Date(row.latest_created_at);
    }

    if (row.latest_completed_at && (!summary.latestCompletedAt || row.latest_completed_at > summary.latestCompletedAt)) {
      summary.latestCompletedAt = new Date(row.latest_completed_at);
    }

    summariesByName.set(row.name, summary);
  }

  return {
    queueSummaries: Array.from(summariesByName.values()),
    crawlErrors,
    scoringErrors,
    queueErrors: queueErrorRows.rows.map((row) => ({
      id: row.id,
      name: row.name,
      state: row.state,
      retryCount: row.retry_count,
      retryLimit: row.retry_limit,
      createdOn: new Date(row.created_on),
      completedOn: row.completed_on ? new Date(row.completed_on) : null,
      output: summarizeOutput(row.output),
    })),
  };
}
