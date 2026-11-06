import { extractDocumentPreview, type SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, sql } from "drizzle-orm";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;

export type ReadListFilter = "all" | "unread";

export interface ReadListStory {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  sourceSlug: string;
  category: SourceCategory;
  sortTime: Date;
  savedAt: Date;
  previewParagraph: string;
  isRead: boolean;
  readAt: Date | null;
}

export interface ReadListSnapshot {
  stories: ReadListStory[];
  savedCount: number;
  unreadCount: number;
  activeFilter: ReadListFilter;
}

export async function listUserReadListDocumentIds(userId: number) {
  const db = getDb();
  const rows = await db
    .select({ documentId: schema.userDocumentReadList.documentId })
    .from(schema.userDocumentReadList)
    .where(eq(schema.userDocumentReadList.userId, userId));

  return rows.map((row) => row.documentId);
}

export async function addDocumentToReadList(userId: number, documentId: number) {
  const db = getDb();

  await db
    .insert(schema.userDocumentReadList)
    .values({ userId, documentId })
    .onConflictDoNothing({
      target: [schema.userDocumentReadList.userId, schema.userDocumentReadList.documentId],
    });
}

export async function removeDocumentFromReadList(userId: number, documentId: number) {
  const db = getDb();

  await db
    .delete(schema.userDocumentReadList)
    .where(
      and(
        eq(schema.userDocumentReadList.userId, userId),
        eq(schema.userDocumentReadList.documentId, documentId),
      ),
    );
}

export async function getReadListSnapshot(
  userId: number,
  filter: ReadListFilter,
): Promise<ReadListSnapshot> {
  const db = getDb();

  const savedRows = await db
    .select({
      documentId: schema.userDocumentReadList.documentId,
      savedAt: schema.userDocumentReadList.createdAt,
      id: schema.documents.id,
      title: schema.documents.title,
      canonicalUrl: schema.documents.canonicalUrl,
      summary: schema.documents.summary,
      bodyText: sql<string | null>`left(${schema.documents.bodyText}, 2000)`,
      sourceName: schema.sources.name,
      sourceSlug: schema.sources.slug,
      category: schema.sources.category,
      sortTime: documentSortKey,
      readAt: schema.documentReads.readAt,
    })
    .from(schema.userDocumentReadList)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.userDocumentReadList.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .leftJoin(
      schema.documentReads,
      and(
        eq(schema.documentReads.documentId, schema.documents.id),
        eq(schema.documentReads.userId, userId),
      ),
    )
    .where(eq(schema.userDocumentReadList.userId, userId))
    .orderBy(desc(schema.userDocumentReadList.createdAt));

  const storiesWithReadState: ReadListStory[] = savedRows.map((row) => ({
    id: row.id,
    title: row.title,
    canonicalUrl: row.canonicalUrl,
    sourceName: row.sourceName,
    sourceSlug: row.sourceSlug,
    category: row.category,
    sortTime: new Date(row.sortTime),
    savedAt: row.savedAt,
    previewParagraph: extractDocumentPreview(row.summary, row.bodyText, { maxChars: 300 }),
    isRead: row.readAt != null,
    readAt: row.readAt ?? null,
  }));

  const unreadCount = storiesWithReadState.filter((story) => !story.isRead).length;

  const stories =
    filter === "unread"
      ? storiesWithReadState.filter((story) => !story.isRead)
      : storiesWithReadState;

  return {
    stories,
    savedCount: savedRows.length,
    unreadCount,
    activeFilter: filter,
  };
}
