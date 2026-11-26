import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  computeApprovedExpiryIso,
  isSuperAdminEmail,
  type SubscriptionRow,
} from "@/lib/monitor/monetization";
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
  const userId = String(body?.userId ?? "").trim();
  const userEmail = String(body?.userEmail ?? "").trim();
  const action = String(body?.action ?? "").trim();

  if (!userId || !action) {
    return NextResponse.json({ error: "userId and action are required." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();
  const now = new Date();
  const nowIso = now.toISOString();

  if (action === "reset_profile_locks") {
    await supabase
      .from("ltfrb_application_profiles")
      .update({ lock_status: "idle", updated_at: nowIso })
      .eq("website_id", websiteId)
      .eq("user_id", userId)
      .eq("lock_status", "submitting");

    await supabase.from("ltfrb_admin_audit_logs").insert({
      website_id: websiteId,
      admin_email: guard.user.email!,
      target_user_id: userId,
      target_user_email: userEmail || null,
      action: "reset_profile_locks",
      details: {},
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "disable" && isSuperAdminEmail(userEmail)) {
    return NextResponse.json(
      { error: "You cannot disable the SuperAdmin account." },
      { status: 400 }
    );
  }

  const { data: existing } = await supabase
    .from("ltfrb_subscriptions")
    .select("*")
    .eq("website_id", websiteId)
    .eq("user_id", userId)
    .maybeSingle();

  const existingSub = (existing as SubscriptionRow | null) ?? null;

  const baseRecord = {
    website_id: websiteId,
    user_id: userId,
    user_email: userEmail || existingSub?.user_email || "unknown@example.com",
    plan_code: existingSub?.plan_code ?? "free",
    status: existingSub?.status ?? "unpaid",
    is_disabled: existingSub?.is_disabled ?? false,
    disabled_reason: existingSub?.disabled_reason ?? null,
    base_auto_reserve_limit: existingSub?.base_auto_reserve_limit ?? 1,
    extra_auto_reserve_slots: existingSub?.extra_auto_reserve_slots ?? 0,
    base_alert_slot_limit: existingSub?.base_alert_slot_limit ?? 1,
    extra_alert_slots: existingSub?.extra_alert_slots ?? 0,
    starts_at: existingSub?.starts_at ?? null,
    expires_at: existingSub?.expires_at ?? null,
    updated_at: nowIso,
  };

  if (action === "disable") {
    baseRecord.is_disabled = true;
    baseRecord.disabled_reason = String(body?.reason ?? "").trim() || "Disabled by SuperAdmin";
  } else if (action === "enable") {
    baseRecord.is_disabled = false;
    baseRecord.disabled_reason = null;
  } else if (action === "grant_year") {
    baseRecord.plan_code = "annual_1699";
    baseRecord.status = "active";
    baseRecord.is_disabled = false;
    baseRecord.disabled_reason = null;
    baseRecord.starts_at = existingSub?.starts_at ?? nowIso;
    baseRecord.expires_at = computeApprovedExpiryIso(existingSub?.expires_at, now);
  } else if (action === "update_quotas") {
    baseRecord.extra_auto_reserve_slots = Math.max(
      0,
      Math.floor(Number(body?.extraAutoReserveSlots ?? baseRecord.extra_auto_reserve_slots) || 0)
    );
    baseRecord.extra_alert_slots = Math.max(
      0,
      Math.floor(Number(body?.extraAlertSlots ?? baseRecord.extra_alert_slots) || 0)
    );
  } else {
    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }

  const { data: saved, error: upsertError } = await supabase
    .from("ltfrb_subscriptions")
    .upsert(baseRecord, { onConflict: "website_id,user_id" })
    .select("*")
    .single();

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await supabase.from("ltfrb_admin_audit_logs").insert({
    website_id: websiteId,
    admin_email: guard.user.email!,
    target_user_id: userId,
    target_user_email: baseRecord.user_email,
    action,
    details: {
      extraAutoReserveSlots: baseRecord.extra_auto_reserve_slots,
      extraAlertSlots: baseRecord.extra_alert_slots,
      expiresAt: baseRecord.expires_at,
      disabledReason: baseRecord.disabled_reason,
    },
  });

  return NextResponse.json({ ok: true, subscription: saved });
}
