import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/operations";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbHealth = await checkDatabaseHealth();
  return NextResponse.json(
    {
      status: dbHealth.ok ? "ok" : "degraded",
      database: dbHealth.ok ? "up" : "down",
      latencyMs: dbHealth.latencyMs,
      timestamp: new Date().toISOString(),
    },
    {
      status: dbHealth.ok ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
