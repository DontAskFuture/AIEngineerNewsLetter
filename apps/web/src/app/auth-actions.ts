"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError, logoutCurrentUser, signInWithPassword, signUpWithPassword } from "@/lib/auth";

function getTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function buildAuthRedirect(path: string, email: string, errorCode?: string) {
  const searchParams = new URLSearchParams();

  if (email) {
    searchParams.set("email", email);
  }

  if (errorCode) {
    searchParams.set("error", errorCode);
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export async function loginAction(formData: FormData) {
  const email = getTextField(formData, "email").trim().toLowerCase();
  const password = getTextField(formData, "password");

  try {
    await signInWithPassword(email, password);
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(buildAuthRedirect("/login", email, error.code));
    }

    redirect(buildAuthRedirect("/login", email, "unknown"));
  }

  revalidatePath("/", "layout");
  redirect("/feed?window=week");
}

export async function signupAction(formData: FormData) {
  const email = getTextField(formData, "email").trim().toLowerCase();
  const password = getTextField(formData, "password");

  try {
    await signUpWithPassword(email, password);
  } catch (error) {
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
