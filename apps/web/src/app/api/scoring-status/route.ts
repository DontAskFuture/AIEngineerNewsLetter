import { NextResponse } from "next/server";
import { getScoringJobState, getScoringJobHistory } from "@/lib/scoring-tracker";

export const dynamic = "force-dynamic";

export async function GET() {
  const [current, history] = await Promise.all([
    getScoringJobState(),
    getScoringJobHistory(),
  ]);

  return NextResponse.json({ current, history });
}
