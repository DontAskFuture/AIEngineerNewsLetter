import { getDb, schema } from "@ai-intel/db";
import { defaultSources } from "@ai-intel/shared";
import { eq } from "drizzle-orm";

function requireRow<T>(value: T | undefined, context: string) {
  if (!value) {
    throw new Error(`Expected a database row for ${context}`);
  }

  return value;
}

export async function seedDefaultSources() {
  const db = getDb();

  for (const source of defaultSources) {
    const [storedSourceRow] = await db
      .insert(schema.sources)
      .values({
        slug: source.slug,
        name: source.name,
        description: source.description,
        category: source.category,
        baseUrl: source.baseUrl,
        canonicalDomain: source.canonicalDomain,
        trustTier: source.trustTier,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: schema.sources.slug,
        set: {
          name: source.name,
          description: source.description,
          category: source.category,
          baseUrl: source.baseUrl,
          canonicalDomain: source.canonicalDomain,
          trustTier: source.trustTier,
          isActive: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.sources.id });
    const storedSource = requireRow(storedSourceRow, `source ${source.slug}`);

    for (const endpoint of source.endpoints) {
      await db
        .insert(schema.sourceEndpoints)
        .values({
          sourceId: storedSource.id,
          kind: endpoint.kind,
          url: endpoint.url,
          cadenceMinutes: endpoint.cadenceMinutes,
          parserKey: endpoint.parserKey,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: [schema.sourceEndpoints.sourceId, schema.sourceEndpoints.url],
          set: {
            kind: endpoint.kind,
            cadenceMinutes: endpoint.cadenceMinutes,
            parserKey: endpoint.parserKey,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }
  }
}

export async function listActiveSourceEndpoints() {
  const db = getDb();

  return db
    .select({
      id: schema.sourceEndpoints.id,
      sourceId: schema.sourceEndpoints.sourceId,
      sourceName: schema.sources.name,
      sourceSlug: schema.sources.slug,
      endpointKind: schema.sourceEndpoints.kind,
      endpointUrl: schema.sourceEndpoints.url,
      cadenceMinutes: schema.sourceEndpoints.cadenceMinutes,
    })
    .from(schema.sourceEndpoints)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceEndpoints.sourceId))
    .where(eq(schema.sourceEndpoints.isActive, true));
}
