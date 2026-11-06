"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  assertLoginAttemptAllowed,
  AuthError,
  getSafeRedirectPath,
  logoutCurrentUser,
  recordLoginAttempt,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function buildAuthRedirect(
  path: string,
  email: string,
  errorCode?: string,
  nextPath?: string | null,
) {
  const searchParams = new URLSearchParams();

  if (email) {
    searchParams.set("email", email);
  }

  if (errorCode) {
    searchParams.set("error", errorCode);
  }

  if (nextPath) {
    searchParams.set("next", nextPath);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

async function getClientIpAddress() {
  const headerStore = await headers();
  const forwardedFor = headerStore.get("cf-connecting-ip") ?? headerStore.get("x-forwarded-for") ?? "";
  return forwardedFor.split(",")[0]?.trim() || "unknown";
}

export async function loginAction(formData: FormData) {
  const email = getTextField(formData, "email").trim().toLowerCase();
  const password = getTextField(formData, "password");
  const nextPath = getSafeRedirectPath(getTextField(formData, "next"));
  const ipAddress = await getClientIpAddress();

  try {
    await assertLoginAttemptAllowed(email, ipAddress);
    await signInWithPassword(email, password);
    await recordLoginAttempt(email, ipAddress, true);
  } catch (error) {
    if (!(error instanceof AuthError && error.code === "too_many_attempts")) {
      await recordLoginAttempt(email, ipAddress, false);
    }

    if (error instanceof AuthError) {
      redirect(buildAuthRedirect("/login", email, error.code, nextPath));
    }

    redirect(buildAuthRedirect("/login", email, "unknown", nextPath));
  }

  revalidatePath("/", "layout");
  redirect(nextPath ?? "/feed?window=week");
}

export async function signupAction(formData: FormData) {
  const email = getTextField(formData, "email").trim().toLowerCase();
  const password = getTextField(formData, "password");
  const ipAddress = await getClientIpAddress();

  try {
    await assertLoginAttemptAllowed(email, ipAddress);
    await signUpWithPassword(email, password);
    await recordLoginAttempt(email, ipAddress, true);
  } catch (error) {
    if (!(error instanceof AuthError && error.code === "too_many_attempts")) {
      await recordLoginAttempt(email, ipAddress, false);
    }

    if (error instanceof AuthError) {
      redirect(buildAuthRedirect("/signup", email, error.code));
    }

    redirect(buildAuthRedirect("/signup", email, "unknown"));
  }

  revalidatePath("/", "layout");
  redirect("/feed?window=week");
}

export async function logoutAction() {
  await logoutCurrentUser();
  revalidatePath("/", "layout");
  redirect("/login");
}
