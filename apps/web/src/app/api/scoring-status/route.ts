import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getScoringJobState, getScoringJobHistory } from "@/lib/scoring-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [current, history] = await Promise.all([
    getScoringJobState(),
    getScoringJobHistory(),
  ]);

  return NextResponse.json({ current, history });
}
