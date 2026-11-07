import { NextResponse } from "next/server";
import { unsubscribeFromNewsletterByToken } from "@/lib/newsletter-subscribers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  if (token) {
    try {
      await unsubscribeFromNewsletterByToken(token);
    } catch (error) {
      console.warn("Failed to unsubscribe newsletter token", { error });
    }
  }

  return NextResponse.redirect(new URL("/feed?window=week&newsletter=unsubscribed", request.url));
}

export async function POST(request: Request) {
  return GET(request);
}
