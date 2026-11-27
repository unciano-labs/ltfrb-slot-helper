import type { SlotEntry, SlotScope } from "@/lib/ltfrb/types";

export type SlotMovementType = "refilled" | "increased" | "decreased";

export interface SlotMovementEvent {
  id: string;
  occurred_at: string;
  manila_hour: number;
  manila_weekday: number;
  scope: SlotScope;
  slot_key: string;
  franchise_type_code: string;
  franchise_type_name: string;
  region_code: string | null;
  region_name: string | null;
  province_code: string | null;
  province_name: string | null;
  event_type: SlotMovementType;
  previous_remaining: number;
  new_remaining: number;
  delta: number;
}

export interface SlotMovementEventInsert {
  website_id: string;
  occurred_at: string;
  manila_hour: number;
  manila_weekday: number;
  scope: SlotScope;
  slot_key: string;
  franchise_type_code: string;
  franchise_type_name: string;
  region_code: string;
  region_name: string;
  province_code: string | null;
  province_name: string | null;
  event_type: SlotMovementType;
  previous_remaining: number;
  new_remaining: number;
  delta: number;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getManilaTimeMeta(date: Date): { hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const rawHour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const hour = rawHour === 24 ? 0 : rawHour;
  const wkStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const weekday = WEEKDAY_INDEX[wkStr] ?? 0;
  return { hour, weekday };
}

export function formatHourRangeLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const next = (normalized + 1) % 24;
  const fmt = (h: number) => {
    if (h === 0) return "12:00 AM";
    if (h === 12) return "12:00 PM";
    return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
  };
  return `${fmt(normalized)} – ${fmt(next)}`;
}

/**
 * Compares freshly fetched slots with previous remaining counts and returns
 * movement records for every refill (0 -> >0), increase, or decrease.
 */
export function detectSlotMovements(params: {
  websiteId: string;
  allSlots: SlotEntry[];
  prevRemainingMap: Map<string, number>;
  occurredAt: string;
}): SlotMovementEventInsert[] {
  const { websiteId, allSlots, prevRemainingMap, occurredAt } = params;
  const date = new Date(occurredAt);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const { hour, weekday } = getManilaTimeMeta(safeDate);
  const events: SlotMovementEventInsert[] = [];

  for (const slot of allSlots) {
    if (!prevRemainingMap.has(slot.slotKey)) continue;
    const prev = prevRemainingMap.get(slot.slotKey)!;
    const next = slot.remaining;
    if (prev === next) continue;

    const delta = next - prev;
    const eventType: SlotMovementType =
      prev === 0 && next > 0 ? "refilled" : delta > 0 ? "increased" : "decreased";

    events.push({
      website_id: websiteId,
      occurred_at: occurredAt,
      manila_hour: hour,
      manila_weekday: weekday,
      scope: slot.scope,
      slot_key: slot.slotKey,
      franchise_type_code: slot.franchiseTypeCode,
      franchise_type_name: slot.franchiseTypeName,
      region_code: slot.regionCode,
      region_name: slot.regionName,
      province_code: slot.provinceCode,
      province_name: slot.provinceName,
      event_type: eventType,
      previous_remaining: prev,
      new_remaining: next,
      delta,
    });
  }

  return events;
}

export interface SnapshotHistoryRow {
  id?: string;
  checked_at: string;
  scope: SlotScope;
  slot_key: string;
  franchise_type_code: string;
  franchise_type_name: string;
  region_code: string | null;
  region_name: string | null;
  province_code: string | null;
  province_name: string | null;
  remaining: number;
}

/**
 * Fallback helper that derives slot movements from historical `ltfrb_slot_snapshots`
 * rows when `ltfrb_slot_events` has not been created or populated yet.
 */
export function deriveMovementsFromSnapshots(rows: SnapshotHistoryRow[]): SlotMovementEvent[] {
  const bySlotKey = new Map<string, SnapshotHistoryRow[]>();
  for (const row of rows) {
    const list = bySlotKey.get(row.slot_key) ?? [];
    list.push(row);
    bySlotKey.set(row.slot_key, list);
  }

  const events: SlotMovementEvent[] = [];

  for (const [slotKey, entries] of bySlotKey.entries()) {
    entries.sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at));
    for (let i = 1; i < entries.length; i += 1) {
      const prev = entries[i - 1];
      const curr = entries[i];
      const prevRem = Number(prev.remaining ?? 0);
      const currRem = Number(curr.remaining ?? 0);
      if (prevRem === currRem) continue;

      const delta = currRem - prevRem;
      const eventType: SlotMovementType =
        prevRem === 0 && currRem > 0 ? "refilled" : delta > 0 ? "increased" : "decreased";
      const d = new Date(curr.checked_at);
      const { hour, weekday } = getManilaTimeMeta(Number.isNaN(d.getTime()) ? new Date() : d);

      events.push({
        id: curr.id ?? `${slotKey}:${curr.checked_at}`,
        occurred_at: curr.checked_at,
        manila_hour: hour,
        manila_weekday: weekday,
        scope: curr.scope,
        slot_key: slotKey,
        franchise_type_code: curr.franchise_type_code,
        franchise_type_name: curr.franchise_type_name,
        region_code: curr.region_code,
        region_name: curr.region_name,
        province_code: curr.province_code,
        province_name: curr.province_name,
        event_type: eventType,
        previous_remaining: prevRem,
        new_remaining: currRem,
        delta,
      });
    }
  }

  return events.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

export interface HourlyWindowStat {
  hour: number;
  label: string;
  refills: number;
  increases: number;
  decreases: number;
  openings: number;
  score: number;
}

