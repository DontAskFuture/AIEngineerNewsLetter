import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import RSSParser from "rss-parser";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { canonicalizeUrl, type FetchSourceEndpointPayload } from "@ai-intel/shared";
import { logger } from "../logger";
import { persistRawPayload } from "../storage/local-raw-store";

const parser = new RSSParser();
const userAgent = "ai-builder-intelligence-bot/0.1 (+https://localhost)";
const MAX_DOCUMENTS_PER_SOURCE = 50;
const FETCH_MAX_ATTEMPTS = 3;
const FETCH_RETRY_BASE_MS = 500;

type DocumentInsertValues = typeof schema.documents.$inferInsert;

class FetchHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Request failed with HTTP ${status}`);
    this.name = "FetchHttpError";
    this.status = status;
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number) {
  return status === 429 || status >= 500;
}

function getRetryDelayMs(attempt: number, response?: Response) {
  const retryAfter = response?.headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }

  return FETCH_RETRY_BASE_MS * 2 ** attempt;
}

async function fetchEndpoint(url: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": userAgent,
          accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8",
        },
      });

      if (!response.ok) {
        const error = new FetchHttpError(response.status);

        if (attempt < FETCH_MAX_ATTEMPTS - 1 && shouldRetryStatus(response.status)) {
          await sleep(getRetryDelayMs(attempt, response));
          continue;
        }

        throw error;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (error instanceof FetchHttpError) {
        throw error;
      }

      if (attempt < FETCH_MAX_ATTEMPTS - 1) {
        await sleep(getRetryDelayMs(attempt));
        continue;
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

function requireRow<T>(value: T | undefined, context: string) {
  if (!value) {
    throw new Error(`Expected a database row for ${context}`);
  }

  return value;
}

function toDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstMetaContent(dom: JSDOM, selectors: string[]) {
  for (const selector of selectors) {
    const value = dom.window.document.querySelector(selector)?.getAttribute("content")?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function extractPublishedAt(dom: JSDOM) {
  const content = firstMetaContent(dom, [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="publish_date"]',
    'meta[name="published"]',
    'meta[itemprop="datePublished"]',
    'meta[name="parsely-pub-date"]',
    'meta[name="sailthru.date"]',
  ]);

  return toDate(content ?? undefined);
}

function inferMimeType(contentTypeHeader: string | null) {
  if (!contentTypeHeader) {
    return "text/html";
  }

  return contentTypeHeader.split(";")[0]?.trim() || "text/html";
}

function buildFallbackUrl(baseUrl: string, title: string, externalId: string | null) {
  return `${baseUrl.replace(/\/$/, "")}#${hashValue(externalId ?? title).slice(0, 16)}`;
}

async function getExistingCanonicalUrls(db: ReturnType<typeof getDb>, canonicalUrls: string[]) {
  if (canonicalUrls.length === 0) {
    return new Set<string>();
  }

  const rows = await db
    .select({ canonicalUrl: schema.documents.canonicalUrl })
    .from(schema.documents)
    .where(inArray(schema.documents.canonicalUrl, canonicalUrls));

  return new Set(rows.map((row) => row.canonicalUrl));
}

async function insertDocument(db: ReturnType<typeof getDb>, values: DocumentInsertValues) {
  const [createdDocument] = await db
    .insert(schema.documents)
    .values(values)
    .onConflictDoNothing({
      target: schema.documents.canonicalUrl,
    })
    .returning({ id: schema.documents.id });

  return Boolean(createdDocument);
}

