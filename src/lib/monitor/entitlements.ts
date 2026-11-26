import { isSupabaseConfigured } from "@/lib/env";
import {
  isSuperAdminEmail,
  resolveUserEntitlements,
  type PaymentQrCodeRow,
  type PaymentRequestRow,
  type SubscriptionRow,
  type UserEntitlements,
} from "@/lib/monitor/monetization";
import { getTenantContext } from "@/lib/supabase/server";

/**
 * Records this authenticated user in `ltfrb_subscriptions` for the current `website_id`
 * if no row exists yet, so multi-tenant SuperAdmin user lists stay scoped to this project.
 */
export async function ensureProjectUserRecord(
  userId: string,
  userEmail: string | null | undefined,
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
    mobile?: string | null;
  }
): Promise<void> {
  if (!isSupabaseConfigured() || !userId) return;
  try {
    const { supabase, websiteId } = getTenantContext();
    const isAdmin = isSuperAdminEmail(userEmail);
    const now = new Date().toISOString();

    const basePayload = {
      website_id: websiteId,
      user_id: userId,
      user_email: (userEmail ?? "unknown@example.com").trim(),
      plan_code: isAdmin ? "annual_1699" : "free",
      status: isAdmin ? "active" : "unpaid",
      created_at: now,
      updated_at: now,
    };

    const withProfile =
      profile?.firstName || profile?.lastName || profile?.mobile
        ? {
            ...basePayload,
            first_name: profile.firstName ?? null,
            last_name: profile.lastName ?? null,
            mobile: profile.mobile ?? null,
          }
        : basePayload;

    const { error } = await supabase.from("ltfrb_subscriptions").upsert(withProfile, {
      onConflict: "website_id,user_id",
      ignoreDuplicates: true,
    });

    // If migration 005 columns aren't applied yet, retry without them so user link still succeeds
    if (error && (error.message.includes("column") || error.code === "42703" || error.code === "PGRST204")) {
      await supabase.from("ltfrb_subscriptions").upsert(basePayload, {
        onConflict: "website_id,user_id",
        ignoreDuplicates: true,
      });
    }
  } catch {
    // Gracefully skip if migration 004 has not been applied yet
  }
}

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
  if (schemaReady && !sub) {
    void ensureProjectUserRecord(userId, userEmail);
  }
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
