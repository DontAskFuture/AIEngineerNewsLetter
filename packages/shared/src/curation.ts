import { isOpinionPending } from "./prompts";
import type { SourceCategory } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export class InvalidSubscriberEmailError extends Error {
  constructor() {
    super("Enter a valid email address.");
    this.name = "InvalidSubscriberEmailError";
  }
}

export function normalizeSubscriberEmail(rawEmail: string): string {
  const cleaned = rawEmail.trim().toLowerCase();
  if (!cleaned || cleaned.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(cleaned)) {
    throw new InvalidSubscriberEmailError();
  }
  return cleaned;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function sanitizeHttpUrl(value: string, fallback: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    // Fall back to safe URL
  }
  return fallback;
}

/**
 * Returns the manual `curatorNote` if present, or falls back to `whyRelevant`
 * while stripping legacy second-person profile-matching boilerplate so every
 * story card reads like a direct practitioner take for AI engineers.
 */
export function formatPractitionerTake(
  curatorNote?: string | null,
  whyRelevant?: string | null,
): string | null {
  const manual = curatorNote?.trim();
  if (manual) {
    return manual;
  }

  const raw = whyRelevant?.trim();
  if (!raw || isOpinionPending(raw)) {
    return null;
  }

  let cleaned = raw
    .replace(
      /[,\s;—–-]+(?:which\s+is\s+|making\s+it\s+)?(?:directly\s+)?(?:relevant|aligned|aligning|matching|matches|addressing)\s+(?:to|for|with|the\s+trending\s+topic\s+of)?\s*(?:your\s+interest(?:s)?(?:\s+in)?|an?\s+AI\s+engineer(?:'s)?|AI\s+engineering\s+advancements|AI\s+agent\s+infrastructure\s+engineering|agentic\s+AI\s+architecture)[^.]*\.?$/i,
      ".",
    )
    .replace(
      /[,\s;—–-]+(?:which\s+are\s+|a\s+)?core\s+(?:AI\s+engineering\s+concern|interest(?:s)?\s+for\s+an?\s+AI\s+engineer)[^.]*\.?$/i,
      ".",
    )
    .replace(
      /[,\s;—–-]+matching\s+interest\s+in\s+[^.]*\.?$/i,
      ".",
    )
    .replace(/\.\.+$/, ".")
    .trim();

  if (!cleaned) {
    cleaned = raw;
  }

  return cleaned;
}

export interface CuratedRssItemInput {
  id: number;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  category: SourceCategory | string;
  sortTime: Date;
  previewParagraph: string | null;
  curatorNote: string | null;
  whyRelevant?: string | null;
  isPinned: boolean;
}

export function buildCuratedRssXml({
  brandAuthorName,
  brandAuthorBio,
  feedUrl,
  selfUrl,
  items,
  now = new Date(),
}: {
  brandAuthorName: string;
  brandAuthorBio: string;
  feedUrl: string;
  selfUrl: string;
  items: CuratedRssItemInput[];
  now?: Date;
}): string {
  const channelTitle = `${brandAuthorName} · Curated AI Intelligence`;
  const lastBuildDate = (items[0]?.sortTime ?? now).toUTCString();

  const itemsXml = items
    .map((doc) => {
      const link = sanitizeHttpUrl(doc.canonicalUrl, feedUrl);
      const titlePrefix = doc.isPinned ? "[Pinned Pick] " : "";
      const descriptionParts: string[] = [];
      const take = formatPractitionerTake(doc.curatorNote, doc.whyRelevant);

      if (take) {
        descriptionParts.push(`${brandAuthorName}'s Take: ${take}`);
      }
      if (doc.previewParagraph) {
        descriptionParts.push(doc.previewParagraph);
      }
      descriptionParts.push(`Source: ${doc.sourceName}`);

      return [
        "    <item>",
        `      <title>${escapeXml(`${titlePrefix}${doc.title}`)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">ai-intel-doc-${doc.id}</guid>`,
        `      <pubDate>${escapeXml(doc.sortTime.toUTCString())}</pubDate>`,
        `      <category>${escapeXml(doc.category)}</category>`,
        `      <description>${escapeXml(descriptionParts.join("\n\n"))}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channelTitle)}</title>`,
    `    <link>${escapeXml(feedUrl)}</link>`,
    `    <description>${escapeXml(brandAuthorBio)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    itemsXml,
    "  </channel>",
    "</rss>",
  ].join("\n");
}
