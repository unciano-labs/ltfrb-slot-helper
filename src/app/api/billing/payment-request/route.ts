import { NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { getUserEntitlements } from "@/lib/monitor/entitlements";
import {
  calculatePaymentOrder,
  SUPERADMIN_EMAIL,
} from "@/lib/monitor/monetization";
import { sendPaymentRequestAdminEmail } from "@/lib/notifications/email";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const { entitlements, schemaReady } = await getUserEntitlements(user.id, user.email);
  if (entitlements.isDisabled) {
    return NextResponse.json({ error: "Your account has been disabled." }, { status: 403 });
  }
  if (!schemaReady) {
    return NextResponse.json(
      { error: "Billing database tables are not created yet. Run migration 004 first." },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const referenceNumber = String(body.referenceNumber ?? "").trim();
  const senderName = String(body.senderName ?? "").trim() || null;
  const qrCodeId = body.qrCodeId ? String(body.qrCodeId).trim() : null;
  const receiptImageUrl = body.receiptImageUrl ? String(body.receiptImageUrl).trim() : null;
  const receiptStoragePath = body.receiptStoragePath
    ? String(body.receiptStoragePath).trim()
    : null;

  if (!referenceNumber) {
    return NextResponse.json(
      { error: "Please enter the GCash / Maya Reference Number from your receipt." },
      { status: 400 }
    );
  }

  const includesAnnualPlan =
    body.includesAnnualPlan !== undefined
      ? Boolean(body.includesAnnualPlan)
      : !entitlements.isActivePlan;

  const order = calculatePaymentOrder({
    includesAnnualPlan,
    extraProfiles: Number(body.extraProfiles ?? 0),
    extraAlerts: Number(body.extraAlerts ?? 0),
  });

  if (!order.valid) {
    return NextResponse.json({ error: order.error }, { status: 400 });
  }

  if (!entitlements.isActivePlan && !includesAnnualPlan) {
    return NextResponse.json(
      { error: "Please include the 1-Year Base Plan (₱1,699) first before purchasing add-ons." },
      { status: 400 }
    );
  }

  const { supabase, websiteId } = getTenantContext();
  const now = new Date().toISOString();
  const userEmail = user.email ?? "unknown@example.com";

  const { data: inserted, error: insertError } = await supabase
    .from("ltfrb_payment_requests")
    .insert({
      website_id: websiteId,
      user_id: user.id,
      user_email: userEmail,
      qr_code_id: qrCodeId,
      request_type: order.requestType,
      includes_annual_plan: includesAnnualPlan,
      requested_extra_profiles: order.extraProfiles,
      requested_extra_alerts: order.extraAlerts,
      expected_amount_php: order.expectedAmountPhp,
      reference_number: referenceNumber,
      sender_name: senderName,
      receipt_image_url: receiptImageUrl,
      receipt_storage_path: receiptStoragePath,
      status: "pending",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Ensure subscription row exists & mark pending if currently unpaid
  const { data: existingSub } = await supabase
    .from("ltfrb_subscriptions")
    .select("id, status")
    .eq("website_id", websiteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!existingSub) {
    await supabase.from("ltfrb_subscriptions").insert({
      website_id: websiteId,
      user_id: user.id,
      user_email: userEmail,
      plan_code: "free",
      status: "pending",
      created_at: now,
      updated_at: now,
    });
  } else if (existingSub.status === "unpaid" || existingSub.status === "expired") {
    await supabase
      .from("ltfrb_subscriptions")
      .update({ status: "pending", updated_at: now })
      .eq("id", existingSub.id)
      .eq("website_id", websiteId);
  }

  const parts: string[] = [];
  if (includesAnnualPlan) parts.push("1-Year Plan (₱1,699)");
  if (order.extraProfiles > 0) parts.push(`+${order.extraProfiles} Auto-Reserve Profile(s)`);
  if (order.extraAlerts > 0) parts.push(`+${order.extraAlerts} Alert Slot(s)`);

  await sendPaymentRequestAdminEmail({
    adminEmail: SUPERADMIN_EMAIL,
    payerEmail: userEmail,
    amountPhp: order.expectedAmountPhp,
    requestTypeLabel: parts.join(" + "),
    referenceNumber,
    senderName,
    submittedAtIso: now,
  });

  return NextResponse.json({
    ok: true,
    paymentRequest: inserted,
    message:
      "Payment proof submitted! SuperAdmin will review your GCash/Maya receipt and activate your plan shortly.",
  });
}
