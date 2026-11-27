import { isSupabaseConfigured } from "@/lib/env";
import {
  fetchAllSlots,
  getCachedFranchiseTypesFromMemory,
} from "@/lib/ltfrb/client";
import type {
  ApplicationProfile,
  FranchiseType,
  SlotEntry,
  SubmissionLogRow,
  WatchRule,
} from "@/lib/ltfrb/types";
import { loadUserBillingState } from "@/lib/monitor/entitlements";
import {
  resolveUserEntitlements,
  type PaymentQrCodeRow,
  type PaymentRequestRow,
  type UserEntitlements,
} from "@/lib/monitor/monetization";
import {
  deriveMovementsFromSnapshots,
  type SlotMovementEvent,
  type SnapshotHistoryRow,
} from "@/lib/monitor/slot-analytics";
import { normalizeSubmissionLogRow } from "@/lib/monitor/submission-trigger";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const SNAPSHOT_CACHE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes (matches cron interval)

export type SlotLoadMode = "cached" | "auto" | "live";

export interface SavedAccountSummary {
  id: string;
  account_type: "operator" | "tnc";
  ltfrb_email: string;
  last_verified_at: string | null;
}

export interface CronRunSummary {
  id: string;
  trigger_source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_checked: number;
  alerts_sent: number;
  error_message: string | null;
}

export interface NotificationLogSummary {
  id: string;
  slot_key: string;
  recipient: string;
  subject: string;
  remaining_at_alert: number;
  status: string;
  sent_at: string;
}

export interface DashboardPayload {
  fetchedAt: string;
  servedFromCache: boolean;
  isStale: boolean;
  supabaseConfigured: boolean;
  user: { id: string; email: string | null } | null;
  savedAccount: SavedAccountSummary | null;
  monitoredFranchiseCodes: string[];
  entitlements: UserEntitlements;
  qrCodes: PaymentQrCodeRow[];
  paymentRequests: PaymentRequestRow[];
  billingSchemaReady: boolean;
  franchiseTypes: FranchiseType[];
  regionSlots: SlotEntry[];
  provinceSlots: SlotEntry[];
  lastRun: CronRunSummary | null;
  recentRuns: CronRunSummary[];
  slotEvents: SlotMovementEvent[];
  slotEventsSchemaReady: boolean;
  watchRules: WatchRule[];
  recentNotifications: NotificationLogSummary[];
  reservationProfiles: ApplicationProfile[];
  submissionLogs: SubmissionLogRow[];
}

