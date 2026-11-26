import {
  resolveUserEntitlements,
  type PaymentQrCodeRow,
  type PaymentRequestRow,
  type SubscriptionRow,
  type UserEntitlements,
} from "@/lib/monitor/monetization";
import { getTenantContext } from "@/lib/supabase/server";

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/**
 * Loads subscription status, QR options, user payment requests, and quota entitlements.
 * Gracefully degrades if migration 004 has not been applied yet.
 */
export async function loadUserBillingState(
  userId: string,
  userEmail: string | null | undefined
): Promise<{
  entitlements: UserEntitlements;
  qrCodes: PaymentQrCodeRow[];
  paymentRequests: PaymentRequestRow[];
  schemaReady: boolean;
}> {
  const { supabase, websiteId } = getTenantContext();

  const [subRes, qrRes, reqRes, profilesCountRes, rulesCountRes, prefRes] = await Promise.all([
    supabase
      .from("ltfrb_subscriptions")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("ltfrb_payment_qr_codes")
      .select("*")
      .eq("website_id", websiteId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("ltfrb_payment_requests")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ltfrb_application_profiles")
      .select("id", { count: "exact", head: true })
      .eq("website_id", websiteId)
      .eq("user_id", userId),
    supabase
      .from("ltfrb_watch_rules")
      .select("id", { count: "exact", head: true })
      .eq("website_id", websiteId)
      .eq("user_id", userId),
    supabase
      .from("ltfrb_user_preferences")
      .select("monitored_franchise_codes")
      .eq("website_id", websiteId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  const schemaReady = !isMissingTableError(subRes.error);
  const sub = schemaReady ? ((subRes.data as SubscriptionRow | null) ?? null) : null;
  const qrCodes = !isMissingTableError(qrRes.error)
    ? ((qrRes.data as PaymentQrCodeRow[] | null) ?? [])
    : [];
  const paymentRequests = !isMissingTableError(reqRes.error)
    ? ((reqRes.data as PaymentRequestRow[] | null) ?? [])
    : [];

  const monitoredCodes = (prefRes.data?.monitored_franchise_codes as string[] | undefined) ?? [];

  const entitlements = resolveUserEntitlements({
    subscription: sub,
    userEmail,
    usedProfiles: profilesCountRes.count ?? 0,
    usedAlerts: rulesCountRes.count ?? 0,
    monitoredCodesCount: monitoredCodes.length,
  });

  return { entitlements, qrCodes, paymentRequests, schemaReady };
}

export async function getUserEntitlements(
  userId: string,
  userEmail: string | null | undefined
): Promise<{ entitlements: UserEntitlements; schemaReady: boolean }> {
  const { entitlements, schemaReady } = await loadUserBillingState(userId, userEmail);
  return { entitlements, schemaReady };
}

export async function assertUserCanManageAutomation(
  userId: string,
  userEmail: string | null | undefined
): Promise<
  | { ok: true; entitlements: UserEntitlements }
  | { ok: false; status: number; error: string; entitlements: UserEntitlements }
> {
  const { entitlements, schemaReady } = await getUserEntitlements(userId, userEmail);

  if (entitlements.isDisabled) {
    return {
      ok: false,
      status: 403,
      error: entitlements.disabledReason
        ? `Your account has been disabled: ${entitlements.disabledReason}`
        : "Your account has been disabled by the administrator. Please contact support.",
      entitlements,
    };
  }

  // Allow existing functionality if migration 004 has not been applied yet
  if (!schemaReady) {
    return { ok: true, entitlements };
  }

  if (!entitlements.isActivePlan) {
    return {
      ok: false,
      status: 403,
      error:
        "Your 1-Year Plan (₱1,699) is not active yet. Please submit your GCash or Maya QR payment under 'Plan & Billing' first.",
      entitlements,
    };
  }

  return { ok: true, entitlements };
}
