import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { fetchAllSlots, fetchFranchiseTypes } from "@/lib/ltfrb/client";
import type { SlotEntry } from "@/lib/ltfrb/types";
import { getAuthenticatedUser } from "@/lib/supabase/auth-server";
import { getTenantContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SNAPSHOT_CACHE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const user = await getAuthenticatedUser();

    let lastRun = null;
    let watchRules = [];
    let recentNotifications = [];
    let reservationProfiles = [];
    let submissionLogs = [];
    let monitoredFranchiseCodes: string[] = [];

    let regionSlots: SlotEntry[] = [];
    let provinceSlots: SlotEntry[] = [];
    let fetchedAt = new Date().toISOString();
    let servedFromCache = false;

    const franchiseTypes = await fetchFranchiseTypes();

    if (isSupabaseConfigured()) {
      const { supabase, websiteId } = getTenantContext();

      // Check latest cached snapshot to avoid hammering LTFRB on UI page reloads
      const { data: latestSnap } = await supabase
        .from("ltfrb_slot_snapshots")
        .select("checked_at")
        .eq("website_id", websiteId)
        .order("checked_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestSnap?.checked_at) {
        const ageMs = Date.now() - Date.parse(latestSnap.checked_at as string);
        if (!Number.isNaN(ageMs) && ageMs < SNAPSHOT_CACHE_MAX_AGE_MS) {
          const { data: cachedRows } = await supabase
            .from("ltfrb_slot_snapshots")
            .select("*")
            .eq("website_id", websiteId)
            .eq("checked_at", latestSnap.checked_at as string);

          if (cachedRows && cachedRows.length > 0) {
            for (const row of cachedRows) {
              const entry: SlotEntry = {
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
              if (entry.scope === "region") regionSlots.push(entry);
              else provinceSlots.push(entry);
            }
            fetchedAt = latestSnap.checked_at as string;
            servedFromCache = true;
          }
        }
      }

      const { data: runData } = await supabase
        .from("ltfrb_cron_runs")
        .select("*")
        .eq("website_id", websiteId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      lastRun = runData ?? null;

      if (user) {
        const [rulesRes, notifRes, profilesRes, logsRes, prefRes] = await Promise.all([
          supabase
            .from("ltfrb_watch_rules")
            .select("*")
            .eq("website_id", websiteId)
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("ltfrb_notification_logs")
            .select("*")
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
            .limit(20),
          supabase
            .from("ltfrb_user_preferences")
            .select("monitored_franchise_codes")
            .eq("website_id", websiteId)
            .eq("user_id", user.id)
            .maybeSingle(),
        ]);

        watchRules = rulesRes.data ?? [];
        recentNotifications = notifRes.data ?? [];
        reservationProfiles = profilesRes.data ?? [];
        submissionLogs = logsRes.data ?? [];
        monitoredFranchiseCodes =
          (prefRes.data?.monitored_franchise_codes as string[] | undefined) ?? [];
      }
    }

    if (!servedFromCache) {
      const live = await fetchAllSlots();
      regionSlots = live.regionSlots;
      provinceSlots = live.provinceSlots;
      fetchedAt = new Date().toISOString();
    }

    return NextResponse.json({
      fetchedAt,
      servedFromCache,
      supabaseConfigured: isSupabaseConfigured(),
      user: user ? { id: user.id, email: user.email ?? null } : null,
      monitoredFranchiseCodes,
      franchiseTypes,
      regionSlots,
      provinceSlots,
      lastRun,
      watchRules,
      recentNotifications,
      reservationProfiles,
      submissionLogs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not load slot availability from LTFRB.",
      },
      { status: 502 }
    );
  }
}
