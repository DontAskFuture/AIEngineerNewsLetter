import { unlink } from "node:fs/promises";
import { getDb, schema } from "@ai-intel/db";
import { inArray, lt } from "drizzle-orm";
import { logger } from "../logger";
import { loadWorkerEnv } from "../env";

const DAY_MS = 24 * 60 * 60 * 1000;

interface CleanupSummary {
  cutoff: Date;
  deletedDocuments: number;
  deletedRawDocuments: number;
  deletedRawFiles: number;
  missingRawFiles: number;
  failedRawFileDeletes: number;
}

async function deleteRawFile(storageKey: string) {
  try {
    await unlink(storageKey);
    return "deleted" as const;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "missing" as const;
    }

    logger.warn({ storageKey, error }, "Failed to delete expired raw payload file");
    return "failed" as const;
  }
}

async function deleteExpiredDocuments(cutoff: Date, batchSize: number) {
  const db = getDb();
  let deletedCount = 0;

  while (true) {
    const rows = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(lt(schema.documents.discoveredAt, cutoff))
      .limit(batchSize);

    if (rows.length === 0) {
      return deletedCount;
    }

    await db.delete(schema.documents).where(inArray(schema.documents.id, rows.map((row) => row.id)));
    deletedCount += rows.length;
  }
}

async function deleteExpiredRawDocuments(cutoff: Date, batchSize: number) {
  const db = getDb();
  let deletedRawDocuments = 0;
  let deletedRawFiles = 0;
  let missingRawFiles = 0;
  let failedRawFileDeletes = 0;

  while (true) {
    const rows = await db
      .select({ id: schema.rawDocuments.id, storageKey: schema.rawDocuments.storageKey })
      .from(schema.rawDocuments)
      .where(lt(schema.rawDocuments.fetchedAt, cutoff))
      .limit(batchSize);

    if (rows.length === 0) {
      return { deletedRawDocuments, deletedRawFiles, missingRawFiles, failedRawFileDeletes };
    }

    await db.delete(schema.rawDocuments).where(inArray(schema.rawDocuments.id, rows.map((row) => row.id)));
    deletedRawDocuments += rows.length;

    const fileResults = await Promise.all(rows.map((row) => deleteRawFile(row.storageKey)));
    deletedRawFiles += fileResults.filter((result) => result === "deleted").length;
    missingRawFiles += fileResults.filter((result) => result === "missing").length;
    failedRawFileDeletes += fileResults.filter((result) => result === "failed").length;
  }
}

export async function cleanupCrawledDocuments(): Promise<CleanupSummary> {
  const env = loadWorkerEnv();
  const cutoff = new Date(Date.now() - env.CRAWLED_DOCUMENT_TTL_DAYS * DAY_MS);
  const batchSize = env.CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE;

  const deletedDocuments = await deleteExpiredDocuments(cutoff, batchSize);
  const rawSummary = await deleteExpiredRawDocuments(cutoff, batchSize);
  const summary = {
    cutoff,
    deletedDocuments,
    ...rawSummary,
  };

  logger.info(
    {
      ...summary,
      cutoff: cutoff.toISOString(),
      ttlDays: env.CRAWLED_DOCUMENT_TTL_DAYS,
      batchSize,
    },
    "Crawled document cleanup completed",
  );

  return summary;
}
