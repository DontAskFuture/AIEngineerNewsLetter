"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import {
  addDocumentToReadList,
  removeDocumentFromReadList,
} from "@/lib/document-read-list";
import { markDocumentRead } from "@/lib/read-tracking";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function resolveRedirect(formData: FormData) {
  const returnTo = getTextField(formData, "returnTo");
  const filter = getTextField(formData, "filter") || "all";
  const timeWindow = getTextField(formData, "timeWindow") || "week";
  const profile = getTextField(formData, "profile") || null;

  if (returnTo === "feed") {
    const params = new URLSearchParams();
    params.set("window", timeWindow);
    if (profile) {
      params.set("profile", profile);
    }
    return `/feed?${params.toString()}`;
  }

  const params = new URLSearchParams();
  params.set("filter", filter === "unread" ? "unread" : "all");
  return `/read-list?${params.toString()}`;
}

function parseDocumentId(formData: FormData) {
  const raw = getTextField(formData, "documentId");
  const documentId = Number(raw);
  return Number.isInteger(documentId) && documentId > 0 ? documentId : null;
}

export async function addDocumentToReadListAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parseDocumentId(formData);

  if (!documentId) {
    redirect(resolveRedirect(formData));
  }

  await addDocumentToReadList(currentUser.id, documentId);
  revalidatePath("/read-list");
  revalidatePath("/feed");
  redirect(resolveRedirect(formData));
}

export async function removeDocumentFromReadListAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parseDocumentId(formData);

  if (!documentId) {
    redirect(resolveRedirect(formData));
  }

  await removeDocumentFromReadList(currentUser.id, documentId);
  revalidatePath("/read-list");
  revalidatePath("/feed");
  redirect(resolveRedirect(formData));
}

export async function markDocumentReadAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const documentId = parseDocumentId(formData);

  if (!documentId) {
    redirect(resolveRedirect(formData));
  }

  await markDocumentRead(currentUser.id, documentId);
  revalidatePath("/read-list");
  revalidatePath("/feed");
  redirect(resolveRedirect(formData));
}
