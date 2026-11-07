import { loadWebEnv } from "@/lib/env";
import { getPublicAiEngineerFeedSnapshot } from "@/lib/personalized-feed";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeHttpUrl(value: string, fallback: string): string {
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

export async function GET() {
  const env = loadWebEnv();
  const baseUrl = (env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const feedUrl = `${baseUrl}/feed?window=week`;
  const selfUrl = `${baseUrl}/rss.xml`;
  const snapshot = await getPublicAiEngineerFeedSnapshot("week");

  const channelTitle = `${env.brandAuthorName} · Curated AI Intelligence`;
  const channelDescription = env.brandAuthorBio;
  const lastBuildDate = (snapshot.topDocuments[0]?.sortTime ?? new Date()).toUTCString();

  const itemsXml = snapshot.topDocuments
    .map((doc) => {
      const link = sanitizeHttpUrl(doc.canonicalUrl, feedUrl);
      const titlePrefix = doc.isPinned ? "[Pinned Pick] " : "";
      const descriptionParts: string[] = [];

      if (doc.curatorNote) {
        descriptionParts.push(`${env.brandAuthorName}'s Take: ${doc.curatorNote}`);
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

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(channelTitle)}</title>`,
    `    <link>${escapeXml(feedUrl)}</link>`,
    `    <description>${escapeXml(channelDescription)}</description>`,
    "    <language>en-us</language>",
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    itemsXml,
    "  </channel>",
    "</rss>",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