async function upsertFeedDocuments(rawDocumentId: number, sourceId: number, sourceEndpointId: number, baseUrl: string, body: string) {
  const db = getDb();
  const feed = await parser.parseString(body);
  const candidates = feed.items.flatMap((item) => {
    const title = item.title?.trim();

    if (!title) {
      return [];
    }

    const canonicalUrl = canonicalizeUrl(item.link ?? buildFallbackUrl(baseUrl, title, item.guid ?? null));
    const summary = item.contentSnippet?.trim() || item.summary?.trim() || null;
    const encodedContent = (item as Record<string, string | undefined>)["content:encoded"];
    const bodyText = item.content?.trim() || encodedContent?.trim() || summary;
    const sourcePublishedAt = toDate(item.isoDate ?? item.pubDate);
    const contentHash = hashValue([title, summary ?? "", bodyText ?? ""].join("\n"));

    return [{
      canonicalUrl,
      title,
      externalId: item.guid ?? null,
      summary,
      bodyText,
      sourcePublishedAt,
      contentHash,
      metadata: {
        creator: item.creator ?? null,
        categories: item.categories ?? [],
        feedTitle: feed.title ?? null,
      },
    }];
  });
  const existingCanonicalUrls = await getExistingCanonicalUrls(db, candidates.map((candidate) => candidate.canonicalUrl));
  let extractedCount = 0;
  let skippedCount = 0;
  let sourceCapSkippedCount = 0;

  for (const candidate of candidates) {
    if (existingCanonicalUrls.has(candidate.canonicalUrl)) {
      skippedCount += 1;
      continue;
    }

    if (extractedCount >= MAX_DOCUMENTS_PER_SOURCE) {
      sourceCapSkippedCount += 1;
      continue;
    }

    const inserted = await insertDocument(db, {
      sourceId,
      sourceEndpointId,
      rawDocumentId,
      canonicalUrl: candidate.canonicalUrl,
      externalId: candidate.externalId,
      title: candidate.title,
      summary: candidate.summary,
      bodyText: candidate.bodyText,
      sourcePublishedAt: candidate.sourcePublishedAt,
      contentHash: candidate.contentHash,
      metadata: candidate.metadata,
    });

    if (inserted) {
      extractedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  if (skippedCount > 0) {
    logger.info({ skippedCount, feedTitle: feed.title ?? null }, "Skipped feed items with existing canonical URLs");
  }

  if (sourceCapSkippedCount > 0) {
    logger.info(
      { sourceCapSkippedCount, maxDocumentsPerSource: MAX_DOCUMENTS_PER_SOURCE },
      "Skipped feed items because the per-source fetch cap was reached",
    );
  }

  return extractedCount;
}

function extractArticleLinks(dom: JSDOM, baseUrl: string): string[] {
  const parsed = new URL(baseUrl);
  const baseDomain = parsed.hostname;
  const basePath = parsed.pathname.replace(/\/$/, "");
  const seen = new Set<string>();
  const links: string[] = [];

  const anchors = dom.window.document.querySelectorAll("a[href]");

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      continue;
    }

    if (resolved.hostname !== baseDomain) continue;

    const resolvedPath = resolved.pathname.replace(/\/$/, "");

    if (!resolvedPath.startsWith(basePath + "/")) continue;

    const remainder = resolvedPath.slice(basePath.length + 1);
    if (!remainder || remainder.includes("/")) continue;

    const normalized = canonicalizeUrl(resolved.toString());
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    links.push(normalized);
  }

  return links;
}

async function upsertSingleHtmlDocument(
  db: ReturnType<typeof getDb>,
  rawDocumentId: number,
  sourceId: number,
  sourceEndpointId: number,
  articleUrl: string,
  body: string,
  insertedForSource: number,
): Promise<boolean | "source_cap"> {
  if (insertedForSource >= MAX_DOCUMENTS_PER_SOURCE) {
    return "source_cap";
  }

  const dom = new JSDOM(body, { url: articleUrl });
  const article = new Readability(dom.window.document).parse();

  const title = article?.title?.trim() || dom.window.document.title?.trim();
  if (!title) return false;

  const summary = article?.excerpt?.trim() || null;
  const bodyText = article?.textContent?.trim() || null;
  const canonicalUrl = canonicalizeUrl(articleUrl);
  const contentHash = hashValue([title, summary ?? "", bodyText ?? ""].join("\n"));
  const sourcePublishedAt = extractPublishedAt(dom);

  return insertDocument(db, {
    sourceId,
    sourceEndpointId,
    rawDocumentId,
    canonicalUrl,
    externalId: null,
    title,
    summary,
    bodyText,
    sourcePublishedAt,
    contentHash,
    metadata: {
      byline: article?.byline ?? null,
      siteName: article?.siteName ?? null,
    },
  });
}

