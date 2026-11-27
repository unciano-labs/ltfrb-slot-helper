import type { ApplicationProfile, SlotEntry, WatchRule } from "@/lib/ltfrb/types";

/**
 * Matches whether a slot entry belongs to a watch rule's target scope,
 * franchise type, region, and province (regardless of current remaining count,
 * so decrease / 1 -> 0 movements can also be detected).
 */
export function matchesWatchRule(entry: SlotEntry, rule: WatchRule): boolean {
  if (!rule.is_active) return false;
  if (entry.scope !== rule.scope) return false;

  if (
    rule.franchise_type_code !== "ALL" &&
    entry.franchiseTypeCode !== rule.franchise_type_code
  ) {
    return false;
  }

  if (rule.region_code && entry.regionCode !== rule.region_code) {
    return false;
  }

  if (
    rule.scope === "province" &&
    rule.province_code &&
    entry.provinceCode !== rule.province_code
  ) {
    return false;
  }

  return true;
}

export type AlertDecisionReason =
  | "newly_opened"
  | "slots_increased"
  | "slots_decreased"
  | "cooldown_elapsed"
  | "cooldown_active"
  | "slot_full"
  | "no_matching_trigger";

export interface AlertDecision {
  shouldSend: boolean;
  reason: AlertDecisionReason;
  delta: number;
}

/**
 * Decides whether an email notification should be sent based on the user's
 * selected triggers:
 *  - notifyWhenAvailable: send when slot is open (>= minRemaining)
 *  - notifyWhenIncreased: send immediately when open slots go UP (new slot ready!)
 *  - notifyWhenDecreased: send immediately when open slots go DOWN
 */
export function evaluateAlertDecision(params: {
  currentRemaining: number;
  previousRemaining: number | null;
  minRemaining: number;
  cooldownMinutes: number;
  lastSentAtIso: string | null;
  notifyWhenAvailable?: boolean;
  notifyWhenIncreased?: boolean;
  notifyWhenDecreased?: boolean;
  now?: Date;
}): AlertDecision {
  const now = params.now ?? new Date();
  const {
    currentRemaining,
    previousRemaining,
    minRemaining,
    cooldownMinutes,
    lastSentAtIso,
  } = params;
  const notifyWhenAvailable = params.notifyWhenAvailable ?? true;
  const notifyWhenIncreased = params.notifyWhenIncreased ?? true;
  const notifyWhenDecreased = params.notifyWhenDecreased ?? false;

  const delta =
    previousRemaining === null ? 0 : currentRemaining - previousRemaining;

  // 1. Slot count increased (most important: new open slot available & ready to apply)
  if (
    previousRemaining !== null &&
    currentRemaining > previousRemaining &&
    currentRemaining >= minRemaining
  ) {
    if (notifyWhenIncreased || (previousRemaining < minRemaining && notifyWhenAvailable)) {
      return { shouldSend: true, reason: "slots_increased", delta };
    }
  }

  // 2. First time seen with open slots (>= minRemaining)
  if (previousRemaining === null && currentRemaining >= minRemaining) {
    if (notifyWhenAvailable || notifyWhenIncreased) {
      return { shouldSend: true, reason: "newly_opened", delta: currentRemaining };
    }
  }

  // 3. Slot count decreased
  if (previousRemaining !== null && currentRemaining < previousRemaining) {
    if (notifyWhenDecreased) {
      return { shouldSend: true, reason: "slots_decreased", delta };
    }
    return { shouldSend: false, reason: "no_matching_trigger", delta };
  }

  // 4. Below threshold / full
  if (currentRemaining < minRemaining) {
    return { shouldSend: false, reason: "slot_full", delta };
  }

  // 5. Unchanged and open: only remind if notifyWhenAvailable is enabled & cooldown elapsed
  if (!notifyWhenAvailable) {
    return { shouldSend: false, reason: "no_matching_trigger", delta };
  }

  if (!lastSentAtIso) {
    return { shouldSend: true, reason: "cooldown_elapsed", delta };
  }

  const lastSentMs = Date.parse(lastSentAtIso);
  if (Number.isNaN(lastSentMs)) {
    return { shouldSend: true, reason: "cooldown_elapsed", delta };
  }

  const elapsedMinutes = (now.getTime() - lastSentMs) / 60_000;
  if (cooldownMinutes > 0 && elapsedMinutes >= cooldownMinutes) {
    return { shouldSend: true, reason: "cooldown_elapsed", delta };
  }

  return { shouldSend: false, reason: "cooldown_active", delta };
}

