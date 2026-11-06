import { getDb, schema } from "@ai-intel/db";
import { eq, asc } from "drizzle-orm";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { scoreUnscoredDocuments } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") {
    return new Response(
      JSON.stringify({ error: "Forbidden cross-site request" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const { user, isAuthorized } = await getAuthenticatedAdmin();
  if (!user || !isAuthorized) {
    return new Response(
      JSON.stringify({ error: !user ? "Unauthorized" : "Forbidden" }),
      {
        status: !user ? 401 : 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const db = getDb();
  const profiles = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.isActive, true))
    .orderBy(asc(schema.userProfiles.id));

  // Use a streaming response to keep the connection alive
  // while scoring runs. Next.js won't kill the process as long
  // as the response stream is open.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "started", profileCount: profiles.length });

      for (const profile of profiles) {
        try {
          const progress = await scoreUnscoredDocuments(profile.id);
          console.log(`[score-all] Profile ${profile.id}: scored ${progress.scored}, failed ${progress.failed}`);
          send({
            type: "profile_done",
            profileId: profile.id,
            scored: progress.scored,
            failed: progress.failed,
            totalUnscored: progress.totalUnscored,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`[score-all] Profile ${profile.id} failed:`, message);
          send({ type: "profile_error", profileId: profile.id, error: message });
        }
      }

      send({ type: "completed" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
