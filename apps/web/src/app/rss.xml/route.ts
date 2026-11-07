import { buildCuratedRssXml } from "@ai-intel/shared";
import { loadWebEnv } from "@/lib/env";
import { getPublicAiEngineerFeedSnapshot } from "@/lib/personalized-feed";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = loadWebEnv();
  const baseUrl = (env.appBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const feedUrl = `${baseUrl}/feed?window=week`;
  const selfUrl = `${baseUrl}/rss.xml`;
  const snapshot = await getPublicAiEngineerFeedSnapshot("week");

  const xml = buildCuratedRssXml({
    brandAuthorName: env.brandAuthorName,
    brandAuthorBio: env.brandAuthorBio,
    feedUrl,
    selfUrl,
    items: snapshot.topDocuments,
  });

  return new Response(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
