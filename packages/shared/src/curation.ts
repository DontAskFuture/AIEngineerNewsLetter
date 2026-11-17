import { isTakePlaceholder } from "./prompts";
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
  if (!raw || isTakePlaceholder(raw)) {
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

export const TOP_VISUAL_STORY_SLOTS = 3;

const BLOCKED_IMAGE_URL_SUBSTRINGS = [
  "favicon",
  "apple-touch-icon",
  "avatar",
  "gravatar",
  "author-photo",
  "emoji",
  "smilie",
  "/pixel",
  "1x1",
  "spacer",
  "shields.io",
  "doubleclick",
  "google-analytics",
  "arxiv-logo",
  "opengraph-cover-image",
  "deepseek-social-card",
  "default-og",
  "default-share",
  "site-logo",
  "brand-logo",
  "opengraph.githubassets.com",
  "avatars.githubusercontent.com",
  "redditstatic.com",
  "ycombinator.com",
] as const;

const MEANINGLESS_ALT_PATTERN = /^(?:image|img|photo|thumbnail|banner|[\w.-]+\.(?:png|jpe?g|webp|avif))$/i;

export interface StoryImageMetadata {
  imageUrl: string;
  imageAlt: string | null;
}

function isDisallowedImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.startsWith("[")
  );
}

export function sanitizeStoryImageUrl(rawUrl: string | null | undefined): string | null {
  const trimmed = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!trimmed || trimmed.length > 2048) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    return null;
  }
  if (isDisallowedImageHost(parsed.hostname)) {
    return null;
  }

  const lowerPath = parsed.pathname.toLowerCase();
  if (lowerPath.endsWith(".svg") || lowerPath.endsWith(".ico") || lowerPath.endsWith(".gif")) {
    return null;
  }

  const normalizedUrl = parsed.toString();
  const lowerUrl = normalizedUrl.toLowerCase();
  if (BLOCKED_IMAGE_URL_SUBSTRINGS.some((token) => lowerUrl.includes(token))) {
    return null;
  }

  return normalizedUrl;
}

export function sanitizeStoryImageAlt(rawAlt: string | null | undefined): string | null {
  if (typeof rawAlt !== "string") {
    return null;
  }
  const cleaned = rawAlt
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || MEANINGLESS_ALT_PATTERN.test(cleaned)) {
    return null;
  }
  if (cleaned.length <= 220) {
    return cleaned;
  }
  return `${cleaned.slice(0, 219).trimEnd()}…`;
}

export function readDocumentStoryImage(metadata: unknown): StoryImageMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  const imageUrl = sanitizeStoryImageUrl(
    typeof record.imageUrl === "string" ? record.imageUrl : null,
  );
  if (!imageUrl) {
    return null;
  }
  const imageAlt = sanitizeStoryImageAlt(
    typeof record.imageAlt === "string" ? record.imageAlt : null,
  );
  return { imageUrl, imageAlt };
}

export function shouldDisplayTopStoryImage(
  index: number,
  isPinned: boolean,
  image: StoryImageMetadata | null | undefined,
): boolean {
  return Boolean(image?.imageUrl) && (index < TOP_VISUAL_STORY_SLOTS || isPinned);
}

function inferImageMimeType(urlString: string): string {
  try {
    const pathname = new URL(urlString).pathname.toLowerCase();
    if (pathname.endsWith(".png")) return "image/png";
    if (pathname.endsWith(".webp")) return "image/webp";
    if (pathname.endsWith(".avif")) return "image/avif";
  } catch {
    // Fallback to JPEG
  }
  return "image/jpeg";
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
  imageUrl?: string | null;
  imageAlt?: string | null;
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
  const channelTitle = `${brandAuthorName}'s Newsletter`;
  const lastBuildDate = (items[0]?.sortTime ?? now).toUTCString();

  const itemsXml = items
    .map((doc, index) => {
      const link = sanitizeHttpUrl(doc.canonicalUrl, feedUrl);
      const titlePrefix = doc.isPinned ? "[Pinned Pick] " : "";
      const descriptionParts: string[] = [];
      const take = formatPractitionerTake(doc.curatorNote, doc.whyRelevant);
      const validImageUrl = sanitizeStoryImageUrl(doc.imageUrl);
      const includeEnclosure =
        validImageUrl &&
        shouldDisplayTopStoryImage(index, doc.isPinned, {
          imageUrl: validImageUrl,
          imageAlt: sanitizeStoryImageAlt(doc.imageAlt),
        });

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
        ...(includeEnclosure
          ? [
              `      <enclosure url="${escapeXml(validImageUrl)}" length="0" type="${inferImageMimeType(validImageUrl)}" />`,
            ]
          : []),
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
