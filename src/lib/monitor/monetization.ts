import type { SupabaseClient } from "@supabase/supabase-js";

export const SUPERADMIN_EMAIL = "webcareer1@gmail.com";
export const ANNUAL_PLAN_PRICE_PHP = 1699;
export const ADDON_PROFILE_PRICE_PHP = 100;
export const ADDON_ALERT_PRICE_PHP = 100;
export const ANNUAL_PLAN_DAYS = 365;

export const QR_STORAGE_BUCKET = "ltfrb-qr-codes";
export const RECEIPT_STORAGE_BUCKET = "ltfrb-payment-receipts";

export type SubscriptionPlanCode = "free" | "annual_1699";
export type SubscriptionStatus = "unpaid" | "pending" | "active" | "expired";
export type PaymentProvider = "gcash" | "maya" | "other";
export type PaymentRequestType = "annual_plan" | "addon" | "bundle";
export type PaymentRequestStatus = "pending" | "approved" | "rejected";

export interface SubscriptionRow {
  id: string;
  website_id: string;
  user_id: string;
  user_email: string;
  plan_code: SubscriptionPlanCode;
  status: SubscriptionStatus;
  is_disabled: boolean;
  disabled_reason: string | null;
  base_auto_reserve_limit: number;
  extra_auto_reserve_slots: number;
  base_alert_slot_limit: number;
  extra_alert_slots: number;
  starts_at: string | null;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentQrCodeRow {
  id: string;
  website_id: string;
  provider: PaymentProvider;
  title: string;
  description: string;
  image_url: string;
  storage_path: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentRequestRow {
  id: string;
  website_id: string;
  user_id: string;
  user_email: string;
  qr_code_id: string | null;
  request_type: PaymentRequestType;
  includes_annual_plan: boolean;
  requested_extra_profiles: number;
  requested_extra_alerts: number;
  expected_amount_php: number;
  reference_number: string;
  sender_name: string | null;
  receipt_image_url: string | null;
  receipt_storage_path: string | null;
  status: PaymentRequestStatus;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAuditLogRow {
  id: string;
  website_id: string;
  admin_email: string;
  target_user_id: string | null;
  target_user_email: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface UserEntitlements {
  isSuperAdmin: boolean;
  isActivePlan: boolean;
  isDisabled: boolean;
  disabledReason: string | null;
  planCode: SubscriptionPlanCode;
  status: SubscriptionStatus;
  startsAt: string | null;
  expiresAt: string | null;
  daysRemaining: number;
  maxAutoReserveProfiles: number;
  maxAlertSlots: number;
  extraAutoReserveSlots: number;
  extraAlertSlots: number;
  usedProfiles: number;
  usedAlerts: number;
  monitoredCodesCount: number;
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() === SUPERADMIN_EMAIL;
}

export function calculatePaymentOrder(input: {
  includesAnnualPlan: boolean;
  extraProfiles: number;
  extraAlerts: number;
}): {
  valid: boolean;
  error?: string;
  requestType: PaymentRequestType;
  expectedAmountPhp: number;
  extraProfiles: number;
  extraAlerts: number;
} {
  const extraProfiles = Math.max(0, Math.floor(Number(input.extraProfiles) || 0));
  const extraAlerts = Math.max(0, Math.floor(Number(input.extraAlerts) || 0));
  const includesAnnualPlan = Boolean(input.includesAnnualPlan);

  if (!includesAnnualPlan && extraProfiles === 0 && extraAlerts === 0) {
    return {
      valid: false,
      error: "Please select the 1-Year Plan or at least 1 add-on before submitting payment.",
      requestType: "addon",
      expectedAmountPhp: 0,
      extraProfiles: 0,
      extraAlerts: 0,
    };
  }

  if (extraProfiles > 50 || extraAlerts > 50) {
    return {
      valid: false,
      error: "Please limit add-on quantities to 50 per request.",
      requestType: "addon",
      expectedAmountPhp: 0,
      extraProfiles,
      extraAlerts,
    };
  }

  const expectedAmountPhp =
    (includesAnnualPlan ? ANNUAL_PLAN_PRICE_PHP : 0) +
    extraProfiles * ADDON_PROFILE_PRICE_PHP +
    extraAlerts * ADDON_ALERT_PRICE_PHP;

  const requestType: PaymentRequestType =
    includesAnnualPlan && (extraProfiles > 0 || extraAlerts > 0)
      ? "bundle"
      : includesAnnualPlan
      ? "annual_plan"
      : "addon";

  return {
    valid: true,
    requestType,
    expectedAmountPhp,
    extraProfiles,
    extraAlerts,
  };
}

export function computeApprovedExpiryIso(
  currentExpiresAt: string | null | undefined,
  now: Date = new Date()
): string {
  const nowMs = now.getTime();
  const parsed = currentExpiresAt ? Date.parse(currentExpiresAt) : NaN;
  const baseMs = !Number.isNaN(parsed) && parsed > nowMs ? parsed : nowMs;
  const next = new Date(baseMs + ANNUAL_PLAN_DAYS * 24 * 60 * 60 * 1000);
  return next.toISOString();
}

export function resolveUserEntitlements(params: {
  subscription: SubscriptionRow | null;
  userEmail: string | null | undefined;
  usedProfiles: number;
  usedAlerts: number;
  monitoredCodesCount: number;
  now?: Date;
}): UserEntitlements {
  const now = params.now ?? new Date();
  const nowMs = now.getTime();
  const isSuperAdmin = isSuperAdminEmail(params.userEmail);
  const sub = params.subscription;

  if (isSuperAdmin && !sub) {
    return {
      isSuperAdmin: true,
      isActivePlan: true,
      isDisabled: false,
      disabledReason: null,
      planCode: "annual_1699",
      status: "active",
      startsAt: now.toISOString(),
      expiresAt: null,
      daysRemaining: 365,
      maxAutoReserveProfiles: 20,
      maxAlertSlots: 20,
      extraAutoReserveSlots: 19,
      extraAlertSlots: 19,
      usedProfiles: params.usedProfiles,
      usedAlerts: params.usedAlerts,
      monitoredCodesCount: params.monitoredCodesCount,
    };
  }

  const isDisabled = !isSuperAdmin && Boolean(sub?.is_disabled);
  const expiresAt = sub?.expires_at ?? null;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const isExpiredByDate = !Number.isNaN(expiresMs) && expiresMs <= nowMs;

  let status: SubscriptionStatus = sub?.status ?? "unpaid";
  if (status === "active" && isExpiredByDate) {
    status = "expired";
  }

  const isActivePlan =
    !isDisabled &&
    (isSuperAdmin || (status === "active" && (!expiresAt || (!Number.isNaN(expiresMs) && expiresMs > nowMs))));

  const extraAutoReserveSlots = Math.max(0, Number(sub?.extra_auto_reserve_slots ?? 0));
  const extraAlertSlots = Math.max(0, Number(sub?.extra_alert_slots ?? 0));
  const baseProfiles = Math.max(1, Number(sub?.base_auto_reserve_limit ?? 1));
  const baseAlerts = Math.max(1, Number(sub?.base_alert_slot_limit ?? 1));

  const daysRemaining =
    !Number.isNaN(expiresMs) && expiresMs > nowMs
      ? Math.max(1, Math.ceil((expiresMs - nowMs) / (24 * 60 * 60 * 1000)))
      : 0;

  return {
    isSuperAdmin,
    isActivePlan,
    isDisabled,
    disabledReason: sub?.disabled_reason ?? null,
    planCode: sub?.plan_code ?? "free",
    status,
    startsAt: sub?.starts_at ?? null,
    expiresAt,
    daysRemaining,
    maxAutoReserveProfiles: isSuperAdmin
      ? Math.max(20, baseProfiles + extraAutoReserveSlots)
      : baseProfiles + extraAutoReserveSlots,
    maxAlertSlots: isSuperAdmin
      ? Math.max(20, baseAlerts + extraAlertSlots)
      : baseAlerts + extraAlertSlots,
    extraAutoReserveSlots,
    extraAlertSlots,
    usedProfiles: params.usedProfiles,
    usedAlerts: params.usedAlerts,
    monitoredCodesCount: params.monitoredCodesCount,
  };
}

/**
 * Ensures the given Supabase Storage bucket exists so uploads succeed seamlessly.
 */
export async function ensureStorageBucket(
  supabase: SupabaseClient,
  bucketName: string,
  isPublic = true
): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === bucketName);
  if (!exists) {
    await supabase.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    });
  }
}
