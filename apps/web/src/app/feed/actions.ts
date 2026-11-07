"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import {
  InvalidSubscriberEmailError,
  subscribeToNewsletter,
} from "@/lib/newsletter-subscribers";
import {
  createUserProfile,
  deleteUserProfile,
  DuplicateProfileNameError,
  isValidTimeWindow,
  LastProfileDeleteError,
  ProfileLimitExceededError,
  saveStoryCurationNote,
  setDefaultUserProfile,
  setStoryHidden,
  setStoryPinned,
  updateUserProfile,
} from "@/lib/personalized-feed";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function buildFeedRedirect(slug: string | null | undefined, timeWindow: string, error?: string) {
  const params = new URLSearchParams();
  const resolvedTimeWindow = isValidTimeWindow(timeWindow) ? timeWindow : "week";

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

    if (error instanceof ProfileLimitExceededError) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(null, timeWindow, "profile_limit_exceeded"));
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

  if (!Number.isInteger(profileId) || profileId <= 0) {
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

    if (error instanceof ProfileLimitExceededError) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(null, timeWindow, "profile_limit_exceeded"));
    }

    if (error instanceof Error && error.message.includes("was not found")) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(null, timeWindow));
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

  if (!Number.isInteger(profileId) || profileId <= 0) {
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

    if (error instanceof Error && error.message.includes("was not found")) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(null, timeWindow));
    }

    throw error;
  }
}

export async function setDefaultUserProfileAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const rawProfileId = getTextField(formData, "profileId");
  const profileId = Number(rawProfileId);
  const timeWindow = getTextField(formData, "timeWindow");

  if (!Number.isInteger(profileId) || profileId <= 0) {
    revalidatePath("/feed");
    redirect(buildFeedRedirect(null, timeWindow));
  }

  try {
    await setDefaultUserProfile({
      userId: currentUser.id,
      profileId,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("was not found")) {
      revalidatePath("/feed");
      redirect(buildFeedRedirect(null, timeWindow));
    }

    throw error;
  }

  revalidatePath("/feed");
  redirect(buildFeedRedirect(null, timeWindow));
}

function parsePositiveInt(raw: string): number | null {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

export async function saveStoryCurationNoteAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parsePositiveInt(getTextField(formData, "documentId"));
  const timeWindow = getTextField(formData, "timeWindow");
  const profileSlug = getTextField(formData, "profile").trim().slice(0, 64) || null;
  const curatorNote = getTextField(formData, "curatorNote");

  if (!documentId) {
    redirect(buildFeedRedirect(profileSlug, timeWindow));
  }

  await saveStoryCurationNote({
    userId: currentUser.id,
    documentId,
    curatorNote,
  });

  revalidatePath("/feed");
  revalidatePath("/rss.xml");
  redirect(buildFeedRedirect(profileSlug, timeWindow));
}

export async function toggleStoryPinAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parsePositiveInt(getTextField(formData, "documentId"));
  const timeWindow = getTextField(formData, "timeWindow");
  const profileSlug = getTextField(formData, "profile").trim().slice(0, 64) || null;
  const isPinned = getTextField(formData, "isPinned") === "true";

  if (!documentId) {
    redirect(buildFeedRedirect(profileSlug, timeWindow));
  }

  await setStoryPinned({
    userId: currentUser.id,
    documentId,
    isPinned,
  });

  revalidatePath("/feed");
  revalidatePath("/rss.xml");
  redirect(buildFeedRedirect(profileSlug, timeWindow));
}

export async function toggleStoryHideAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parsePositiveInt(getTextField(formData, "documentId"));
  const timeWindow = getTextField(formData, "timeWindow");
  const profileSlug = getTextField(formData, "profile").trim().slice(0, 64) || null;
  const isHidden = getTextField(formData, "isHidden") === "true";

  if (!documentId) {
    redirect(buildFeedRedirect(profileSlug, timeWindow));
  }

  await setStoryHidden({
    userId: currentUser.id,
    documentId,
    isHidden,
  });

  revalidatePath("/feed");
  revalidatePath("/rss.xml");
  redirect(buildFeedRedirect(profileSlug, timeWindow));
}

export async function subscribeNewsletterAction(formData: FormData) {
  const email = getTextField(formData, "email");
  const rawWindow = getTextField(formData, "timeWindow");
  const resolvedWindow = isValidTimeWindow(rawWindow) ? rawWindow : "week";
  const params = new URLSearchParams({ window: resolvedWindow });

  try {
    await subscribeToNewsletter(email);
    params.set("newsletter", "subscribed");
  } catch (error) {
    if (error instanceof InvalidSubscriberEmailError) {
      params.set("newsletter", "invalid_email");
    } else {
      console.error("Failed to subscribe email to newsletter", { error });
      params.set("newsletter", "error");
    }
  }

  revalidatePath("/feed");
  redirect(`/feed?${params.toString()}`);
}
