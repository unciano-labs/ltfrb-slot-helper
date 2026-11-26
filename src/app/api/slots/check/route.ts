import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { assertUserCanManageAutomation } from "@/lib/monitor/entitlements";
import { runSlotMonitorSync } from "@/lib/monitor/sync-slots";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MANUAL_CHECK_MIN_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json(
      { error: "Please sign in first to run a personal slot check and email alert." },
      { status: 401 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          "Database settings are not connected yet. Add your Supabase environment keys first.",
      },
      { status: 400 }
    );
  }

  const gate = await assertUserCanManageAutomation(user.id, user.email);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  try {
    const { supabase, websiteId } = getTenantContext();
    const { data: recentRun } = await supabase
      .from("ltfrb_cron_runs")
      .select("started_at, status")
      .eq("website_id", websiteId)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRun?.started_at) {
      const elapsedMs = Date.now() - Date.parse(recentRun.started_at as string);
      if (!Number.isNaN(elapsedMs) && elapsedMs < MANUAL_CHECK_MIN_INTERVAL_MS) {
        const waitSeconds = Math.ceil((MANUAL_CHECK_MIN_INTERVAL_MS - elapsedMs) / 1000);
        return NextResponse.json({
          ok: true,
          rateLimited: true,
          message: `Slots were just checked recently. To protect your connection with LTFRB, please wait ${waitSeconds} seconds before checking again.`,
        });
      }
    }

    const summary = await runSlotMonitorSync("manual", user.id);
    return NextResponse.json({ ok: true, rateLimited: false, summary });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Manual check failed",
      },
      { status: 500 }
    );
  }
}
