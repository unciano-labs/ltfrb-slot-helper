import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import {
  isAuthUserInProject,
  resolveUserEntitlements,
  type AdminAuditLogRow,
  type PaymentQrCodeRow,
  type PaymentRequestRow,
  type SubscriptionRow,
} from "@/lib/monitor/monetization";
import { requireSuperAdmin } from "@/lib/security/superadmin";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function listAllAuthUsers(
  supabase: ReturnType<typeof getTenantContext>["supabase"]
): Promise<User[]> {
  const all: User[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    all.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return all;
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured yet." }, { status: 400 });
  }

  const { supabase, websiteId } = getTenantContext();

  const [
    allAuthUsers,
    subsRes,
    qrRes,
    paymentsRes,
    rulesRes,
    profilesRes,
    accountsRes,
    prefsRes,
    notifUsersRes,
    subLogsUsersRes,
    cronRes,
    auditRes,
  ] = await Promise.all([
    listAllAuthUsers(supabase),
    supabase
      .from("ltfrb_subscriptions")
      .select("*")
      .eq("website_id", websiteId)
      .order("updated_at", { ascending: false }),
    supabase
      .from("ltfrb_payment_qr_codes")
      .select("*")
      .eq("website_id", websiteId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("ltfrb_payment_requests")
      .select("*")
      .eq("website_id", websiteId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("ltfrb_watch_rules")
      .select("id, user_id, is_active")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_application_profiles")
      .select("id, user_id, lock_status, is_armed")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_accounts")
      .select("user_id, ltfrb_email, account_type")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_user_preferences")
      .select("user_id, monitored_franchise_codes")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_notification_logs")
      .select("user_id")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_submission_logs")
      .select("user_id")
      .eq("website_id", websiteId),
    supabase
      .from("ltfrb_cron_runs")
      .select("*")
      .eq("website_id", websiteId)
      .order("started_at", { ascending: false })
      .limit(15),
    supabase
      .from("ltfrb_admin_audit_logs")
      .select("*")
      .eq("website_id", websiteId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (subsRes.error?.code === "42P01" || subsRes.error?.code === "PGRST205") {
    return NextResponse.json({
      schemaReady: false,
      error: "Run supabase/migrations/004_monetization_superadmin.sql in Supabase SQL Editor first.",
    });
  }

  const projectUserIds = new Set<string>();
  const addUserId = (uid: unknown) => {
    if (typeof uid === "string" && uid.length > 0) {
      projectUserIds.add(uid);
    }
  };

  const subByUser = new Map<string, SubscriptionRow>();
  for (const row of (subsRes.data as SubscriptionRow[] | null) ?? []) {
    subByUser.set(row.user_id, row);
    addUserId(row.user_id);
  }

  for (const pay of paymentsRes.data ?? []) {
    addUserId(pay.user_id);
  }

  const rulesCountByUser = new Map<string, number>();
  for (const r of rulesRes.data ?? []) {
    const uid = r.user_id as string;
    addUserId(uid);
    rulesCountByUser.set(uid, (rulesCountByUser.get(uid) ?? 0) + 1);
  }

  const profileStatsByUser = new Map<
    string,
    { total: number; submitting: number; submitted: number; armed: number }
  >();
  for (const p of profilesRes.data ?? []) {
    const uid = p.user_id as string;
    addUserId(uid);
    const prev = profileStatsByUser.get(uid) ?? {
      total: 0,
      submitting: 0,
      submitted: 0,
      armed: 0,
    };
    prev.total += 1;
    if (p.lock_status === "submitting") prev.submitting += 1;
    if (p.lock_status === "submitted") prev.submitted += 1;
    if (p.is_armed) prev.armed += 1;
    profileStatsByUser.set(uid, prev);
  }

  const ltfrbByUser = new Map<string, { email: string; type: string }>();
  for (const a of accountsRes.data ?? []) {
    addUserId(a.user_id);
    ltfrbByUser.set(a.user_id as string, {
      email: a.ltfrb_email as string,
      type: a.account_type as string,
    });
  }

  const prefsByUser = new Map<string, string[]>();
  for (const pr of prefsRes.data ?? []) {
    addUserId(pr.user_id);
    prefsByUser.set(
      pr.user_id as string,
      (pr.monitored_franchise_codes as string[] | undefined) ?? []
    );
  }

  for (const n of notifUsersRes.data ?? []) {
    addUserId(n.user_id);
  }
  for (const s of subLogsUsersRes.data ?? []) {
    addUserId(s.user_id);
  }

  const projectUsers = allAuthUsers.filter((au) =>
    isAuthUserInProject({ user: au, websiteId, projectUserIds })
  );

  const mergedUsers = projectUsers.map((au) => {
    const sub = subByUser.get(au.id) ?? null;
    const profStats = profileStatsByUser.get(au.id) ?? {
      total: 0,
      submitting: 0,
      submitted: 0,
      armed: 0,
    };
    const usedAlerts = rulesCountByUser.get(au.id) ?? 0;
    const monitoredCodes = prefsByUser.get(au.id) ?? [];

    const entitlements = resolveUserEntitlements({
      subscription: sub,
      userEmail: au.email ?? sub?.user_email ?? null,
      usedProfiles: profStats.total,
      usedAlerts,
      monitoredCodesCount: monitoredCodes.length,
    });

    const meta = (au.user_metadata ?? {}) as Record<string, unknown>;
    const firstName =
      sub?.first_name ?? (typeof meta.first_name === "string" ? meta.first_name : null);
    const lastName =
      sub?.last_name ?? (typeof meta.last_name === "string" ? meta.last_name : null);
    const fullName =
      [firstName, lastName].filter(Boolean).join(" ").trim() ||
      (typeof meta.full_name === "string" ? meta.full_name : null);
    const mobile = sub?.mobile ?? (typeof meta.mobile === "string" ? meta.mobile : null);

    return {
      userId: au.id,
      email: au.email ?? sub?.user_email ?? "Unknown",
      firstName,
      lastName,
      fullName,
      mobile,
      createdAt: au.created_at,
      lastSignInAt: au.last_sign_in_at ?? null,
      emailConfirmedAt: au.email_confirmed_at ?? null,
      ltfrbAccount: ltfrbByUser.get(au.id) ?? null,
      monitoredCodes,
      profileStats: profStats,
      entitlements,
    };
  });

  const paymentRequests = (paymentsRes.data as PaymentRequestRow[] | null) ?? [];
  const qrCodes = (qrRes.data as PaymentQrCodeRow[] | null) ?? [];
  const auditLogs = (auditRes.data as AdminAuditLogRow[] | null) ?? [];

  const totalApprovedRevenuePhp = paymentRequests
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + Number(p.expected_amount_php ?? 0), 0);

  return NextResponse.json({
    schemaReady: true,
    adminEmail: guard.user.email,
    stats: {
      totalUsers: mergedUsers.length,
      activePaidUsers: mergedUsers.filter((u) => u.entitlements.isActivePlan && !u.entitlements.isSuperAdmin).length,
      pendingPayments: paymentRequests.filter((p) => p.status === "pending").length,
      disabledUsers: mergedUsers.filter((u) => u.entitlements.isDisabled).length,
      expiringSoonUsers: mergedUsers.filter(
        (u) =>
          u.entitlements.isActivePlan &&
          !u.entitlements.isSuperAdmin &&
          u.entitlements.daysRemaining > 0 &&
          u.entitlements.daysRemaining <= 30
      ).length,
      totalApprovedRevenuePhp,
    },
    users: mergedUsers,
    qrCodes,
    paymentRequests,
    cronRuns: cronRes.data ?? [],
    auditLogs,
  });
}
