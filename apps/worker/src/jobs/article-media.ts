import { JSDOM } from "jsdom";
import {
  sanitizeStoryImageAlt,
  sanitizeStoryImageUrl,
  type StoryImageMetadata,
} from "@ai-intel/shared";

const MIN_IMAGE_DIMENSION_PX = 200;

function parseDimensionAttribute(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isTinyImageDimensions(widthRaw: unknown, heightRaw: unknown): boolean {
  const width = typeof widthRaw === "number"
    ? (widthRaw > 0 ? widthRaw : null)
    : parseDimensionAttribute(typeof widthRaw === "string" ? widthRaw : null);
  const height = typeof heightRaw === "number"
    ? (heightRaw > 0 ? heightRaw : null)
    : parseDimensionAttribute(typeof heightRaw === "string" ? heightRaw : null);

  return (
    (width !== null && width < MIN_IMAGE_DIMENSION_PX) ||
    (height !== null && height < MIN_IMAGE_DIMENSION_PX)
  );
}

function resolveCandidateUrl(rawSrc: string | null | undefined, baseUrl: string): string | null {
  const trimmed = rawSrc?.trim();
  if (!trimmed || trimmed.startsWith("data:")) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractCandidateFromImgElement(
  img: Element,
  baseUrl: string,
): StoryImageMetadata | null {
  if (
    isTinyImageDimensions(
      img.getAttribute("width"),
      img.getAttribute("height"),
    )
  ) {
    return null;
  }

  const rawSrc = img.getAttribute("src")?.trim();
  const effectiveRawSrc =
    rawSrc && !rawSrc.startsWith("data:")
      ? rawSrc
      : img.getAttribute("data-src")?.trim() || img.getAttribute("data-lazy-src")?.trim();

  const resolvedUrl = resolveCandidateUrl(effectiveRawSrc, baseUrl);
  const imageUrl = sanitizeStoryImageUrl(resolvedUrl);
  if (!imageUrl) {
    return null;
  }

  const figCaptionText = img.closest("figure")?.querySelector("figcaption")?.textContent;
  const imageAlt =
    sanitizeStoryImageAlt(figCaptionText) ??
    sanitizeStoryImageAlt(img.getAttribute("alt"));

  return { imageUrl, imageAlt };
}

function extractFirstValidImage(
  elements: Iterable<Element>,
  baseUrl: string,
): StoryImageMetadata | null {
  for (const img of elements) {
    const extracted = extractCandidateFromImgElement(img, baseUrl);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

export function toArxivHtmlUrl(canonicalUrl: string): string | null {
  const match = canonicalUrl
    .trim()
    .match(/^https?:\/\/(?:www\.)?arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)(?:\/)?$/i);
  if (!match) {
    return null;
  }
  return `https://arxiv.org/html/${match[1]}`;
}

export function shouldSkipStoryPageImageFetch(canonicalUrl: string): boolean {
  const trimmed = canonicalUrl.trim();
  return (
    /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:releases\/tag|commit|commits)\//i.test(trimmed) ||
    /^https?:\/\/(?:www\.)?reddit\.com\//i.test(trimmed)
  );
}

export function extractImageFromHtmlFragment(
  htmlFragment: string | null | undefined,
  baseUrl: string,
): StoryImageMetadata | null {
  if (!htmlFragment?.trim()) {
    return null;
  }

  const dom = new JSDOM(htmlFragment, { url: baseUrl });
  const effectiveBase = dom.window.document.baseURI || baseUrl;
  return extractFirstValidImage(
    dom.window.document.querySelectorAll("img"),
    effectiveBase,
  );
}

export function extractImageFromArticleDom(
  dom: JSDOM,
  articleContentHtml: string | null | undefined,
  pageUrl: string,
): StoryImageMetadata | null {
  const doc = dom.window.document;
  const effectiveBase = doc.baseURI || pageUrl;

  const figureImage = extractFirstValidImage(
    doc.querySelectorAll("figure img"),
    effectiveBase,
  );
  if (figureImage) {
    return figureImage;
  }

  const articleImage = extractImageFromHtmlFragment(articleContentHtml, effectiveBase);
  if (articleImage) {
    return articleImage;
  }

  const metaImageSelectors = [
    'meta[property="og:image:secure_url"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
  ];

  const metaAlt =
    sanitizeStoryImageAlt(doc.querySelector('meta[property="og:image:alt"]')?.getAttribute("content")) ??
    sanitizeStoryImageAlt(doc.querySelector('meta[name="twitter:image:alt"]')?.getAttribute("content"));

  for (const selector of metaImageSelectors) {
    const content = doc.querySelector(selector)?.getAttribute("content");
    const resolved = resolveCandidateUrl(content, effectiveBase);
    const imageUrl = sanitizeStoryImageUrl(resolved);
    if (imageUrl) {
      return {
        imageUrl,
        imageAlt: metaAlt,
      };
    }
  }

  return null;
}

function extractMediaEntryUrl(entry: unknown): { url: string | null; tiny: boolean } {
  if (!entry || typeof entry !== "object") {
    return { url: null, tiny: false };
  }
  const record = entry as Record<string, unknown>;
  const attrs =
    record.$ && typeof record.$ === "object"
      ? (record.$ as Record<string, unknown>)
      : record;
  const url = typeof attrs.url === "string" ? attrs.url : null;
  const tiny = isTinyImageDimensions(attrs.width, attrs.height);
  return { url, tiny };
}

export function extractImageFromFeedItem(
  item: Record<string, unknown>,
  baseUrl: string,
): StoryImageMetadata | null {
  const htmlFields = [
    item.contentEncoded,
    item["content:encoded"],
    item.content,
    item.summary,
  ];

  for (const field of htmlFields) {
    if (typeof field !== "string" || !field.trim()) continue;
    const extracted = extractImageFromHtmlFragment(field, baseUrl);
    if (extracted) {
      return extracted;
    }
  }

  const mediaLists = [item.mediaContent, item.mediaThumbnail];
  for (const list of mediaLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const { url, tiny } = extractMediaEntryUrl(entry);
      if (tiny || !url) continue;
      const imageUrl = sanitizeStoryImageUrl(resolveCandidateUrl(url, baseUrl));
      if (imageUrl) {
        return { imageUrl, imageAlt: null };
      }
    }
  }

  const enclosure = item.enclosure;
  if (enclosure && typeof enclosure === "object") {
    const enc = enclosure as Record<string, unknown>;
    const encType = typeof enc.type === "string" ? enc.type.toLowerCase() : "";
    const encUrl = typeof enc.url === "string" ? enc.url : null;
    if (encUrl && (!encType || encType.startsWith("image/"))) {
      const imageUrl = sanitizeStoryImageUrl(resolveCandidateUrl(encUrl, baseUrl));
      if (imageUrl) {
        return { imageUrl, imageAlt: null };
      }
    }
  }

  return null;
}