export function getManilaHourMinute(now: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const rawHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // Some runtimes format midnight as "24" when hour12: false
  const hour = rawHour === 24 ? 0 : rawHour;
  return { hour, minute };
}

function getMatchingSlotsForProfile(
  profile: Pick<
    ApplicationProfile,
    "franchise_type_code" | "region_name" | "province_name"
  >,
  allSlots: SlotEntry[]
): SlotEntry[] {
  const byFranchise = allSlots.filter(
    (slot) => slot.franchiseTypeCode === profile.franchise_type_code
  );
  if (profile.province_name) {
    // Resolve canonical regionCode from region-level slots because LTFRB sometimes sets
    // a different region_name on province slots (e.g. MUCEP AREA has region_code 1300000000 / NCR).
    const targetRegionCode = byFranchise.find(
      (slot) => slot.scope === "region" && slot.regionName === profile.region_name
    )?.regionCode;

    const provinceMatches = byFranchise.filter(
      (slot) => slot.scope === "province" && slot.provinceName === profile.province_name
    );

    if (provinceMatches.length > 0) {
      if (targetRegionCode) {
        const regionCodeMatches = provinceMatches.filter(
          (slot) => slot.regionCode === targetRegionCode
        );
        if (regionCodeMatches.length > 0) return regionCodeMatches;
        // If another region's slot had the same generic name (e.g. "Any Point in the Region"),
        // fall through to region-level matching rather than cross-matching the wrong region.
      } else {
        const distinctRegions = new Set(provinceMatches.map((s) => s.regionCode).filter(Boolean));
        if (distinctRegions.size <= 1) return provinceMatches;
        const exactNameMatches = provinceMatches.filter(
          (slot) => slot.regionName === profile.region_name
        );
        if (exactNameMatches.length > 0) return exactNameMatches;
      }
    }
  }
  return byFranchise.filter(
    (slot) => slot.scope === "region" && slot.regionName === profile.region_name
  );
}

export function shouldAutoSubmitProfile(params: {
  profile: Pick<
    ApplicationProfile,
    | "is_armed"
    | "lock_status"
    | "franchise_type_code"
    | "region_name"
    | "province_name"
    | "number_of_units"
    | "submit_on_slot_increase"
    | "submit_at_midnight"
    | "submit_hourly"
    | "last_attempted_at"
  >;
  allSlots: SlotEntry[];
  prevRemainingMap: Map<string, number>;
  now?: Date;
}): { shouldSubmit: boolean; reason: "slot_increased" | "scheduled_hours" | "hourly" | "none" } {
  const { profile, allSlots, prevRemainingMap } = params;
  const now = params.now ?? new Date();

  if (!profile.is_armed || profile.lock_status !== "idle") {
    return { shouldSubmit: false, reason: "none" };
  }

  const submitOnIncrease = profile.submit_on_slot_increase ?? true;
  const submitAtScheduledHours = profile.submit_at_midnight ?? false;
  const submitHourly = profile.submit_hourly ?? false;
  const lastMs = profile.last_attempted_at ? Date.parse(profile.last_attempted_at) : NaN;

  if (submitAtScheduledHours) {
    const { hour, minute } = getManilaHourMinute(now);
    const inScheduledWindow =
      (hour === 0 || hour === 7 || hour === 8) && minute < 30;
    if (inScheduledWindow) {
      const recentlyAttempted =
        !Number.isNaN(lastMs) && now.getTime() - lastMs < 25 * 60_000;
      if (!recentlyAttempted) {
        return { shouldSubmit: true, reason: "scheduled_hours" };
      }
    }
  }

  if (submitHourly) {
    const matchingSlots = getMatchingSlotsForProfile(profile, allSlots);
    const hasOpenSlot = matchingSlots.some(
      (slot) => slot.remaining >= profile.number_of_units
    );

    const hourElapsed =
      Number.isNaN(lastMs) || now.getTime() - lastMs >= 55 * 60_000;
    if (hasOpenSlot && hourElapsed) {
      return { shouldSubmit: true, reason: "hourly" };
    }
  }

  if (submitOnIncrease) {
    const matchingSlots = getMatchingSlotsForProfile(profile, allSlots);

    const increasedAndEnough = matchingSlots.some((slot) => {
      if (slot.remaining < profile.number_of_units) return false;
      const prev = prevRemainingMap.has(slot.slotKey)
        ? prevRemainingMap.get(slot.slotKey)!
        : null;
      return prev === null || prev < profile.number_of_units || slot.remaining > prev;
    });

    if (increasedAndEnough) {
      return { shouldSubmit: true, reason: "slot_increased" };
    }
  }

  return { shouldSubmit: false, reason: "none" };
}
