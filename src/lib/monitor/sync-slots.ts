import { fetchAllSlots } from "@/lib/ltfrb/client";
import { attemptSlotReservation, type ReservationAttemptSummary } from "@/lib/ltfrb/reservation";
import type {
  AlertSlotMatch,
  ApplicationProfile,
  SlotEntry,
  WatchRule,
} from "@/lib/ltfrb/types";
import {
  resolveUserEntitlements,
  type SubscriptionRow,
} from "@/lib/monitor/monetization";
import { isFranchiseAllowedForAccount } from "@/lib/monitor/preferences";
import {
  evaluateAlertDecision,
  matchesWatchRule,
  shouldAutoSubmitProfile,
} from "@/lib/monitor/rules";
import { detectSlotMovements } from "@/lib/monitor/slot-analytics";
import { sendSlotAvailableEmail } from "@/lib/notifications/email";
import { getTenantContext } from "@/lib/supabase/server";

export interface SyncRunSummary {
  runId: string;
  checkedAt: string;
  recordsChecked: number;
  rulesEvaluated: number;
  rulesMatched: number;
  alertsSent: number;
  reservationsAttempted: ReservationAttemptSummary[];
  openMatches: Array<{
    ruleId: string;
    ruleLabel: string;
    entries: SlotEntry[];
    alertStatus: "sent" | "skipped" | "failed";
    alertReason: string;
  }>;
}

