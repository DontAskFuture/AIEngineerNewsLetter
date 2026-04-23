"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { createUserProfile, updateUserProfile } from "@/lib/personalized-feed";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function buildFeedRedirect(slug: string, timeWindow: string) {
  const params = new URLSearchParams({
    profile: slug,
  });

  if (timeWindow) {
    params.set("window", timeWindow);
  }

  return `/feed?${params.toString()}`;
}

export async function createUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();

  const profile = await createUserProfile({
    userId: currentUser.id,
    displayName: getTextField(formData, "displayName"),
    interestStatement: getTextField(formData, "interestStatement"),
  });
  const timeWindow = getTextField(formData, "timeWindow");

  revalidatePath("/feed");
  redirect(buildFeedRedirect(profile.slug, timeWindow));
}

export async function updateUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();

  const rawProfileId = getTextField(formData, "profileId");
  const profileId = Number(rawProfileId);

  if (!Number.isInteger(profileId)) {
    revalidatePath("/feed");
    redirect("/feed");
  }

  const profile = await updateUserProfile({
    userId: currentUser.id,
    profileId,
    displayName: getTextField(formData, "displayName"),
    interestStatement: getTextField(formData, "interestStatement"),
  });
  const timeWindow = getTextField(formData, "timeWindow");

  revalidatePath("/feed");
  redirect(buildFeedRedirect(profile.slug, timeWindow));
}
