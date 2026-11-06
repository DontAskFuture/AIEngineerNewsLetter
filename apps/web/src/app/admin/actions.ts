"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { triggerCrawl, triggerScoring } from "@/lib/crawler";
import { forceTopStoriesSummaryForProfile } from "@/lib/personalized-feed";

export async function triggerCrawlAction() {
  const user = await requireAdmin();

  if (!user) {
    redirect("/login");
  }

  await triggerCrawl();

  revalidatePath("/admin");
}

export async function triggerScoreAllAction() {
  const user = await requireAdmin();

  if (!user) {
    redirect("/login");
  }

  await triggerScoring();

  revalidatePath("/admin");
  revalidatePath("/feed");
}

export async function forceTopStoriesSummaryAction(profileId: number) {
  const user = await requireAdmin();

  if (!user) {
    redirect("/login");
  }

  const parsedProfileId = Number(profileId);
  if (!Number.isInteger(parsedProfileId) || parsedProfileId <= 0) {
    return;
  }

  await forceTopStoriesSummaryForProfile(parsedProfileId, "week");

  revalidatePath("/admin");
  revalidatePath("/feed");
}
