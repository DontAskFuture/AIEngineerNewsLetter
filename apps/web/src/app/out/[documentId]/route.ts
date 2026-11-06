import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ai-intel/db";
import { getCurrentUser } from "@/lib/auth";
import { markDocumentRead } from "@/lib/read-tracking";

interface OutboundDocumentRouteProps {
  params: Promise<{
    documentId: string;
  }>;
}

export async function GET(request: Request, { params }: OutboundDocumentRouteProps) {
  const { documentId } = await params;
  const parsedDocumentId = Number(documentId);

  if (!Number.isInteger(parsedDocumentId) || parsedDocumentId <= 0) {
    return NextResponse.redirect(new URL("/feed?window=week", request.url));
  }

  const db = getDb();
  const [currentUser, [document]] = await Promise.all([
    getCurrentUser(),
    db
      .select({
        id: schema.documents.id,
        canonicalUrl: schema.documents.canonicalUrl,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, parsedDocumentId))
      .limit(1),
  ]);

  if (!document) {
    return NextResponse.redirect(new URL("/feed?window=week", request.url));
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(document.canonicalUrl);
    if (
      (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") ||
      Boolean(targetUrl.username || targetUrl.password)
    ) {
      return NextResponse.redirect(new URL("/feed?window=week", request.url));
    }
  } catch {
    return NextResponse.redirect(new URL("/feed?window=week", request.url));
  }

  if (currentUser) {
    try {
      await markDocumentRead(currentUser.id, document.id);
    } catch (error) {
      console.error("Failed to mark document as read before redirect", {
        documentId: document.id,
        userId: currentUser.id,
        error,
      });
    }
  }

  return NextResponse.redirect(targetUrl, {
    headers: {
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