export interface WeekdayStat {
  weekday: number;
  name: string;
  refills: number;
  increases: number;
  decreases: number;
  openings: number;
}

export interface SlotTimingAnalysis {
  totalEvents: number;
  refillCount: number;
  increaseCount: number;
  decreaseCount: number;
  totalOpenings: number;
  topHours: HourlyWindowStat[];
  topDays: WeekdayStat[];
  activeHours: HourlyWindowStat[];
  avgMinutesToFill: number | null;
  recommendation: string;
}

/**
 * Analyzes recorded slot movements in Asia/Manila time to highlight which hours
 * and days of the week slots most often refill or increase.
 */
export function analyzeSlotTiming(
  events: SlotMovementEvent[],
  franchiseCodesFilter?: string[]
): SlotTimingAnalysis {
  const filterSet =
    franchiseCodesFilter && franchiseCodesFilter.length > 0
      ? new Set(franchiseCodesFilter)
      : null;

  const relevant = filterSet
    ? events.filter((e) => filterSet.has(e.franchise_type_code))
    : events;

  const hoursMap = new Map<number, HourlyWindowStat>();
  for (let h = 0; h < 24; h += 1) {
    hoursMap.set(h, {
      hour: h,
      label: formatHourRangeLabel(h),
      refills: 0,
      increases: 0,
      decreases: 0,
      openings: 0,
      score: 0,
    });
  }

  const daysMap = new Map<number, WeekdayStat>();
  for (let w = 0; w < 7; w += 1) {
    daysMap.set(w, {
      weekday: w,
      name: WEEKDAY_NAMES[w],
      refills: 0,
      increases: 0,
      decreases: 0,
      openings: 0,
    });
  }

  let refillCount = 0;
  let increaseCount = 0;
  let decreaseCount = 0;

  for (const ev of relevant) {
    const hStat = hoursMap.get(ev.manila_hour);
    const dStat = daysMap.get(ev.manila_weekday);

    if (ev.event_type === "refilled") {
      refillCount += 1;
      if (hStat) {
        hStat.refills += 1;
        hStat.openings += 1;
        hStat.score += 2;
      }
      if (dStat) {
        dStat.refills += 1;
        dStat.openings += 1;
      }
    } else if (ev.event_type === "increased") {
      increaseCount += 1;
      if (hStat) {
        hStat.increases += 1;
        hStat.openings += 1;
        hStat.score += 1;
      }
      if (dStat) {
        dStat.increases += 1;
        dStat.openings += 1;
      }
    } else {
      decreaseCount += 1;
      if (hStat) hStat.decreases += 1;
      if (dStat) dStat.decreases += 1;
    }
  }

  // Estimate average time slots stay open before filling back down to 0
  const bySlot = new Map<string, SlotMovementEvent[]>();
  for (const ev of relevant) {
    const list = bySlot.get(ev.slot_key) ?? [];
    list.push(ev);
    bySlot.set(ev.slot_key, list);
  }
  const fillDurationsMin: number[] = [];
  for (const list of bySlot.values()) {
    list.sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    let openedAtMs: number | null = null;
    for (const ev of list) {
      const ts = Date.parse(ev.occurred_at);
      if (Number.isNaN(ts)) continue;
      if (ev.event_type === "refilled" && openedAtMs === null) {
        openedAtMs = ts;
      } else if (ev.event_type === "decreased" && ev.new_remaining === 0 && openedAtMs !== null) {
        const diffMin = Math.round((ts - openedAtMs) / 60_000);
        if (diffMin >= 0 && diffMin <= 7 * 24 * 60) {
          fillDurationsMin.push(diffMin);
        }
        openedAtMs = null;
      }
    }
  }

  const avgMinutesToFill =
    fillDurationsMin.length > 0
      ? Math.round(fillDurationsMin.reduce((a, b) => a + b, 0) / fillDurationsMin.length)
      : null;

  const allHours = Array.from(hoursMap.values());
  const topHours = [...allHours]
    .filter((h) => h.openings > 0)
    .sort((a, b) => b.score - a.score || b.openings - a.openings)
    .slice(0, 3);

  const topDays = Array.from(daysMap.values())
    .filter((d) => d.openings > 0)
    .sort((a, b) => b.openings - a.openings || b.refills - a.refills)
    .slice(0, 3);

  const activeHours = allHours.filter(
    (h) => h.openings > 0 || h.decreases > 0
  );

  const totalOpenings = refillCount + increaseCount;

  let recommendation: string;
  if (totalOpenings === 0) {
    recommendation =
      relevant.length > 0
        ? `Recorded ${decreaseCount} slot decrease(s) so far, with no refills/increases yet. Keep Automatic Check running so we capture the exact hours when LTFRB refills slots.`
        : "No slot changes recorded yet. As our 15-minute checks observe LTFRB slots refilling, increasing, or decreasing, your best submission windows will appear here automatically.";
  } else {
    const hourText = topHours.map((h) => h.label).join(", ");
    const dayText = topDays.map((d) => d.name).join(" / ");
    const speedNote =
      avgMinutesToFill !== null
        ? ` Historically, refilled slots filled back up in about ${Math.max(1, avgMinutesToFill)} minute(s).`
        : "";
    recommendation = `Best time to submit based on ${totalOpenings} recorded slot opening(s): ${hourText} (Manila Time)${
      dayText ? ` — most active on ${dayText}` : ""
    }.${speedNote}`;
  }

  return {
    totalEvents: relevant.length,
    refillCount,
    increaseCount,
    decreaseCount,
    totalOpenings,
    topHours,
    topDays,
    activeHours,
    avgMinutesToFill,
    recommendation,
  };
}
