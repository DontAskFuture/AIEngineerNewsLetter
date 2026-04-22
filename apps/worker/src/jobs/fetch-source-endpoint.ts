import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import RSSParser from "rss-parser";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { canonicalizeUrl, type FetchSourceEndpointPayload } from "@ai-intel/shared";
import { logger } from "../logger";
import { persistRawPayload } from "../storage/local-raw-store";

const parser = new RSSParser();
const userAgent = "ai-builder-intelligence-bot/0.1 (+https://localhost)";

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

function inferMimeType(contentTypeHeader: string | null) {
  if (!contentTypeHeader) {
    return "text/html";
  }

  return contentTypeHeader.split(";")[0]?.trim() || "text/html";
}

function buildFallbackUrl(baseUrl: string, title: string, externalId: string | null) {
  return `${baseUrl.replace(/\/$/, "")}#${hashValue(externalId ?? title).slice(0, 16)}`;
}

async function upsertFeedDocuments(rawDocumentId: number, sourceId: number, sourceEndpointId: number, baseUrl: string, body: string) {
  const db = getDb();
  const feed = await parser.parseString(body);
  let extractedCount = 0;

  for (const item of feed.items) {
    const title = item.title?.trim();

    if (!title) {
      continue;
    }

    const canonicalUrl = canonicalizeUrl(item.link ?? buildFallbackUrl(baseUrl, title, item.guid ?? null));
    const summary = item.contentSnippet?.trim() || item.summary?.trim() || null;
    const encodedContent = (item as Record<string, string | undefined>)["content:encoded"];
    const bodyText = item.content?.trim() || encodedContent?.trim() || summary;
    const sourcePublishedAt = toDate(item.isoDate ?? item.pubDate);
    const contentHash = hashValue([title, summary ?? "", bodyText ?? ""].join("\n"));

    await db
      .insert(schema.documents)
      .values({
        sourceId,
        sourceEndpointId,
        rawDocumentId,
        canonicalUrl,
        externalId: item.guid ?? null,
        title,
        summary,
        bodyText,
        sourcePublishedAt,
        contentHash,
        metadata: {
          creator: item.creator ?? null,
          categories: item.categories ?? [],
          feedTitle: feed.title ?? null,
        },
      })
      .onConflictDoUpdate({
        target: schema.documents.canonicalUrl,
        set: {
          rawDocumentId,
          externalId: item.guid ?? null,
          title,
          summary,
          bodyText,
          sourcePublishedAt,
          contentHash,
          metadata: {
            creator: item.creator ?? null,
            categories: item.categories ?? [],
            feedTitle: feed.title ?? null,
          },
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });

    extractedCount += 1;
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
): Promise<boolean> {
  const dom = new JSDOM(body, { url: articleUrl });
  const article = new Readability(dom.window.document).parse();

  const title = article?.title?.trim() || dom.window.document.title?.trim();
  if (!title) return false;

  const summary = article?.excerpt?.trim() || null;
  const bodyText = article?.textContent?.trim() || null;
  const canonicalUrl = canonicalizeUrl(articleUrl);
  const contentHash = hashValue([title, summary ?? "", bodyText ?? ""].join("\n"));

  await db
    .insert(schema.documents)
    .values({
      sourceId,
      sourceEndpointId,
      rawDocumentId,
      canonicalUrl,
      externalId: null,
      title,
      summary,
      bodyText,
      sourcePublishedAt: null,
      contentHash,
      metadata: {
        byline: article?.byline ?? null,
        siteName: article?.siteName ?? null,
      },
    })
    .onConflictDoUpdate({
      target: schema.documents.canonicalUrl,
      set: {
        rawDocumentId,
        title,
        summary,
        bodyText,
        contentHash,
        metadata: {
          byline: article?.byline ?? null,
          siteName: article?.siteName ?? null,
        },
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });

  return true;
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

  for (const articleUrl of articleLinks) {
    try {
      const response = await fetch(articleUrl, {
        headers: {
          "user-agent": userAgent,
          accept: "text/html;q=0.9, */*;q=0.8",
        },
      });

      if (!response.ok) continue;

      const articleBody = await response.text();
      const inserted = await upsertSingleHtmlDocument(db, rawDocumentId, sourceId, sourceEndpointId, articleUrl, articleBody);

      if (inserted) {
        extractedCount += 1;
        logger.info({ articleUrl }, "Extracted article from listing page");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.warn({ articleUrl, error: message }, "Failed to fetch article from listing page");
    }
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
    const response = await fetch(endpoint.url, {
      headers: {
        "user-agent": userAgent,
        accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8",
      },
    });
    const body = await response.text();
    const finishedAt = new Date();
    const durationMs = Date.now() - startedAt;
    const mimeType = inferMimeType(response.headers.get("content-type"));
    const contentHash = hashValue(body);

    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }

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
    const finishedAt = new Date();

    await db.insert(schema.fetchAttempts).values({
      fetchJobId: fetchJob.id,
      status: "failed",
      httpStatus: undefined,
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
