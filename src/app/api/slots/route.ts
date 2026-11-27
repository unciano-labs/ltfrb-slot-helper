import { NextRequest, NextResponse } from "next/server";
import {
  loadDashboardData,
  loadSyncPulse,
  type SlotLoadMode,
} from "@/lib/monitor/dashboard-data";

export const dynamic = "force-dynamic";

function parseMode(raw: string | null): SlotLoadMode | "pulse" {
  if (raw === "pulse") return "pulse";
  if (raw === "cached" || raw === "live") return raw;
  return "auto";
}

export async function GET(request: NextRequest) {
  try {
    const mode = parseMode(request.nextUrl.searchParams.get("mode"));
    if (mode === "pulse") {
      const pulse = await loadSyncPulse();
      return NextResponse.json(pulse);
    }
    const payload = await loadDashboardData({ mode });
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not load slot availability from LTFRB.",
      },
      { status: 502 }
    );
  }
}
