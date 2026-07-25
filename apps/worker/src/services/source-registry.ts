import { getDb, schema } from "@ai-intel/db";
import { defaultSources } from "@ai-intel/shared";
import { and, eq, notInArray } from "drizzle-orm";

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

    // Seeding is additive, so retiring or re-pointing a seed endpoint would
    // otherwise leave the previous row active and still being crawled.
    await db
      .update(schema.sourceEndpoints)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.sourceEndpoints.sourceId, storedSource.id),
          eq(schema.sourceEndpoints.isActive, true),
          notInArray(
            schema.sourceEndpoints.url,
            source.endpoints.map((endpoint) => endpoint.url),
          ),
        ),
      );
  }

  // Same reasoning for whole sources removed from the seed registry.
  await db
    .update(schema.sources)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(schema.sources.isActive, true),
        notInArray(
          schema.sources.slug,
          defaultSources.map((source) => source.slug),
        ),
      ),
    );
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
    .where(and(eq(schema.sourceEndpoints.isActive, true), eq(schema.sources.isActive, true)));
}
