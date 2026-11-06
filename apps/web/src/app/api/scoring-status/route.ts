import { NextResponse } from "next/server";
import { getAuthenticatedAdmin } from "@/lib/auth";
import { getScoringJobState, getScoringJobHistory } from "@/lib/scoring-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user, isAuthorized } = await getAuthenticatedAdmin();
  if (!user || !isAuthorized) {
    return NextResponse.json(
      { error: !user ? "Unauthorized" : "Forbidden" },
      { status: !user ? 401 : 403 },
    );
  }

  const [current, history] = await Promise.all([
    getScoringJobState(),
    getScoringJobHistory(),
  ]);

  return NextResponse.json({ current, history });
}