async function upsertHtmlDocument(rawDocumentId: number, sourceId: number, sourceEndpointId: number, url: string, body: string) {
  const db = getDb();
  const dom = new JSDOM(body, { url });

  const articleLinks = extractArticleLinks(dom, url);

  if (articleLinks.length === 0) {
    logger.info({ url }, "No article links found on listing page, skipping");
    return 0;
  }

  let extractedCount = 0;
  let skippedCount = 0;
  let sourceCapSkippedCount = 0;
  const existingCanonicalUrls = await getExistingCanonicalUrls(db, articleLinks);

  for (const articleUrl of articleLinks) {
    try {
      if (existingCanonicalUrls.has(articleUrl)) {
        skippedCount += 1;
        continue;
      }

      const response = await fetch(articleUrl, {
        headers: {
          "user-agent": userAgent,
          accept: "text/html;q=0.9, */*;q=0.8",
        },
      });

      if (!response.ok) continue;

      const articleBody = await response.text();
      const inserted = await upsertSingleHtmlDocument(
        db,
        rawDocumentId,
        sourceId,
        sourceEndpointId,
        articleUrl,
        articleBody,
        extractedCount,
      );

      if (inserted === "source_cap") {
        sourceCapSkippedCount += 1;
      } else if (inserted) {
        extractedCount += 1;
        logger.info({ articleUrl }, "Extracted article from listing page");
      } else {
        skippedCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.warn({ articleUrl, error: message }, "Failed to fetch article from listing page");
    }
  }

  if (skippedCount > 0) {
    logger.info({ url, skippedCount }, "Skipped article URLs already present in documents");
  }

  if (sourceCapSkippedCount > 0) {
    logger.info(
      { url, sourceCapSkippedCount, maxDocumentsPerSource: MAX_DOCUMENTS_PER_SOURCE },
      "Skipped article URLs because the per-source fetch cap was reached",
    );
  }

  return extractedCount;
}

export async function fetchSourceEndpoint(payload: FetchSourceEndpointPayload, bossJobId: string | null = null) {
  const db = getDb();
  const [endpoint] = await db
    .select({
      id: schema.sourceEndpoints.id,
      sourceId: schema.sourceEndpoints.sourceId,
      sourceName: schema.sources.name,
      baseUrl: schema.sources.baseUrl,
      kind: schema.sourceEndpoints.kind,
      url: schema.sourceEndpoints.url,
    })
    .from(schema.sourceEndpoints)
    .innerJoin(schema.sources, eq(schema.sources.id, schema.sourceEndpoints.sourceId))
    .where(and(eq(schema.sourceEndpoints.id, payload.endpointId), eq(schema.sourceEndpoints.isActive, true)));

  if (!endpoint) {
    throw new Error(`Endpoint ${payload.endpointId} was not found`);
  }

  const [fetchJobRow] = await db
    .insert(schema.fetchJobs)
    .values({
      sourceEndpointId: endpoint.id,
      bossJobId,
      status: "running",
      scheduledFor: new Date(),
      startedAt: new Date(),
    })
    .returning({ id: schema.fetchJobs.id });
  const fetchJob = requireRow(fetchJobRow, `fetch job ${endpoint.id}`);

  const startedAt = Date.now();

  try {
    const response = await fetchEndpoint(endpoint.url);
    const body = await response.text();
    const finishedAt = new Date();
    const durationMs = Date.now() - startedAt;
    const mimeType = inferMimeType(response.headers.get("content-type"));
    const contentHash = hashValue(body);

    const storedPayload = await persistRawPayload(contentHash, mimeType, body);

    const [rawDocumentRow] = await db
      .insert(schema.rawDocuments)
      .values({
        sourceId: endpoint.sourceId,
        sourceEndpointId: endpoint.id,
        sourceUrl: endpoint.url,
        canonicalUrl: endpoint.url,
        contentHash,
        mimeType,
        storageProvider: "local_fs",
        storageKey: storedPayload.storageKey,
        contentLength: storedPayload.contentLength,
        fetchedAt: finishedAt,
        metadata: {
          sourceName: endpoint.sourceName,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        },
      })
      .returning({ id: schema.rawDocuments.id });
    const rawDocument = requireRow(rawDocumentRow, `raw document ${endpoint.id}`);

    const extractedCount =
      endpoint.kind === "rss"
        ? await upsertFeedDocuments(rawDocument.id, endpoint.sourceId, endpoint.id, endpoint.baseUrl, body)
        : await upsertHtmlDocument(rawDocument.id, endpoint.sourceId, endpoint.id, endpoint.url, body);

    await db.insert(schema.fetchAttempts).values({
      fetchJobId: fetchJob.id,
      status: "succeeded",
      httpStatus: response.status,
      contentHash,
      rawDocumentId: rawDocument.id,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      startedAt: new Date(startedAt),
      finishedAt,
      durationMs,
      errorMessage: null,
    });

    await db
      .update(schema.fetchJobs)
      .set({
        status: "succeeded",
        attemptCount: 1,
        completedAt: finishedAt,
        errorMessage: null,
      })
      .where(eq(schema.fetchJobs.id, fetchJob.id));

    logger.info(
      {
        endpointId: endpoint.id,
        endpointKind: endpoint.kind,
        extractedCount,
      },
      "Fetched source endpoint",
    );

    return {
      endpointId: endpoint.id,
      extractedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    const httpStatus = error instanceof FetchHttpError ? error.status : undefined;
    const finishedAt = new Date();

    await db.insert(schema.fetchAttempts).values({
      fetchJobId: fetchJob.id,
      status: "failed",
      httpStatus,
      contentHash: undefined,
      rawDocumentId: undefined,
      responseHeaders: {},
      startedAt: new Date(startedAt),
      finishedAt,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    });

    await db
      .update(schema.fetchJobs)
      .set({
        status: "failed",
        attemptCount: 1,
        completedAt: finishedAt,
        errorMessage: message,
      })
      .where(eq(schema.fetchJobs.id, fetchJob.id));

    logger.error(
      {
        endpointId: endpoint.id,
        error: message,
      },
      "Source endpoint fetch failed",
    );

    throw error;
  }
}
