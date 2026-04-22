import { getDb, schema } from "@ai-intel/db";
import { eq, sql } from "drizzle-orm";

export interface CrawlJobStatus {
  id: string;
  endpointId: number;
  sourceName: string;
  endpointUrl: string;
  state: string;
  createdOn: Date;
  startedOn: Date | null;
  completedOn: Date | null;
}

export interface CrawlStatusSummary {
  created: number;
  active: number;
  completed: number;
  failed: number;
}

export async function triggerCrawl(): Promise<{ enqueuedCount: number }> {
  const db = getDb();

  const endpoints = await db
    .select({
      id: schema.sourceEndpoints.id,
    })
    .from(schema.sourceEndpoints)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceEndpoints.sourceId))
    .where(eq(schema.sourceEndpoints.isActive, true));

  let enqueuedCount = 0;

  for (const endpoint of endpoints) {
    await db.execute(
      sql`INSERT INTO pgboss.job (name, data, state, singleton_key)
          VALUES (
            'fetch-source-endpoint',
            ${JSON.stringify({ endpointId: endpoint.id })}::jsonb,
            'created',
            ${'endpoint:' + endpoint.id}
          )
          ON CONFLICT DO NOTHING`,
    );
    enqueuedCount += 1;
  }

  return { enqueuedCount };
}

export async function getCrawlJobStatuses(): Promise<{
  summary: CrawlStatusSummary;
  jobs: CrawlJobStatus[];
}> {
  const db = getDb();

  const summaryRows = await db.execute<{ state: string; count: string }>(
    sql`SELECT state::text, count(*)::text
        FROM pgboss.job
        WHERE name = 'fetch-source-endpoint'
          AND created_on > now() - interval '24 hours'
        GROUP BY state`,
  );

  const summary: CrawlStatusSummary = { created: 0, active: 0, completed: 0, failed: 0 };
  for (const row of summaryRows.rows) {
    const count = Number(row.count);
    if (row.state === "created") summary.created = count;
    else if (row.state === "active") summary.active = count;
    else if (row.state === "completed") summary.completed = count;
    else if (row.state === "failed") summary.failed = count;
  }

  const jobRows = await db.execute<{
    id: string;
    endpoint_id: number;
    source_name: string;
    endpoint_url: string;
    state: string;
    created_on: Date;
    started_on: Date | null;
    completed_on: Date | null;
  }>(
    sql`SELECT
          j.id,
          (j.data->>'endpointId')::int AS endpoint_id,
          s.name AS source_name,
          se.url AS endpoint_url,
          j.state::text,
          j.created_on,
          j.started_on,
          j.completed_on
        FROM pgboss.job j
        LEFT JOIN ${schema.sourceEndpoints} se ON se.id = (j.data->>'endpointId')::int
        LEFT JOIN ${schema.sources} s ON s.id = se.source_id
        WHERE j.name = 'fetch-source-endpoint'
          AND j.created_on > now() - interval '24 hours'
        ORDER BY j.created_on DESC
        LIMIT 50`,
  );

  const jobs: CrawlJobStatus[] = jobRows.rows.map((row) => ({
    id: row.id,
    endpointId: row.endpoint_id,
    sourceName: row.source_name ?? "Unknown",
    endpointUrl: row.endpoint_url ?? "Unknown",
    state: row.state,
    createdOn: new Date(row.created_on),
    startedOn: row.started_on ? new Date(row.started_on) : null,
    completedOn: row.completed_on ? new Date(row.completed_on) : null,
  }));

  return { summary, jobs };
}
