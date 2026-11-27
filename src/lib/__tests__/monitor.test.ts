import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import {
  classifySubmissionResponse,
  hasValidOwnershipDocument,
  normalizeProvinceSlots,
  normalizeRegionSlots,
} from "@/lib/ltfrb/client";
import type { WatchRule } from "@/lib/ltfrb/types";
import {
  isFranchiseAllowedForAccount,
  normalizeSelectedFranchises,
} from "@/lib/monitor/preferences";
import {
  evaluateAlertDecision,
  matchesWatchRule,
  shouldAutoSubmitProfile,
} from "@/lib/monitor/rules";
import {
  attachTriggerToRawResponse,
  formatSubmissionTriggerDisplay,
  normalizeSubmissionLogRow,
} from "@/lib/monitor/submission-trigger";
import { decryptSecret, encryptSecret, verifyCronBearerToken } from "@/lib/security/crypto";

describe("crypto security helpers", () => {
  it("encrypts and decrypts secrets cleanly with AES-256-GCM", () => {
    const key = crypto.randomBytes(32).toString("base64");
    const plaintext = "My-LTFRB-Passw0rd!";
    const encrypted = encryptSecret(plaintext, key);

    assert.notEqual(encrypted, plaintext);
    assert.equal(encrypted.split(".").length, 3);
    assert.equal(decryptSecret(encrypted, key), plaintext);
  });

  it("verifies bearer token in constant time", () => {
    assert.equal(verifyCronBearerToken("Bearer super-secret", "super-secret"), true);
    assert.equal(verifyCronBearerToken("Bearer wrong", "super-secret"), false);
    assert.equal(verifyCronBearerToken(null, "super-secret"), false);
  });
});

