"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { createUserProfile, updateUserProfile } from "@/lib/personalized-feed";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

export async function createUserProfileAction(formData: FormData) {
  await requireCurrentUser();

  const profile = await createUserProfile({
    displayName: getTextField(formData, "displayName"),
    interestStatement: getTextField(formData, "interestStatement"),
  });

  revalidatePath("/feed");
  redirect(`/feed?profile=${encodeURIComponent(profile.slug)}`);
}

export async function updateUserProfileAction(formData: FormData) {
  await requireCurrentUser();

  const rawProfileId = getTextField(formData, "profileId");
  const profileId = Number(rawProfileId);

  if (!Number.isInteger(profileId)) {
    revalidatePath("/feed");
    redirect("/feed");
  }

  const profile = await updateUserProfile({
    profileId,
    displayName: getTextField(formData, "displayName"),
    interestStatement: getTextField(formData, "interestStatement"),
  });

  revalidatePath("/feed");
  redirect(`/feed?profile=${encodeURIComponent(profile.slug)}`);
}