function deriveFranchiseTypesFromSlots(slots: SlotEntry[]): FranchiseType[] {
  const byCode = new Map<string, string>();
  for (const slot of slots) {
    if (!byCode.has(slot.franchiseTypeCode)) {
      byCode.set(slot.franchiseTypeCode, slot.franchiseTypeName);
    }
  }
  return Array.from(byCode.entries())
    .map(([code, name]) => ({
      id: code,
      code,
      specialCode: null,
      name,
      maxSlots: null,
      minSlots: null,
      fleetMinSlots: null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function mapSnapshotRow(row: Record<string, unknown>): SlotEntry {
  return {
    scope: row.scope as "region" | "province",
    slotKey: row.slot_key as string,
    franchiseTypeCode: row.franchise_type_code as string,
    franchiseTypeName: row.franchise_type_name as string,
    regionCode: (row.region_code as string) ?? "",
    regionName: (row.region_name as string) ?? "",
    provinceCode: (row.province_code as string | null) ?? null,
    provinceName: (row.province_name as string | null) ?? null,
    totalSlots: Number(row.total_slots ?? 0),
    remaining: Number(row.remaining ?? 0),
    filedApplication: Number(row.filed_application ?? 0),
    percentage: Number(row.percentage ?? 0),
  };
}

/**
 * Loads authenticated user data, cached/live LTFRB slots, and monitor state in parallel.
 * In "cached" mode, never blocks on external ws.ltfrb-foa.ph calls when Supabase snapshots exist.
 */
export async function loadDashboardData(options?: {
  mode?: SlotLoadMode;
  knownUser?: { id: string; email: string | null } | null;
}): Promise<DashboardPayload> {
  const mode: SlotLoadMode = options?.mode ?? "auto";
  const supabaseReady = isSupabaseConfigured();

  let user: { id: string; email: string | null } | null = options?.knownUser ?? null;
  let savedAccount: SavedAccountSummary | null = null;
  let monitoredFranchiseCodes: string[] = [];
  let lastRun: CronRunSummary | null = null;
  let recentRuns: CronRunSummary[] = [];
  let slotEvents: SlotMovementEvent[] = [];
  let slotEventsSchemaReady = false;
  let watchRules: WatchRule[] = [];
  let recentNotifications: NotificationLogSummary[] = [];
  let reservationProfiles: ApplicationProfile[] = [];
  let submissionLogs: SubmissionLogRow[] = [];

  let regionSlots: SlotEntry[] = [];
  let provinceSlots: SlotEntry[] = [];
  let fetchedAt = new Date().toISOString();
  let servedFromCache = false;
  let isStale = true;
  let billingResult: {
    entitlements: UserEntitlements;
    qrCodes: PaymentQrCodeRow[];
    paymentRequests: PaymentRequestRow[];
    schemaReady: boolean;
  } | null = null;

  if (supabaseReady) {
    const { supabase, websiteId } = getTenantContext();

    // Phase 1: resolve user session, latest snapshot timestamp, and latest cron run in parallel
    const [authUser, latestSnapRes, lastRunRes] = await Promise.all([
      options?.knownUser !== undefined ? Promise.resolve(null) : getAuthenticatedUser(),
      mode === "live"
        ? Promise.resolve({ data: null })
        : supabase
            .from("ltfrb_slot_snapshots")
            .select("checked_at")
            .eq("website_id", websiteId)
            .order("checked_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
      supabase
        .from("ltfrb_cron_runs")
        .select("*")
        .eq("website_id", websiteId)
        .order("started_at", { ascending: false })
        .limit(40),
    ]);

    if (authUser) {
      user = { id: authUser.id, email: authUser.email ?? null };
    }
    recentRuns = (lastRunRes.data as CronRunSummary[] | null) ?? [];
    lastRun = recentRuns[0] ?? null;

    const latestCheckedAt = (latestSnapRes.data as { checked_at?: string } | null)?.checked_at;
    if (latestCheckedAt) {
      const ageMs = Date.now() - Date.parse(latestCheckedAt);
      isStale = Number.isNaN(ageMs) || ageMs >= SNAPSHOT_CACHE_MAX_AGE_MS;
    }

    // Phase 2: load cached snapshot rows AND all user-scoped tables + billing + slot events in parallel
    const [cachedRowsRes, userQueries, billingState, slotEventsRes] = await Promise.all([
      latestCheckedAt
        ? supabase
            .from("ltfrb_slot_snapshots")
            .select("*")
            .eq("website_id", websiteId)
            .eq("checked_at", latestCheckedAt)
        : Promise.resolve({ data: null }),
      user
        ? Promise.all([
            supabase
              .from("ltfrb_watch_rules")
              .select("*")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .order("created_at", { ascending: false }),
            supabase
              .from("ltfrb_notification_logs")
              .select("id, slot_key, recipient, subject, remaining_at_alert, status, sent_at")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .order("sent_at", { ascending: false })
              .limit(20),
            supabase
              .from("ltfrb_application_profiles")
              .select("*")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .order("created_at", { ascending: false }),
            supabase
              .from("ltfrb_submission_logs")
              .select("*")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .order("attempted_at", { ascending: false })
              .limit(40),
            supabase
              .from("ltfrb_user_preferences")
              .select("monitored_franchise_codes")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .maybeSingle(),
            supabase
              .from("ltfrb_accounts")
              .select("id, account_type, ltfrb_email, last_verified_at")
              .eq("website_id", websiteId)
              .eq("user_id", user.id)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ])
        : Promise.resolve(null),
      user ? loadUserBillingState(user.id, user.email) : Promise.resolve(null),
      supabase
        .from("ltfrb_slot_events")
        .select("*")
        .eq("website_id", websiteId)
        .order("occurred_at", { ascending: false })
        .limit(1000),
    ]);

    billingResult = billingState;

    const eventsMissing =
      slotEventsRes.error?.code === "42P01" || slotEventsRes.error?.code === "PGRST205";
    slotEventsSchemaReady = !eventsMissing;
    const rawEvents = !eventsMissing
      ? ((slotEventsRes.data as SlotMovementEvent[] | null) ?? [])
      : [];

    if (rawEvents.length > 0) {
      slotEvents = rawEvents;
    } else {
      // Fallback: derive historical slot movements directly from stored snapshots
      const { data: histRows } = await supabase
        .from("ltfrb_slot_snapshots")
        .select(
          "id, checked_at, scope, slot_key, franchise_type_code, franchise_type_name, region_code, region_name, province_code, province_name, remaining"
        )
        .eq("website_id", websiteId)
        .order("checked_at", { ascending: false })
        .limit(1500);
      slotEvents = deriveMovementsFromSnapshots((histRows as SnapshotHistoryRow[] | null) ?? []).slice(
        0,
        200
      );
    }

    const cachedRows = (cachedRowsRes.data as Array<Record<string, unknown>> | null) ?? [];
    if (latestCheckedAt && cachedRows.length > 0) {
      for (const row of cachedRows) {
        const entry = mapSnapshotRow(row);
        if (entry.scope === "region") regionSlots.push(entry);
        else provinceSlots.push(entry);
      }
      fetchedAt = latestCheckedAt;
      servedFromCache = true;
    }

    if (userQueries) {
      const [rulesRes, notifRes, profilesRes, logsRes, prefRes, acctRes] = userQueries;
      watchRules = (rulesRes.data as WatchRule[] | null) ?? [];
      recentNotifications = (notifRes.data as NotificationLogSummary[] | null) ?? [];
      reservationProfiles = (profilesRes.data as ApplicationProfile[] | null) ?? [];
      submissionLogs = ((logsRes.data as Array<Record<string, unknown>> | null) ?? []).map(
        normalizeSubmissionLogRow
      );
      monitoredFranchiseCodes =
        (prefRes.data?.monitored_franchise_codes as string[] | undefined) ?? [];
      savedAccount = (acctRes.data as SavedAccountSummary | null) ?? null;
    }
  } else {
    const authUser = await getAuthenticatedUser();
    if (authUser) {
      user = { id: authUser.id, email: authUser.email ?? null };
    }
  }

  let franchiseTypes = getCachedFranchiseTypesFromMemory() ?? [];
  const hasCachedSlots = regionSlots.length > 0 || provinceSlots.length > 0;

  const shouldFetchLive =
    mode === "live" || (mode === "auto" && (!hasCachedSlots || isStale));

  if (shouldFetchLive) {
    try {
      const live = await fetchAllSlots();
      franchiseTypes = live.franchiseTypes;
      regionSlots = live.regionSlots;
      provinceSlots = live.provinceSlots;
      fetchedAt = new Date().toISOString();
      servedFromCache = false;
      isStale = false;
    } catch (err) {
      // Preserve cached slots + authenticated user data if live LTFRB fetch fails
      if (!hasCachedSlots) {
        throw err;
      }
    }
  }

  const defaultEntitlements: UserEntitlements = resolveUserEntitlements({
    subscription: null,
    userEmail: user?.email ?? null,
    usedProfiles: reservationProfiles.length,
    usedAlerts: watchRules.length,
    monitoredCodesCount: monitoredFranchiseCodes.length,
  });

  if (franchiseTypes.length === 0 && (regionSlots.length > 0 || provinceSlots.length > 0)) {
    franchiseTypes = deriveFranchiseTypesFromSlots([...regionSlots, ...provinceSlots]);
  }

  return {
    fetchedAt,
    servedFromCache,
    isStale,
    supabaseConfigured: supabaseReady,
    user,
    savedAccount,
    monitoredFranchiseCodes,
    entitlements: billingResult?.entitlements ?? defaultEntitlements,
    qrCodes: billingResult?.qrCodes ?? [],
    paymentRequests: billingResult?.paymentRequests ?? [],
    billingSchemaReady: billingResult?.schemaReady ?? false,
    franchiseTypes,
    regionSlots,
    provinceSlots,
    lastRun,
    recentRuns,
    slotEvents,
    slotEventsSchemaReady,
    watchRules,
    recentNotifications,
    reservationProfiles,
    submissionLogs,
  };
}
