"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import {
  createUserProfile,
  deleteUserProfile,
  DuplicateProfileNameError,
  LastProfileDeleteError,
  updateUserProfile,
} from "@/lib/personalized-feed";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function buildFeedRedirect(slug: string | null | undefined, timeWindow: string, error?: string) {
  const params = new URLSearchParams();
  const resolvedTimeWindow = timeWindow || "week";

  if (slug) {
    params.set("profile", slug);
  }

  params.set("window", resolvedTimeWindow);

  if (error) {
    params.set("error", error);
  }

  return `/feed?${params.toString()}`;
}

export async function createUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const timeWindow = getTextField(formData, "timeWindow");

  let profile;

  try {
    profile = await createUserProfile({
      userId: currentUser.id,
      displayName: getTextField(formData, "displayName"),
      interestStatement: getTextField(formData, "interestStatement"),
    });
  } catch (error) {
    if (error instanceof DuplicateProfileNameError) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(error.profileSlug, timeWindow, "duplicate_profile_name"));
    }

    throw error;
  }

  revalidatePath("/feed");
  redirect(buildFeedRedirect(profile.slug, timeWindow));
}

export async function updateUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();

  const rawProfileId = getTextField(formData, "profileId");
  const profileId = Number(rawProfileId);
  const timeWindow = getTextField(formData, "timeWindow");

  if (!Number.isInteger(profileId)) {
    revalidatePath("/feed");
    redirect("/feed?window=week");
  }

  let profile;

  try {
    profile = await updateUserProfile({
      userId: currentUser.id,
      profileId,
      displayName: getTextField(formData, "displayName"),
      interestStatement: getTextField(formData, "interestStatement"),
    });
  } catch (error) {
    if (error instanceof DuplicateProfileNameError) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(error.profileSlug, timeWindow, "duplicate_profile_name"));
    }

    throw error;
  }

  revalidatePath("/feed");
  redirect(buildFeedRedirect(profile.slug, timeWindow));
}

export async function deleteUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const rawProfileId = getTextField(formData, "profileId");
  const profileId = Number(rawProfileId);
  const timeWindow = getTextField(formData, "timeWindow");

  if (!Number.isInteger(profileId)) {
    revalidatePath("/feed");
    redirect(buildFeedRedirect(null, timeWindow));
  }

  try {
    const result = await deleteUserProfile({
      userId: currentUser.id,
      profileId,
    });

    revalidatePath("/feed");
    redirect(buildFeedRedirect(result.nextProfile?.slug, timeWindow));
  } catch (error) {
    if (error instanceof LastProfileDeleteError) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(error.profileSlug, timeWindow, "last_profile_delete"));
    }

    throw error;
  }
}