export async function runSlotMonitorSync(
  triggerSource: "cron" | "manual",
  onlyUserId?: string
): Promise<SyncRunSummary> {
  const { supabase, websiteId } = getTenantContext();
  const checkedAt = new Date().toISOString();

  const { data: runRow, error: runInsertError } = await supabase
    .from("ltfrb_cron_runs")
    .insert({
      website_id: websiteId,
      trigger_source: triggerSource,
      started_at: checkedAt,
      status: "running",
    })
    .select("id")
    .single();

  if (runInsertError || !runRow) {
    throw new Error(`Failed to start cron run log: ${runInsertError?.message ?? "unknown"}`);
  }

  const runId = runRow.id as string;

  try {
    const { regionSlots, provinceSlots } = await fetchAllSlots();
    const allSlots = [...regionSlots, ...provinceSlots];

    // Fetch previous latest remaining counts per slot_key
    const { data: prevRows } = await supabase
      .from("ltfrb_slot_snapshots")
      .select("slot_key, remaining, checked_at")
      .eq("website_id", websiteId)
      .order("checked_at", { ascending: false })
      .limit(allSlots.length * 2);

    const prevMap = new Map<string, number>();
    for (const row of prevRows ?? []) {
      const key = row.slot_key as string;
      if (!prevMap.has(key)) {
        prevMap.set(key, Number(row.remaining ?? 0));
      }
    }

    // Persist current snapshot batch
    if (allSlots.length > 0) {
      const snapshotPayload = allSlots.map((slot) => ({
        website_id: websiteId,
        checked_at: checkedAt,
        scope: slot.scope,
        slot_key: slot.slotKey,
        franchise_type_code: slot.franchiseTypeCode,
        franchise_type_name: slot.franchiseTypeName,
        region_code: slot.regionCode,
        region_name: slot.regionName,
        province_code: slot.provinceCode,
        province_name: slot.provinceName,
        total_slots: slot.totalSlots,
        remaining: slot.remaining,
        filed_application: slot.filedApplication,
        percentage: slot.percentage,
      }));

      const { error: snapError } = await supabase
        .from("ltfrb_slot_snapshots")
        .insert(snapshotPayload);

      if (snapError) {
        throw new Error(`Failed to store slot snapshots: ${snapError.message}`);
      }

      const movements = detectSlotMovements({
        websiteId,
        allSlots,
        prevRemainingMap: prevMap,
        occurredAt: checkedAt,
      });

      if (movements.length > 0) {
        await supabase.from("ltfrb_slot_events").insert(movements);
      }
    }

    // Load per-user monitored franchise preferences (up to 2 per account)
    let prefQuery = supabase
      .from("ltfrb_user_preferences")
      .select("user_id, monitored_franchise_codes")
      .eq("website_id", websiteId);

    if (onlyUserId) {
      prefQuery = prefQuery.eq("user_id", onlyUserId);
    }

    const { data: prefRows } = await prefQuery;
    const userMonitoredMap = new Map<string, string[]>();
    for (const pref of prefRows ?? []) {
      userMonitoredMap.set(
        pref.user_id as string,
        (pref.monitored_franchise_codes as string[] | undefined) ?? []
      );
    }

    // Load subscription status for active / non-disabled gating in cron
    let subQuery = supabase
      .from("ltfrb_subscriptions")
      .select("*")
      .eq("website_id", websiteId);

    if (onlyUserId) {
      subQuery = subQuery.eq("user_id", onlyUserId);
    }

    const { data: subRows, error: subError } = await subQuery;
    const subscriptionSchemaReady =
      !subError || (subError.code !== "42P01" && subError.code !== "PGRST205");
    const subByUser = new Map<string, SubscriptionRow>();
    for (const row of (subRows as SubscriptionRow[] | null) ?? []) {
      subByUser.set(row.user_id, row);
    }

    const isUserEntitled = (userId: string): { allowed: boolean; maxAlertSlots: number } => {
      if (!subscriptionSchemaReady) {
        return { allowed: true, maxAlertSlots: 2 };
      }
      const sub = subByUser.get(userId) ?? null;
      const ent = resolveUserEntitlements({
        subscription: sub,
        userEmail: sub?.user_email ?? null,
        usedProfiles: 0,
        usedAlerts: 0,
        monitoredCodesCount: 0,
      });
      return {
        allowed: ent.isActivePlan && !ent.isDisabled,
        maxAlertSlots: ent.maxAlertSlots,
      };
    };

    // Load active watch rules for this website_id (optionally scoped to one user on manual check)
    let rulesQuery = supabase
      .from("ltfrb_watch_rules")
      .select("*")
      .eq("website_id", websiteId)
      .eq("is_active", true);

    if (onlyUserId) {
      rulesQuery = rulesQuery.eq("user_id", onlyUserId);
    }

    const { data: rulesData, error: rulesError } = await rulesQuery;
    if (rulesError) {
      throw new Error(`Failed to load watch rules: ${rulesError.message}`);
    }

    const rules = ((rulesData ?? []) as WatchRule[]).filter((rule) => {
      const access = isUserEntitled(rule.user_id);
      if (!access.allowed) return false;
      return isFranchiseAllowedForAccount(
        rule.franchise_type_code,
        userMonitoredMap.get(rule.user_id) ?? [],
        access.maxAlertSlots
      );
    });
    const openMatches: SyncRunSummary["openMatches"] = [];
    let alertsSent = 0;

    for (const rule of rules) {
      const matchingEntries = allSlots.filter((entry) => matchesWatchRule(entry, rule));
      if (matchingEntries.length === 0) continue;

      const matchesToNotify: AlertSlotMatch[] = [];
      let lastDecisionReason = "cooldown_active";

      for (const entry of matchingEntries) {
        const { data: lastNotif } = await supabase
          .from("ltfrb_notification_logs")
          .select("sent_at")
          .eq("website_id", websiteId)
          .eq("watch_rule_id", rule.id)
          .eq("slot_key", entry.slotKey)
          .eq("status", "sent")
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const previousRemaining = prevMap.has(entry.slotKey)
          ? prevMap.get(entry.slotKey)!
          : null;

        const decision = evaluateAlertDecision({
          currentRemaining: entry.remaining,
          previousRemaining,
          minRemaining: rule.min_remaining,
          cooldownMinutes: rule.cooldown_minutes,
          lastSentAtIso: (lastNotif?.sent_at as string | undefined) ?? null,
          notifyWhenAvailable: rule.notify_when_available ?? true,
          notifyWhenIncreased: rule.notify_when_increased ?? true,
          notifyWhenDecreased: rule.notify_when_decreased ?? false,
        });

        lastDecisionReason = decision.reason;
        if (
          decision.shouldSend &&
          (decision.reason === "newly_opened" ||
            decision.reason === "slots_increased" ||
            decision.reason === "slots_decreased" ||
            decision.reason === "cooldown_elapsed")
        ) {
          matchesToNotify.push({
            entry,
            previousRemaining,
            delta: decision.delta,
            reason: decision.reason,
          });
        }
      }

      if (matchesToNotify.length === 0) {
        openMatches.push({
          ruleId: rule.id,
          ruleLabel: rule.label,
          entries: matchingEntries,
          alertStatus: "skipped",
          alertReason: lastDecisionReason,
        });
        continue;
      }

      const emailResult = await sendSlotAvailableEmail({
        to: rule.notify_email,
        ruleLabel: rule.label,
        matches: matchesToNotify,
        checkedAtIso: checkedAt,
      });

      const status = emailResult.sent ? "sent" : "failed";
      if (emailResult.sent) alertsSent++;

      await supabase.from("ltfrb_notification_logs").insert(
        matchesToNotify.map((m) => ({
          website_id: websiteId,
          user_id: rule.user_id,
          watch_rule_id: rule.id,
          slot_key: m.entry.slotKey,
          recipient: rule.notify_email,
          subject: `LTFRB ${m.reason === "slots_increased" ? "New Slot" : "Slot Update"}: ${m.entry.franchiseTypeName}`,
          remaining_at_alert: m.entry.remaining,
          status,
          provider_id: emailResult.providerId ?? null,
          error_message: emailResult.error ?? null,
          sent_at: checkedAt,
        }))
      );

      openMatches.push({
        ruleId: rule.id,
        ruleLabel: rule.label,
        entries: matchesToNotify.map((m) => m.entry),
        alertStatus: status,
        alertReason: emailResult.error ?? lastDecisionReason,
      });
    }

    // Automatic Slot Reservation: run any armed profiles whose target franchise/area has open slots
    let armedQuery = supabase
      .from("ltfrb_application_profiles")
      .select("*")
      .eq("website_id", websiteId)
      .eq("is_armed", true)
      .eq("lock_status", "idle");

    if (onlyUserId) {
      armedQuery = armedQuery.eq("user_id", onlyUserId);
    }

    const { data: armedProfiles } = await armedQuery;
    const reservationsAttempted: ReservationAttemptSummary[] = [];

    for (const profile of (armedProfiles ?? []) as ApplicationProfile[]) {
      const access = isUserEntitled(profile.user_id);
      if (!access.allowed) {
        continue;
      }
      if (
        !isFranchiseAllowedForAccount(
          profile.franchise_type_code,
          userMonitoredMap.get(profile.user_id) ?? [],
          access.maxAlertSlots
        )
      ) {
        continue;
      }

      const checkedAtDate = new Date(checkedAt);
      const decision = shouldAutoSubmitProfile({
        profile,
        allSlots,
        prevRemainingMap: prevMap,
        now: checkedAtDate,
      });

      if (decision.shouldSubmit) {
        const outcome = await attemptSlotReservation({
          profileId: profile.id,
          triggerType: decision.reason === "none" ? undefined : decision.reason,
          triggerDetail: decision.triggerDetail ?? undefined,
        });
        reservationsAttempted.push(outcome);
      }
    }

    // Best-effort retention cleanup: prune snapshots older than 7 days for this tenant
    const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("ltfrb_slot_snapshots")
      .delete()
      .eq("website_id", websiteId)
      .lt("checked_at", cutoffIso);

    await supabase
      .from("ltfrb_cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_checked: allSlots.length,
        rules_matched: openMatches.length,
        alerts_sent: alertsSent,
      })
      .eq("id", runId)
      .eq("website_id", websiteId);

    return {
      runId,
      checkedAt,
      recordsChecked: allSlots.length,
      rulesEvaluated: rules.length,
      rulesMatched: openMatches.length,
      alertsSent,
      reservationsAttempted,
      openMatches,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during slot sync";
    // Best-effort retention cleanup: prune snapshots older than 7 days for this tenant
    const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("ltfrb_slot_snapshots")
      .delete()
      .eq("website_id", websiteId)
      .lt("checked_at", cutoffIso);

    await supabase
      .from("ltfrb_cron_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: message,
      })
      .eq("id", runId)
      .eq("website_id", websiteId);
    throw err;
  }
}
