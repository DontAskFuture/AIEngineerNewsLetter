"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { triggerCrawl, triggerScoring } from "@/lib/crawler";

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
