import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { and, desc, eq, gt, gte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { isHumanReadableStoryTitle, type StoryImageMetadata } from "@ai-intel/shared";
import { logger } from "../logger";
import {
  extractImageFromArticleDom,
  shouldSkipStoryPageImageFetch,
  toArxivHtmlUrl,
} from "../jobs/article-media";

const IMAGE_ENRICH_LOOKBACK_DAYS = 7;
const IMAGE_ENRICH_MIN_SCORE = 40;
const IMAGE_ENRICH_CANDIDATE_QUERY_LIMIT = 25;
const IMAGE_ENRICH_MAX_PER_RUN = 10;
const IMAGE_ENRICH_CONCURRENCY = 3;
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const IMAGE_FETCH_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_FETCH_MAX_REDIRECTS = 3;
const USER_AGENT = "ai-builder-intelligence-bot/0.1 (+https://localhost)";
const documentSortKey = sql<Date>`coalesce(${schema.documents.sourcePublishedAt}, ${schema.documents.discoveredAt})`;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isUnsafeIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    const ipv4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4MappedMatch) {
      return isPrivateIpv4(ipv4MappedMatch[1]!);
    }
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("64:ff9b:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab][0-9a-f]:/.test(normalized) ||
      normalized.startsWith("ff")
    );
  }
  return true;
}

async function validatePublicHttpsUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error(`Blocked non-HTTPS URL for image enrichment: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Blocked URL with embedded credentials");
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new Error(`Blocked URL with non-443 port: ${parsed.port}`);
  }
  const addresses = await lookup(parsed.hostname, { all: true, verbatim: false });
  if (addresses.length === 0 || addresses.some((entry) => isUnsafeIpAddress(entry.address))) {
    throw new Error(`Blocked internal or unsafe address for ${parsed.hostname}`);
  }
  return parsed;
}

async function readBoundedHtml(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Response exceeded ${maxBytes} bytes`);
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function fetchPublicHttpsHtml(
  initialUrl: string,
): Promise<{ html: string; finalUrl: string; httpStatus: number }> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= IMAGE_FETCH_MAX_REDIRECTS; hop += 1) {
    const validated = await validatePublicHttpsUrl(currentUrl);
    const response = await fetch(validated.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html, application/xhtml+xml;q=0.9, */*;q=0.5",
      },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || hop === IMAGE_FETCH_MAX_REDIRECTS) {
        throw new Error(`Redirect aborted (${response.status})`);
      }
      currentUrl = new URL(location, validated.toString()).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      return {
        html: "",
        finalUrl: validated.toString(),
        httpStatus: response.status,
      };
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      await response.body?.cancel();
      return {
        html: "",
        finalUrl: validated.toString(),
        httpStatus: response.status,
      };
    }

    const html = await readBoundedHtml(response, IMAGE_FETCH_MAX_BYTES);
    return {
      html,
      finalUrl: validated.toString(),
      httpStatus: response.status,
    };
  }

  throw new Error("Exceeded redirect limit");
}

async function mergeDocumentImageMetadata(
  documentId: number,
  image: StoryImageMetadata | null,
): Promise<void> {
  const db = getDb();
  const patch = JSON.stringify({
    imageChecked: true,
    imageUrl: image?.imageUrl ?? null,
    imageAlt: image?.imageAlt ?? null,
  });

  await db
    .update(schema.documents)
    .set({
      metadata: sql`${schema.documents.metadata} || ${patch}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(schema.documents.id, documentId));
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const count = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (index < items.length) {
        const current = items[index]!;
        index += 1;
        await worker(current);
      }
    }),
  );
}

export async function enrichTopStoryImagesForProfile(
  profileId: number,
  userId: number,
): Promise<{ checkedCount: number; foundCount: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - IMAGE_ENRICH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const pinnedFirstOrder = sql<boolean>`coalesce(${schema.storyCurations.isPinned}, false) AND NOT coalesce(${schema.storyCurations.isHidden}, false)`;

  const candidates = await db
    .select({
      id: schema.documents.id,
      title: schema.documents.title,
      canonicalUrl: schema.documents.canonicalUrl,
      isPinned: schema.storyCurations.isPinned,
    })
    .from(schema.documentScores)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentScores.documentId))
    .leftJoin(
      schema.storyCurations,
      and(
        eq(schema.storyCurations.documentId, schema.documents.id),
        eq(schema.storyCurations.userId, userId),
      ),
    )
    .where(
      and(
        eq(schema.documentScores.profileId, profileId),
        sql`coalesce(${schema.storyCurations.isHidden}, false) = false`,
        sql`(${schema.documents.metadata}->>'imageChecked') IS DISTINCT FROM 'true'`,
        sql`(${schema.documents.metadata}->>'imageUrl') IS NULL`,
        or(
          and(
            gte(schema.documentScores.score, IMAGE_ENRICH_MIN_SCORE),
            gt(documentSortKey, cutoff),
          ),
          eq(schema.storyCurations.isPinned, true),
        ),
      ),
    )
    .orderBy(desc(pinnedFirstOrder), desc(schema.documentScores.score), desc(documentSortKey))
    .limit(IMAGE_ENRICH_CANDIDATE_QUERY_LIMIT);

  const selected = candidates
    .filter((doc) => Boolean(doc.isPinned) || isHumanReadableStoryTitle(doc.title))
    .slice(0, IMAGE_ENRICH_MAX_PER_RUN);

  if (selected.length === 0) {
    return { checkedCount: 0, foundCount: 0 };
  }

  let checkedCount = 0;
  let foundCount = 0;

  await runWithConcurrency(selected, IMAGE_ENRICH_CONCURRENCY, async (doc) => {
    try {
      if (shouldSkipStoryPageImageFetch(doc.canonicalUrl)) {
        await mergeDocumentImageMetadata(doc.id, null);
        checkedCount += 1;
        return;
      }

      const targetUrl = toArxivHtmlUrl(doc.canonicalUrl) ?? doc.canonicalUrl;
      const result = await fetchPublicHttpsHtml(targetUrl);

      if (result.html) {
        const dom = new JSDOM(result.html, { url: result.finalUrl });
        const readerDoc = dom.window.document.cloneNode(true) as Document;
        const article = new Readability(readerDoc).parse();
        const image = extractImageFromArticleDom(dom, article?.content, result.finalUrl);
        await mergeDocumentImageMetadata(doc.id, image);
        checkedCount += 1;
        if (image) {
          foundCount += 1;
        }
        return;
      }

      if (result.httpStatus >= 400 && result.httpStatus < 500) {
        await mergeDocumentImageMetadata(doc.id, null);
        checkedCount += 1;
      }
    } catch (error) {
      logger.debug(
        { documentId: doc.id, url: doc.canonicalUrl, error: error instanceof Error ? error.message : String(error) },
        "Top-story image enrichment failed cleanly",
      );
    }
  });

  if (checkedCount > 0) {
    logger.info({ profileId, checkedCount, foundCount }, "Enriched top-story images");
  }

  return { checkedCount, foundCount };
}
