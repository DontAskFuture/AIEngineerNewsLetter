"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { triggerCrawl } from "@/lib/crawler";
import { scoreUnscoredDocuments } from "@/lib/scoring";
import { getDb, schema } from "@ai-intel/db";
import { eq, asc } from "drizzle-orm";

function fireAndForgetScoring() {
  const run = async () => {
    const db = getDb();
    const profiles = await db
      .select({ id: schema.userProfiles.id })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.isActive, true))
      .orderBy(asc(schema.userProfiles.id));

    for (const profile of profiles) {
      try {
        const progress = await scoreUnscoredDocuments(profile.id);
        console.log(`[auto-score] Profile ${profile.id}: scored ${progress.scored}, failed ${progress.failed}`);
      } catch (error) {
        console.error(`[auto-score] Profile ${profile.id} failed:`, error);
      }
    }
  };

  run().catch((err) => console.error("[auto-score] Background scoring error:", err));
}

export async function triggerCrawlAction() {
  const user = await requireAdmin();

  if (!user) {
    redirect("/login");
  }

  await triggerCrawl();

  // Fire and forget — score new documents in background
  fireAndForgetScoring();

  revalidatePath("/admin");
}

export async function triggerScoreAllAction() {
  const user = await requireAdmin();

  if (!user) {
    redirect("/login");
  }

  // Fire and forget — score all unscored documents in background
  fireAndForgetScoring();

  revalidatePath("/admin");
  revalidatePath("/feed");
}
