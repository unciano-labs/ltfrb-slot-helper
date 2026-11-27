import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeRegionSlots } from "@/lib/ltfrb/client";
import {
  analyzeSlotTiming,
  deriveMovementsFromSnapshots,
  detectSlotMovements,
  filterEventsForUserSelection,
  getManilaTimeMeta,
} from "@/lib/monitor/slot-analytics";

describe("slot movement detection and best-time analytics", () => {
  it("classifies refilled, increased, and decreased slot transitions with Manila time", () => {
    const slots = normalizeRegionSlots([
      {
        region_id: "r1",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        total_slots: 100,
        remaining: 3, // refilled 0 -> 3
        filed_application: 97,
        percentage: 97,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
      {
        region_id: "r2",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 100,
        remaining: 8, // increased 5 -> 8
        filed_application: 92,
        percentage: 92,
        franchise_type: { code: "TNVS", name: "TNVS" },
      },
      {
        region_id: "r3",
        region_code: "0300000000",
        region_name: "Region III (Central Luzon)",
        total_slots: 100,
        remaining: 0, // decreased 2 -> 0
        filed_application: 100,
        percentage: 100,
        franchise_type: { code: "EVT", name: "EVT" },
      },
    ]);

    const prevMap = new Map<string, number>([
      ["region:1300000000:E_TNVS", 0],
      ["region:0700000000:TNVS", 5],
      ["region:0300000000:EVT", 2],
    ]);

    // 2026-11-26T23:15:00Z === 2026-11-27 07:15 AM Asia/Manila (Friday)
    const events = detectSlotMovements({
      websiteId: "site-1",
      allSlots: slots,
      prevRemainingMap: prevMap,
      occurredAt: "2026-11-26T23:15:00.000Z",
    });

    assert.equal(events.length, 3);
    assert.equal(events[0].event_type, "refilled");
    assert.equal(events[0].delta, 3);
    assert.equal(events[0].manila_hour, 7);
    assert.equal(events[0].manila_weekday, 5); // Friday

    assert.equal(events[1].event_type, "increased");
    assert.equal(events[1].delta, 3);

    assert.equal(events[2].event_type, "decreased");
    assert.equal(events[2].delta, -2);
  });

  it("derives movements from snapshot history and identifies best submission windows", () => {
    const derived = deriveMovementsFromSnapshots([
      {
        checked_at: "2026-11-26T22:45:00.000Z",
        scope: "region",
        slot_key: "region:1300000000:E_TNVS",
        franchise_type_code: "E_TNVS",
        franchise_type_name: "E-TNVS",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        province_code: null,
        province_name: null,
        remaining: 0,
      },
      {
        checked_at: "2026-11-26T23:00:00.000Z", // 7:00 AM Manila
        scope: "region",
        slot_key: "region:1300000000:E_TNVS",
        franchise_type_code: "E_TNVS",
        franchise_type_name: "E-TNVS",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        province_code: null,
        province_name: null,
        remaining: 2,
      },
      {
        checked_at: "2026-11-26T23:30:00.000Z", // 7:30 AM Manila (filled after 30 mins)
        scope: "region",
        slot_key: "region:1300000000:E_TNVS",
        franchise_type_code: "E_TNVS",
        franchise_type_name: "E-TNVS",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        province_code: null,
        province_name: null,
        remaining: 0,
      },
    ]);

    assert.equal(derived.length, 2);
    assert.equal(derived[1].event_type, "refilled");
    assert.equal(derived[0].event_type, "decreased");

    const analysis = analyzeSlotTiming(derived, ["E_TNVS"]);
    assert.equal(analysis.refillCount, 1);
    assert.equal(analysis.decreaseCount, 1);
    assert.equal(analysis.topHours[0]?.hour, 7);
    assert.equal(analysis.topDays[0]?.name, "Friday");
    assert.equal(analysis.avgMinutesToFill, 30);
    assert.match(analysis.recommendation, /7:00 AM/);

    const meta = getManilaTimeMeta(new Date("2026-11-26T16:05:00.000Z")); // 12:05 AM Fri PHT
    assert.equal(meta.hour, 0);
    assert.equal(meta.weekday, 5);
  });

  it("filters slot events strictly by user chosen watch rules and profile area without double-counting NCR/MUCEP", () => {
    const sampleEvents = [
      {
        id: "e1",
        occurred_at: "2026-11-27T12:00:00.000Z",
        manila_hour: 20,
        manila_weekday: 5,
        scope: "region" as const,
        slot_key: "region:1300000000:E_TNVS",
        franchise_type_code: "E_TNVS",
        franchise_type_name: "E-TNVS",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        province_code: null,
        province_name: null,
        event_type: "decreased" as const,
        previous_remaining: 367,
        new_remaining: 363,
        delta: -4,
      },
      {
        id: "e2",
        occurred_at: "2026-11-27T12:00:00.000Z",
        manila_hour: 20,
        manila_weekday: 5,
        scope: "province" as const,
        slot_key: "province:1300000001:E_TNVS",
        franchise_type_code: "E_TNVS",
        franchise_type_name: "E-TNVS",
        region_code: "1300000000",
        region_name: "MUCEP AREA",
        province_code: "1300000001",
        province_name: "MUCEP AREA",
        event_type: "decreased" as const,
        previous_remaining: 367,
        new_remaining: 363,
        delta: -4,
      },
      {
        id: "e3",
        occurred_at: "2026-11-27T14:45:00.000Z",
        manila_hour: 22,
        manila_weekday: 5,
        scope: "region" as const,
        slot_key: "region:0200000000:TNVS",
        franchise_type_code: "TNVS",
        franchise_type_name: "TNVS",
        region_code: "0200000000",
        region_name: "Region II (Cagayan Valley)",
        province_code: null,
        province_name: null,
        event_type: "increased" as const,
        previous_remaining: 299,
        new_remaining: 300,
        delta: 1,
      },
      {
        id: "e4",
        occurred_at: "2026-11-27T12:15:00.000Z",
        manila_hour: 20,
        manila_weekday: 5,
        scope: "region" as const,
        slot_key: "region:1300000000:TEMPO",
        franchise_type_code: "TEMPO",
        franchise_type_name: "TEMPO",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        province_code: null,
        province_name: null,
        event_type: "decreased" as const,
        previous_remaining: 100,
        new_remaining: 99,
        delta: -1,
      },
    ];

    const filtered = filterEventsForUserSelection({
      events: sampleEvents,
      watchRules: [
        {
          is_active: true,
          scope: "region",
          franchise_type_code: "TNVS",
          region_code: "1300000000",
          region_name: "MUCEP AREA",
          province_code: null,
          province_name: null,
        },
        {
          is_active: true,
          scope: "region",
          franchise_type_code: "E_TNVS",
          region_code: "1300000000",
          region_name: "MUCEP AREA",
          province_code: null,
          province_name: null,
        },
      ],
      reservationProfiles: [
        {
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: "MUCEP AREA",
        },
      ],
      monitoredFranchiseCodes: ["TNVS", "E_TNVS"],
    });

    // Should exclude Region II TNVS (e3) and NCR TEMPO (e4), and deduplicate NCR+MUCEP E_TNVS (e1/e2) to 1 event
    assert.equal(filtered.events.length, 1);
    assert.equal(filtered.events[0].franchise_type_code, "E_TNVS");
    assert.equal(filtered.events[0].region_code, "1300000000");
  });
});
