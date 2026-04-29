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
  const currentUser = await getCurrentUser();
  const { documentId } = await params;
  const parsedDocumentId = Number(documentId);

  if (!Number.isInteger(parsedDocumentId)) {
    return NextResponse.redirect(new URL("/feed?window=week", request.url));
  }

  const db = getDb();
  const [document] = await db
    .select({
      id: schema.documents.id,
      canonicalUrl: schema.documents.canonicalUrl,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, parsedDocumentId))
    .limit(1);

  if (!document) {
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

  return NextResponse.redirect(document.canonicalUrl);
}
