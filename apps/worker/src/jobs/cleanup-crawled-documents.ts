import { unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getDb, schema } from "@ai-intel/db";
import { inArray, lt } from "drizzle-orm";
import { logger } from "../logger";
import { loadWorkerEnv } from "../env";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOGIN_ATTEMPT_RETENTION_DAYS = 7;

interface CleanupSummary {
  cutoff: Date;
  deletedDocuments: number;
  deletedRawDocuments: number;
  deletedRawFiles: number;
  missingRawFiles: number;
  failedRawFileDeletes: number;
  deletedExpiredSessions: number;
  deletedExpiredRankingCache: number;
  deletedOldLoginAttempts: number;
}

async function deleteRawFile(storageKey: string, allowedRootDir: string) {
  const resolvedRoot = resolve(allowedRootDir);
  const resolvedTarget = resolve(storageKey);
  if (!resolvedTarget.startsWith(resolvedRoot + sep)) {
    logger.error({ storageKey, allowedRootDir }, "Refused to delete raw file outside RAW_STORAGE_DIR");
    return "failed" as const;
  }

  try {
    await unlink(resolvedTarget);
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

async function deleteExpiredRawDocuments(cutoff: Date, batchSize: number, allowedRootDir: string) {
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

    const fileResults = await Promise.all(
      rows.map((row) => deleteRawFile(row.storageKey, allowedRootDir)),
    );
    deletedRawFiles += fileResults.filter((result) => result === "deleted").length;
    missingRawFiles += fileResults.filter((result) => result === "missing").length;
    failedRawFileDeletes += fileResults.filter((result) => result === "failed").length;
  }
}

async function deleteExpiredHygieneRows(now: Date) {
  const db = getDb();
  const loginCutoff = new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * DAY_MS);

  const [expiredSessions, expiredCache, oldLoginAttempts] = await Promise.all([
    db
      .delete(schema.authSessions)
      .where(lt(schema.authSessions.expiresAt, now))
      .returning({ id: schema.authSessions.id }),
    db
      .delete(schema.rankingCache)
      .where(lt(schema.rankingCache.expiresAt, now))
      .returning({ id: schema.rankingCache.id }),
    db
      .delete(schema.authLoginAttempts)
      .where(lt(schema.authLoginAttempts.attemptedAt, loginCutoff))
      .returning({ id: schema.authLoginAttempts.id }),
  ]);

  return {
    deletedExpiredSessions: expiredSessions.length,
    deletedExpiredRankingCache: expiredCache.length,
    deletedOldLoginAttempts: oldLoginAttempts.length,
  };
}

export async function cleanupCrawledDocuments(): Promise<CleanupSummary> {
  const env = loadWorkerEnv();
  const now = new Date();
  const cutoff = new Date(now.getTime() - env.CRAWLED_DOCUMENT_TTL_DAYS * DAY_MS);
  const batchSize = env.CRAWLED_DOCUMENT_CLEANUP_BATCH_SIZE;

  const [deletedDocuments, rawSummary, hygieneSummary] = await Promise.all([
    deleteExpiredDocuments(cutoff, batchSize),
    deleteExpiredRawDocuments(cutoff, batchSize, env.RAW_STORAGE_DIR),
    deleteExpiredHygieneRows(now),
  ]);
  const summary = {
    cutoff,
    deletedDocuments,
    ...rawSummary,
    ...hygieneSummary,
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
