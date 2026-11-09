import { NextResponse } from "next/server";
import { unsubscribeFromNewsletterByToken } from "@/lib/newsletter-subscribers";

async function processUnsubscribeToken(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  if (token) {
    try {
      await unsubscribeFromNewsletterByToken(token);
    } catch (error) {
      console.warn("Failed to unsubscribe newsletter token", { error });
    }
  }
}

export async function GET(request: Request) {
  await processUnsubscribeToken(request);
  return NextResponse.redirect(new URL("/feed?window=week&newsletter=unsubscribed", request.url));
}

export async function POST(request: Request) {
  await processUnsubscribeToken(request);
  return new NextResponse("Unsubscribed", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
