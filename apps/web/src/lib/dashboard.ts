import type { SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { asc, desc, eq, sql } from "drizzle-orm";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;
const fetchSortKey = sql<Date>`coalesce(${schema.fetchJobs.completedAt}, ${schema.fetchJobs.createdAt})`;

export interface DashboardDocument {
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
}

export interface DashboardEndpoint {
  id: number;
  kind: string;
  url: string;
  cadenceMinutes: number;
  parserKey: string | null;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  successRate: number;
  latestFetchAt: Date | null;
}

export interface DashboardSource {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: SourceCategory;
  canonicalDomain: string;
  trustTier: number;
  documentCount: number;
  latestDocumentAt: Date | null;
  endpoints: DashboardEndpoint[];
}

export interface DashboardFetchAttempt {
  id: number;
  status: string;
  httpStatus: number | null;
  durationMs: number;
  finishedAt: Date;
  errorMessage: string | null;
  sourceName: string;
  sourceSlug: string;
  endpointId: number;
  endpointUrl: string;
}

export interface DashboardCategoryBreakdown {
  category: SourceCategory;
  sourceCount: number;
  documentCount: number;
}

export interface DashboardOverview {
  sourceCount: number;
  categoryCount: number;
  endpointCount: number;
  documentCount: number;
  fetchRunCount: number;
  successfulFetchCount: number;
  failedFetchCount: number;
  latestDocumentAt: Date | null;
  latestFetchAt: Date | null;
}

export interface DashboardSnapshot {
  overview: DashboardOverview;
  latestDocuments: DashboardDocument[];
  sourceRegistry: DashboardSource[];
  recentFetchAttempts: DashboardFetchAttempt[];
  categoryBreakdown: DashboardCategoryBreakdown[];
  topSources: DashboardSource[];
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const db = getDb();

  const [latestDocuments, sourceRows, documentStatRows, endpointRunRows, recentFetchAttempts] = await Promise.all([
    db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        summary: schema.documents.summary,
        canonicalUrl: schema.documents.canonicalUrl,
        sourceName: schema.sources.name,
        sourceSlug: schema.sources.slug,
        category: schema.sources.category,
        sourcePublishedAt: schema.documents.sourcePublishedAt,
        discoveredAt: schema.documents.discoveredAt,
        sortTime: documentSortKey,
      })
      .from(schema.documents)
      .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
      .orderBy(desc(documentSortKey))
      .limit(24),
    db
      .select({
        sourceId: schema.sources.id,
        sourceSlug: schema.sources.slug,
        sourceName: schema.sources.name,
        sourceDescription: schema.sources.description,
        sourceCategory: schema.sources.category,
        canonicalDomain: schema.sources.canonicalDomain,
        trustTier: schema.sources.trustTier,
        endpointId: schema.sourceEndpoints.id,
        endpointKind: schema.sourceEndpoints.kind,
        endpointUrl: schema.sourceEndpoints.url,
        cadenceMinutes: schema.sourceEndpoints.cadenceMinutes,
        parserKey: schema.sourceEndpoints.parserKey,
      })
      .from(schema.sources)
      .leftJoin(schema.sourceEndpoints, eq(schema.sourceEndpoints.sourceId, schema.sources.id))
      .where(eq(schema.sources.isActive, true))
      .orderBy(asc(schema.sources.name), asc(schema.sourceEndpoints.url)),
    db
      .select({
        sourceId: schema.documents.sourceId,
        documentCount: sql<number>`count(*)::int`,
        latestDocumentAt: sql<Date | null>`max(${documentSortKey})`,
      })
      .from(schema.documents)
      .groupBy(schema.documents.sourceId),
    db
      .select({
        sourceEndpointId: schema.fetchJobs.sourceEndpointId,
        totalRuns: sql<number>`count(*)::int`,
        successRuns: sql<number>`count(*) filter (where ${schema.fetchJobs.status} = 'succeeded')::int`,
        failedRuns: sql<number>`count(*) filter (where ${schema.fetchJobs.status} = 'failed')::int`,
        latestFetchAt: sql<Date | null>`max(${fetchSortKey})`,
      })
      .from(schema.fetchJobs)
      .groupBy(schema.fetchJobs.sourceEndpointId),
    db
      .select({
        id: schema.fetchAttempts.id,
        status: schema.fetchAttempts.status,
        httpStatus: schema.fetchAttempts.httpStatus,
        durationMs: schema.fetchAttempts.durationMs,
        finishedAt: schema.fetchAttempts.finishedAt,
        errorMessage: schema.fetchAttempts.errorMessage,
        sourceName: schema.sources.name,
        sourceSlug: schema.sources.slug,
        endpointId: schema.sourceEndpoints.id,
        endpointUrl: schema.sourceEndpoints.url,
      })
      .from(schema.fetchAttempts)
      .innerJoin(schema.fetchJobs, eq(schema.fetchJobs.id, schema.fetchAttempts.fetchJobId))
      .innerJoin(schema.sourceEndpoints, eq(schema.sourceEndpoints.id, schema.fetchJobs.sourceEndpointId))
      .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceEndpoints.sourceId))
      .orderBy(desc(schema.fetchAttempts.finishedAt))
      .limit(18),
  ]);

  const documentStatsBySourceId = new Map(
    documentStatRows.map((row) => [
      row.sourceId,
      {
        documentCount: row.documentCount,
        latestDocumentAt: row.latestDocumentAt,
      },
    ]),
  );

  const endpointRunStatsById = new Map(
    endpointRunRows.map((row) => [
      row.sourceEndpointId,
      {
        totalRuns: row.totalRuns,
        successRuns: row.successRuns,
        failedRuns: row.failedRuns,
        latestFetchAt: row.latestFetchAt,
      },
    ]),
  );

  const sourceRegistryMap = new Map<number, DashboardSource>();

  for (const row of sourceRows) {
    const documentStats = documentStatsBySourceId.get(row.sourceId);
    const existingSource = sourceRegistryMap.get(row.sourceId);

    if (!existingSource) {
      sourceRegistryMap.set(row.sourceId, {
        id: row.sourceId,
        slug: row.sourceSlug,
        name: row.sourceName,
        description: row.sourceDescription,
        category: row.sourceCategory,
        canonicalDomain: row.canonicalDomain,
        trustTier: row.trustTier,
        documentCount: documentStats?.documentCount ?? 0,
        latestDocumentAt: documentStats?.latestDocumentAt ?? null,
        endpoints: [],
      });
    }

    if (row.endpointId == null) {
      continue;
    }

    const endpointKind = row.endpointKind;
    const endpointUrl = row.endpointUrl;
    const cadenceMinutes = row.cadenceMinutes;

    if (endpointKind == null || endpointUrl == null || cadenceMinutes == null) {
      continue;
    }

    const endpointRuns = endpointRunStatsById.get(row.endpointId);
    const totalRuns = endpointRuns?.totalRuns ?? 0;
    const successRuns = endpointRuns?.successRuns ?? 0;
    const failedRuns = endpointRuns?.failedRuns ?? 0;
    const successRate = totalRuns === 0 ? 0 : (successRuns / totalRuns) * 100;

    sourceRegistryMap.get(row.sourceId)?.endpoints.push({
      id: row.endpointId,
      kind: endpointKind,
      url: endpointUrl,
      cadenceMinutes,
      parserKey: row.parserKey,
      totalRuns,
      successRuns,
      failedRuns,
      successRate,
      latestFetchAt: endpointRuns?.latestFetchAt ?? null,
    });
  }

  const sourceRegistry = Array.from(sourceRegistryMap.values());
  const topSources = [...sourceRegistry]
    .sort((left, right) => right.documentCount - left.documentCount || left.name.localeCompare(right.name))
    .slice(0, 6);

  const categoryBreakdown = Array.from(
    sourceRegistry.reduce((map, source) => {
      const current = map.get(source.category) ?? {
        category: source.category,
        sourceCount: 0,
        documentCount: 0,
      };

      current.sourceCount += 1;
      current.documentCount += source.documentCount;
      map.set(source.category, current);
      return map;
    }, new Map<SourceCategory, DashboardCategoryBreakdown>()),
  )
    .map(([, value]) => value)
    .sort((left, right) => right.documentCount - left.documentCount || left.category.localeCompare(right.category));

  const overview: DashboardOverview = {
    sourceCount: sourceRegistry.length,
    categoryCount: categoryBreakdown.length,
    endpointCount: sourceRegistry.reduce((count, source) => count + source.endpoints.length, 0),
    documentCount: sourceRegistry.reduce((count, source) => count + source.documentCount, 0),
    fetchRunCount: Array.from(endpointRunStatsById.values()).reduce((count, row) => count + row.totalRuns, 0),
    successfulFetchCount: Array.from(endpointRunStatsById.values()).reduce((count, row) => count + row.successRuns, 0),
    failedFetchCount: Array.from(endpointRunStatsById.values()).reduce((count, row) => count + row.failedRuns, 0),
    latestDocumentAt: latestDocuments[0]?.sortTime ?? null,
    latestFetchAt: recentFetchAttempts[0]?.finishedAt ?? null,
  };

  return {
    overview,
    latestDocuments,
    sourceRegistry,
    recentFetchAttempts,
    categoryBreakdown,
    topSources,
  };
}
