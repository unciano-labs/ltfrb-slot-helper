import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  computeApprovedExpiryIso,
  type PaymentRequestRow,
  type SubscriptionRow,
} from "@/lib/monitor/monetization";
import { sendPaymentDecisionUserEmail } from "@/lib/notifications/email";
import { requireSuperAdmin } from "@/lib/security/superadmin";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = String(body?.requestId ?? "").trim();
  const action = body?.action === "reject" ? "reject" : body?.action === "approve" ? "approve" : null;
  const rejectionReason = String(body?.rejectionReason ?? "").trim() || null;

  if (!requestId || !action) {
    return NextResponse.json(
      { error: "Request ID and valid action (approve or reject) are required." },
      { status: 400 }
    );
  }

  const { supabase, websiteId } = getTenantContext();
  const now = new Date();
  const nowIso = now.toISOString();

  // Atomically claim pending payment request
  const { data: claimed, error: claimError } = await supabase
    .from("ltfrb_payment_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by_email: guard.user.email!,
      reviewed_at: nowIso,
      rejection_reason: action === "reject" ? rejectionReason : null,
      updated_at: nowIso,
    })
    .eq("id", requestId)
    .eq("website_id", websiteId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 });
  }

  if (!claimed) {
    return NextResponse.json(
      { error: "This payment request was already processed or not found." },
      { status: 409 }
    );
  }

  const reqRow = claimed as PaymentRequestRow;

  const { data: existingSub } = await supabase
    .from("ltfrb_subscriptions")
    .select("*")
    .eq("website_id", websiteId)
    .eq("user_id", reqRow.user_id)
    .maybeSingle();

  const subRow = (existingSub as SubscriptionRow | null) ?? null;
  let nextExpiresAt: string | null = subRow?.expires_at ?? null;

  if (action === "approve") {
    if (reqRow.includes_annual_plan) {
      nextExpiresAt = computeApprovedExpiryIso(subRow?.expires_at, now);
    }

    const nextExtraProfiles =
      Number(subRow?.extra_auto_reserve_slots ?? 0) + Number(reqRow.requested_extra_profiles ?? 0);
    const nextExtraAlerts =
      Number(subRow?.extra_alert_slots ?? 0) + Number(reqRow.requested_extra_alerts ?? 0);

    await supabase.from("ltfrb_subscriptions").upsert(
      {
        website_id: websiteId,
        user_id: reqRow.user_id,
        user_email: reqRow.user_email,
        plan_code:
          reqRow.includes_annual_plan || subRow?.plan_code === "annual_1699"
            ? "annual_1699"
            : "free",
        status:
          reqRow.includes_annual_plan || subRow?.status === "active"
            ? "active"
            : subRow?.status ?? "unpaid",
        is_disabled: subRow?.is_disabled ?? false,
        base_auto_reserve_limit: subRow?.base_auto_reserve_limit ?? 1,
        extra_auto_reserve_slots: nextExtraProfiles,
        base_alert_slot_limit: subRow?.base_alert_slot_limit ?? 1,
        extra_alert_slots: nextExtraAlerts,
        starts_at: subRow?.starts_at ?? nowIso,
        expires_at: nextExpiresAt,
        updated_at: nowIso,
      },
      { onConflict: "website_id,user_id" }
    );
  } else if (subRow && subRow.status === "pending") {
    await supabase
      .from("ltfrb_subscriptions")
      .update({ status: "unpaid", updated_at: nowIso })
      .eq("id", subRow.id)
      .eq("website_id", websiteId);
  }

  await supabase.from("ltfrb_admin_audit_logs").insert({
    website_id: websiteId,
    admin_email: guard.user.email!,
    target_user_id: reqRow.user_id,
    target_user_email: reqRow.user_email,
    action: action === "approve" ? "approve_payment" : "reject_payment",
    details: {
      requestId: reqRow.id,
      amountPhp: reqRow.expected_amount_php,
      includesAnnualPlan: reqRow.includes_annual_plan,
      extraProfiles: reqRow.requested_extra_profiles,
      extraAlerts: reqRow.requested_extra_alerts,
      rejectionReason,
    },
  });

  const parts: string[] = [];
  if (reqRow.includes_annual_plan) parts.push("1-Year Plan (₱1,699)");
  if (reqRow.requested_extra_profiles > 0) {
    parts.push(`+${reqRow.requested_extra_profiles} Auto-Reserve Profile(s)`);
  }
  if (reqRow.requested_extra_alerts > 0) {
    parts.push(`+${reqRow.requested_extra_alerts} Alert Slot(s)`);
  }

  await sendPaymentDecisionUserEmail({
    to: reqRow.user_email,
    approved: action === "approve",
    amountPhp: reqRow.expected_amount_php,
    requestTypeLabel: parts.join(" + "),
    expiresAtIso: nextExpiresAt,
    rejectionReason,
  });

  return NextResponse.json({ ok: true, status: reqRow.status });
}
