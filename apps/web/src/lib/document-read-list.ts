import type { SourceCategory } from "@ai-intel/shared";
import { getDb, schema } from "@ai-intel/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { applyReadStateToDocuments } from "@/lib/read-tracking";

const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;

function stripHtml(value: string): string {
  return value
    .replace(/<\/(p|div|li|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPreview(summary: string | null, bodyText: string | null): string {
  const bodyParagraphs = bodyText
    ? stripHtml(bodyText)
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
    : [];

  if (bodyParagraphs.length > 0) {
    return bodyParagraphs[0]!.slice(0, 300);
  }

  const summaryText = summary ? stripHtml(summary) : "";
  return summaryText ? summaryText.slice(0, 300) : "";
}

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
      bodyText: schema.documents.bodyText,
      sourceName: schema.sources.name,
      sourceSlug: schema.sources.slug,
      category: schema.sources.category,
      sortTime: documentSortKey,
    })
    .from(schema.userDocumentReadList)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.userDocumentReadList.documentId))
    .innerJoin(schema.sources, eq(schema.sources.id, schema.documents.sourceId))
    .where(eq(schema.userDocumentReadList.userId, userId))
    .orderBy(desc(schema.userDocumentReadList.createdAt));

  const baseStories = savedRows.map((row) => ({
    id: row.id,
    title: row.title,
    canonicalUrl: row.canonicalUrl,
    sourceName: row.sourceName,
    sourceSlug: row.sourceSlug,
    category: row.category,
    sortTime: row.sortTime,
    savedAt: row.savedAt,
    previewParagraph: extractPreview(row.summary, row.bodyText),
  }));

  const storiesWithReadState = await applyReadStateToDocuments(userId, baseStories);
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