describe("LTFRB normalizers and watch rules", () => {
  it("normalizes region and province slots", () => {
    const regions = normalizeRegionSlots([
      {
        region_id: "r1",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 1000,
        remaining: 15,
        filed_application: 985,
        percentage: 98.5,
        franchise_type: { code: "EVT", name: "Electric Vehicle Taxi (EVT)" },
      },
    ]);

    assert.equal(regions[0].slotKey, "region:0700000000:EVT");
    assert.equal(regions[0].remaining, 15);

    const provinces = normalizeProvinceSlots([
      {
        province_id: "p1",
        province_code: "0701200000",
        province_name: "Bohol",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 100,
        remaining: 0,
        filed_application: 100,
        percentage: 100,
        franchise_type: { code: "TNVS", name: "Transport Network Vehicle Service" },
      },
    ]);

    assert.equal(provinces[0].slotKey, "province:0701200000:TNVS");
    assert.equal(provinces[0].provinceName, "Bohol");
  });

  it("matches watch rules and enforces cooldown", () => {
    const rule: WatchRule = {
      id: "rule-1",
      website_id: "site-1",
      user_id: "user-1",
      label: "Central Visayas EVT",
      scope: "region",
      franchise_type_code: "EVT",
      franchise_type_name: "Electric Vehicle Taxi (EVT)",
      region_code: "0700000000",
      region_name: "Region VII (Central Visayas)",
      province_code: null,
      province_name: null,
      min_remaining: 1,
      notify_email: "owner@example.com",
      cooldown_minutes: 60,
      notify_when_available: true,
      notify_when_increased: true,
      notify_when_decreased: false,
      is_active: true,
      auto_submit: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const [entry] = normalizeRegionSlots([
      {
        region_id: "r1",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 1000,
        remaining: 15,
        filed_application: 985,
        percentage: 98.5,
        franchise_type: { code: "EVT", name: "Electric Vehicle Taxi (EVT)" },
      },
    ]);

    assert.equal(matchesWatchRule(entry, rule), true);

    const now = new Date("2026-11-27T10:00:00Z");
    assert.equal(
      evaluateAlertDecision({
        currentRemaining: 15,
        previousRemaining: 0,
        minRemaining: 1,
        cooldownMinutes: 60,
        lastSentAtIso: null,
        now,
      }).shouldSend,
      true
    );

    assert.equal(
      evaluateAlertDecision({
        currentRemaining: 15,
        previousRemaining: 15,
        minRemaining: 1,
        cooldownMinutes: 60,
        lastSentAtIso: "2026-11-27T09:30:00Z",
        now,
      }).shouldSend,
      false
    );

    assert.equal(
      evaluateAlertDecision({
        currentRemaining: 20,
        previousRemaining: 15,
        minRemaining: 1,
        cooldownMinutes: 60,
        lastSentAtIso: "2026-11-27T09:30:00Z",
        notifyWhenAvailable: true,
        notifyWhenIncreased: true,
        notifyWhenDecreased: false,
        now,
      }).shouldSend,
      true
    );

    // Decreased slots: only alerts when notifyWhenDecreased is true
    assert.equal(
      evaluateAlertDecision({
        currentRemaining: 12,
        previousRemaining: 15,
        minRemaining: 1,
        cooldownMinutes: 60,
        lastSentAtIso: "2026-11-27T09:30:00Z",
        notifyWhenAvailable: true,
        notifyWhenIncreased: true,
        notifyWhenDecreased: false,
        now,
      }).shouldSend,
      false
    );

    const decreasedAlert = evaluateAlertDecision({
      currentRemaining: 0,
      previousRemaining: 1,
      minRemaining: 1,
      cooldownMinutes: 60,
      lastSentAtIso: "2026-11-27T09:30:00Z",
      notifyWhenAvailable: false,
      notifyWhenIncreased: true,
      notifyWhenDecreased: true,
      now,
    });
    assert.equal(decreasedAlert.shouldSend, true);
    assert.equal(decreasedAlert.reason, "slots_decreased");
    assert.equal(decreasedAlert.delta, -1);
  });

  it("classifies LTFRB application submission responses accurately", () => {
    const success = classifySubmissionResponse(201, {
      data: { id: "app-1", attributes: { case_number: "2026-NCR-00123" } },
    });
    assert.equal(success.result, "success");
    assert.equal(success.referenceNumber, "2026-NCR-00123");

    const fullSlot = classifySubmissionResponse(422, {
      message: "Slot is already full for this franchise type.",
    });
    assert.equal(fullSlot.result, "full_slot");

    const authErr = classifySubmissionResponse(401, { message: "Unauthenticated" });
    assert.equal(authErr.result, "auth_error");

    const validationErr = classifySubmissionResponse(422, {
      message: "Plate number is invalid.",
    });
    assert.equal(validationErr.result, "validation_error");

    const jsonApiEvErr = classifySubmissionResponse(422, {
      errors: [
        {
          status: "422",
          code: "validation_error",
          title: "Validation Error",
          detail: "Unit 1: EV type is required for E_TNVS units.",
        },
      ],
    });
    assert.equal(jsonApiEvErr.result, "validation_error");
    assert.equal(jsonApiEvErr.message, "Unit 1: EV type is required for E_TNVS units.");

    const jsonApiFullSlot = classifySubmissionResponse(422, {
      errors: [{ detail: "No available slots left for this region." }],
    });
    assert.equal(jsonApiFullSlot.result, "full_slot");
  });

  it("enforces up to 2 monitored franchises per account", () => {
    const empty = normalizeSelectedFranchises([]);
    assert.equal(empty.valid, false);

    const two = normalizeSelectedFranchises(["TNVS", "E_TNVS", "TNVS"]);
    assert.equal(two.valid, true);
    assert.deepEqual(two.codes, ["TNVS", "E_TNVS"]);

    const three = normalizeSelectedFranchises(["TNVS", "E_TNVS", "EVT"]);
    assert.equal(three.valid, false);

    const allFlag = normalizeSelectedFranchises(["ALL"]);
    assert.equal(allFlag.valid, false);

    assert.equal(isFranchiseAllowedForAccount("TNVS", ["TNVS", "EVT"]), true);
    assert.equal(isFranchiseAllowedForAccount("TFH", ["TNVS", "EVT"]), false);
    assert.equal(isFranchiseAllowedForAccount("ALL", ["TNVS", "EVT"]), false);
    assert.equal(isFranchiseAllowedForAccount("TNVS", []), false);
  });

  it("accepts Sales Invoice OR complete OR+CR as valid ownership documents", () => {
    assert.equal(hasValidOwnershipDocument(null), false);
    assert.equal(hasValidOwnershipDocument({}), false);
    assert.equal(
      hasValidOwnershipDocument({ sales_invoice_file: "https://cdn.example.com/si.pdf" }),
      true
    );
    assert.equal(
      hasValidOwnershipDocument({ or_file: "https://cdn.example.com/or.pdf" }),
      false
    );
    assert.equal(
      hasValidOwnershipDocument({
        or_file: "https://cdn.example.com/or.pdf",
        cr_file: "https://cdn.example.com/cr.pdf",
      }),
      true
    );
  });

  it("triggers auto-submission only on slot increase, 12 midnight PHT, or hourly, and stops once submitted", () => {
    const [slotOpen] = normalizeRegionSlots([
      {
        region_id: "r1",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        total_slots: 100,
        remaining: 5,
        filed_application: 95,
        percentage: 95,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);

    const prevMap = new Map<string, number>([[slotOpen.slotKey, 5]]);

    // Unchanged 5 -> 5 does not re-trigger submit_on_slot_increase
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: true,
          submit_at_midnight: false,
          submit_hourly: false,
          last_attempted_at: null,
        },
        allSlots: [slotOpen],
        prevRemainingMap: prevMap,
        now: new Date("2026-11-27T06:00:00Z"), // 2:00 PM PHT
      }).shouldSubmit,
      false
    );

    // Increased 4 -> 5 triggers immediately with trigger detail
    const incDecision = shouldAutoSubmitProfile({
      profile: {
        is_armed: true,
        lock_status: "idle",
        franchise_type_code: "E_TNVS",
        region_name: "National Capital Region (NCR)",
        province_name: null,
        number_of_units: 1,
        submit_on_slot_increase: true,
        submit_at_midnight: false,
        submit_hourly: false,
        last_attempted_at: null,
      },
      allSlots: [slotOpen],
      prevRemainingMap: new Map([[slotOpen.slotKey, 4]]),
      now: new Date("2026-11-27T06:00:00Z"),
    });
    assert.equal(incDecision.reason, "slot_increased");
    assert.match(incDecision.triggerDetail ?? "", /slot increase \(4 → 5, \+1/i);

    // Scheduled hours: 12:05 AM PHT (16:05 UTC), 7:10 AM PHT (23:10 UTC), 8:05 AM PHT (00:05 UTC)
    for (const utcIso of [
      "2026-11-27T16:05:00Z", // 00:05 PHT
      "2026-11-27T23:10:00Z", // 07:10 PHT
      "2026-11-28T00:05:00Z", // 08:05 PHT
    ]) {
      const schedDecision = shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: true,
          submit_hourly: false,
          last_attempted_at: null,
        },
        allSlots: [],
        prevRemainingMap: new Map(),
        now: new Date(utcIso),
      });
      assert.equal(schedDecision.reason, "scheduled_hours");
      assert.match(schedDecision.triggerDetail ?? "", /scheduled TIME/i);
    }

    // Outside 12MN/7AM/8AM (9:05 AM PHT = 01:05 UTC) or duplicate within 25 mins skips
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: true,
          submit_hourly: false,
          last_attempted_at: null,
        },
        allSlots: [],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-28T01:05:00Z"),
      }).shouldSubmit,
      false
    );

    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: true,
          submit_hourly: false,
          last_attempted_at: "2026-11-27T23:02:00Z", // 7:02 AM PHT
        },
        allSlots: [],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-27T23:17:00Z"), // 7:17 AM PHT
      }).shouldSubmit,
      false
    );

    // Must NOT double-trigger at 12:27 AM if 12:00 AM already ran (3-min cron inside < 30 window)
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: true,
          submit_hourly: false,
          last_attempted_at: "2026-11-27T16:00:10Z", // 12:00:10 AM PHT
        },
        allSlots: [],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-27T16:27:05Z"), // 12:27:05 AM PHT
      }).shouldSubmit,
      false
    );

    // Hourly does NOT trigger when slot is 0 (full)
    const slotZero = { ...slotOpen, remaining: 0 };
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: false,
          submit_hourly: true,
          last_attempted_at: "2026-11-27T05:00:00Z",
        },
        allSlots: [slotZero],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-27T06:00:00Z"),
      }).shouldSubmit,
      false
    );

    // Hourly triggers when slot > 0 and >= 55 mins since last attempt
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: true,
          lock_status: "idle",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: false,
          submit_at_midnight: false,
          submit_hourly: true,
          last_attempted_at: "2026-11-27T05:00:00Z",
        },
        allSlots: [slotOpen],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-27T06:00:00Z"),
      }).reason,
      "hourly"
    );

    // Submitted profile NEVER auto-submits again
    assert.equal(
      shouldAutoSubmitProfile({
        profile: {
          is_armed: false,
          lock_status: "submitted",
          franchise_type_code: "E_TNVS",
          region_name: "National Capital Region (NCR)",
          province_name: null,
          number_of_units: 1,
          submit_on_slot_increase: true,
          submit_at_midnight: true,
          submit_hourly: true,
          last_attempted_at: null,
        },
        allSlots: [slotOpen],
        prevRemainingMap: new Map(),
        now: new Date("2026-11-27T16:05:00Z"),
      }).shouldSubmit,
      false
    );
  });

  it("matches MUCEP AREA via regionCode while preventing cross-region matches on Any Point in the Region", () => {
    const [ncrRegion] = normalizeRegionSlots([
      {
        region_id: "r-ncr",
        region_code: "1300000000",
        region_name: "National Capital Region (NCR)",
        total_slots: 100,
        remaining: 1,
        filed_application: 99,
        percentage: 99,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);
    const [reg8Region] = normalizeRegionSlots([
      {
        region_id: "r-8",
        region_code: "0800000000",
        region_name: "Region VIII (Eastern Visayas)",
        total_slots: 200,
        remaining: 0,
        filed_application: 200,
        percentage: 100,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);
    const [reg7Region] = normalizeRegionSlots([
      {
        region_id: "r-7",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 200,
        remaining: 5,
        filed_application: 195,
        percentage: 97.5,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);

    const [mucepProv] = normalizeProvinceSlots([
      {
        province_id: "p-mucep",
        province_code: "1300000001",
        province_name: "MUCEP AREA",
        region_code: "1300000000",
        region_name: "MUCEP AREA",
        total_slots: 100,
        remaining: 2,
        filed_application: 98,
        percentage: 98,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);
    const [reg7AnyPoint] = normalizeProvinceSlots([
      {
        province_id: "p-any-7",
        province_code: "0700000003",
        province_name: "Any Point in the Region",
        region_code: "0700000000",
        region_name: "Region VII (Central Visayas)",
        total_slots: 200,
        remaining: 5,
        filed_application: 195,
        percentage: 97.5,
        franchise_type: { code: "E_TNVS", name: "E-TNVS" },
      },
    ]);

    // NCR profile with MUCEP AREA must still match despite region_name mismatch on LTFRB province endpoint
    const mucepDecision = shouldAutoSubmitProfile({
      profile: {
        is_armed: true,
        lock_status: "idle",
        franchise_type_code: "E_TNVS",
        region_name: "National Capital Region (NCR)",
        province_name: "MUCEP AREA",
        number_of_units: 1,
        submit_on_slot_increase: false,
        submit_at_midnight: false,
        submit_hourly: true,
        last_attempted_at: null,
      },
      allSlots: [ncrRegion, mucepProv],
      prevRemainingMap: new Map(),
      now: new Date("2026-11-27T06:00:00Z"),
    });
    assert.equal(mucepDecision.shouldSubmit, true);

    // Region VIII "Any Point in the Region" must NOT trigger when Region VII "Any Point in the Region" opens
    const wrongRegionDecision = shouldAutoSubmitProfile({
      profile: {
        is_armed: true,
        lock_status: "idle",
        franchise_type_code: "E_TNVS",
        region_name: "Region VIII (Eastern Visayas)",
        province_name: "Any Point in the Region",
        number_of_units: 1,
        submit_on_slot_increase: false,
        submit_at_midnight: false,
        submit_hourly: true,
        last_attempted_at: null,
      },
      allSlots: [reg8Region, reg7Region, reg7AnyPoint],
      prevRemainingMap: new Map(),
      now: new Date("2026-11-27T06:00:00Z"),
    });
    assert.equal(wrongRegionDecision.shouldSubmit, false);
  });

  it("normalizes submission log triggers from columns or raw_response fallback", () => {
    const colRow = normalizeSubmissionLogRow({
      id: "log-1",
      application_profile_id: "prof-1",
      attempted_at: "2026-11-27T08:42:00Z",
      http_status: 422,
      result: "full_slot",
      reference_number: null,
      message: "Full",
      trigger_type: "slot_increased",
      trigger_detail: "Triggered by slot increase (381 → 383, +2) on Nov 27, 4:42 PM",
    });
    assert.equal(colRow.trigger_type, "slot_increased");
    assert.equal(
      formatSubmissionTriggerDisplay(colRow).badgeLabel,
      "Triggered by Slot Increase"
    );

    const fallbackRaw = attachTriggerToRawResponse(
      { errors: [{ status: "422" }] },
      {
        triggerType: "scheduled_hours",
        triggerDetail: "Triggered by scheduled TIME (7:00 AM Manila) at Nov 27, 7:00 AM",
      }
    );
    const fbRow = normalizeSubmissionLogRow({
      id: "log-2",
      application_profile_id: "prof-1",
      attempted_at: "2026-11-26T23:00:00Z",
      http_status: 422,
      result: "full_slot",
      reference_number: null,
      message: "Full",
      raw_response: fallbackRaw,
    });
    assert.equal(fbRow.trigger_type, "scheduled_hours");
    assert.equal(
      formatSubmissionTriggerDisplay(fbRow).badgeLabel,
      "Triggered by Scheduled TIME"
    );
    assert.match(formatSubmissionTriggerDisplay(fbRow).detailText ?? "", /7:00 AM/);
  });
});
