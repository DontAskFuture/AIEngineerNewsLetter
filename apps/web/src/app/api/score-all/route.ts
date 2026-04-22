import { NextResponse } from "next/server";
import { getDb, schema } from "@ai-intel/db";
import { eq, asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { scoreUnscoredDocuments } from "@/lib/scoring";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const profiles = await db
    .select({ id: schema.userProfiles.id })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.isActive, true))
    .orderBy(asc(schema.userProfiles.id));

  // Fire and forget — start scoring in background, return immediately
  const scoringPromise = (async () => {
    for (const profile of profiles) {
      try {
        const progress = await scoreUnscoredDocuments(profile.id);
        console.log(`[score-all] Profile ${profile.id}: scored ${progress.scored}, failed ${progress.failed}`);
      } catch (error) {
        console.error(`[score-all] Profile ${profile.id} failed:`, error);
      }
    }
  })();

  // Don't await — let it run in the background
  scoringPromise.catch((err) => console.error("[score-all] Background scoring error:", err));

  return NextResponse.json({
    status: "started",
    profileCount: profiles.length,
    message: "Scoring started in background. Check logs for progress.",
  });
}
