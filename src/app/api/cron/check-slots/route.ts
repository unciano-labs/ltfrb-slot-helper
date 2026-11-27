import { NextRequest, NextResponse } from "next/server";
import { runSlotMonitorSync } from "@/lib/monitor/sync-slots";
import { verifyCronBearerToken } from "@/lib/security/crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleCron(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!verifyCronBearerToken(authHeader)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runSlotMonitorSync("cron");
    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Cron check failed",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
