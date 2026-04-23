import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";

export interface ReadTrackedDocument {
  id: number;
}

export interface DocumentReadState {
  isRead: boolean;
  readAt: Date | null;
}

export async function markDocumentRead(userId: number, documentId: number) {
  const db = getDb();
  const now = new Date();

  await db
    .insert(schema.documentReads)
    .values({
      userId,
      documentId,
      readAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.documentReads.userId, schema.documentReads.documentId],
      set: {
        readAt: now,
        updatedAt: now,
      },
    });
}

export async function applyReadStateToDocuments<T extends ReadTrackedDocument>(
  userId: number,
  documents: T[],
): Promise<Array<T & DocumentReadState>> {
  if (documents.length === 0) {
    return [];
  }

  const db = getDb();
  const documentIds = Array.from(new Set(documents.map((document) => document.id)));

  const readRows = await db
    .select({
      documentId: schema.documentReads.documentId,
      readAt: schema.documentReads.readAt,
    })
    .from(schema.documentReads)
    .where(
      and(eq(schema.documentReads.userId, userId), inArray(schema.documentReads.documentId, documentIds)),
    );

  const readMap = new Map<number, Date>();

  for (const row of readRows) {
    readMap.set(row.documentId, row.readAt);
  }

  return documents.map((document) => ({
    ...document,
    isRead: readMap.has(document.id),
    readAt: readMap.get(document.id) ?? null,
  }));
}
