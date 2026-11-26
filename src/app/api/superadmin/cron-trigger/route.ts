import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { runSlotMonitorSync } from "@/lib/monitor/sync-slots";
import { requireSuperAdmin } from "@/lib/security/superadmin";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const summary = await runSlotMonitorSync("manual");

  const { supabase, websiteId } = getTenantContext();
  await supabase.from("ltfrb_admin_audit_logs").insert({
    website_id: websiteId,
    admin_email: guard.user.email!,
    action: "manual_cron_trigger",
    details: {
      runId: summary.runId,
      recordsChecked: summary.recordsChecked,
      alertsSent: summary.alertsSent,
      reservationsAttempted: summary.reservationsAttempted.length,
    },
  });

  return NextResponse.json({ ok: true, summary });
}
