import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attemptSlotReservation, type ReservationDeps } from "@/lib/ltfrb/reservation";
import type { ApplicationProfile } from "@/lib/ltfrb/types";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";

interface MockDbState {
  profile: ApplicationProfile;
  account: {
    id: string;
    website_id: string;
    user_id: string;
    account_type: "operator";
    ltfrb_email: string;
    encrypted_password: string;
    encrypted_token: string | null;
  };
  logs: Array<Record<string, unknown>>;
}

function createMockSupabase(state: MockDbState): SupabaseClient {
  return {
    from(table: string) {
      if (table === "ltfrb_application_profiles") {
        let mode: "select" | "update" = "select";
        let patch: Record<string, unknown> = {};
        const filters: Record<string, unknown> = {};

        const builder = {
          update(values: Record<string, unknown>) {
            mode = "update";
            patch = values;
            return builder;
          },
          select() {
            return builder;
          },
          eq(col: string, val: unknown) {
            filters[col] = val;
            return builder;
          },
          async maybeSingle() {
            if (
              mode === "update" &&
              filters.id === state.profile.id &&
              filters.website_id === state.profile.website_id &&
              (filters.lock_status === undefined ||
                filters.lock_status === state.profile.lock_status)
            ) {
              Object.assign(state.profile, patch);
              return { data: { ...state.profile }, error: null };
            }
            return { data: null, error: null };
          },
          then(resolve: (value: { data: unknown; error: null }) => void) {
            if (mode === "update" && filters.id === state.profile.id) {
              Object.assign(state.profile, patch);
            }
            resolve({ data: { ...state.profile }, error: null });
          },
        };
        return builder;
      }

      if (table === "ltfrb_accounts") {
        const builder = {
          select() {
            return builder;
          },
          update(values: Record<string, unknown>) {
            Object.assign(state.account, values);
            return builder;
          },
          eq() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          async maybeSingle() {
            return { data: { ...state.account }, error: null };
          },
          then(resolve: (value: { data: unknown; error: null }) => void) {
            resolve({ data: { ...state.account }, error: null });
          },
        };
        return builder;
      }

      if (table === "ltfrb_submission_logs") {
        return {
          async insert(row: Record<string, unknown>) {
            state.logs.push(row);
            return { data: row, error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
}

function makeDeps(
  state: MockDbState,
  overrides: Partial<ReservationDeps> = {}
): ReservationDeps {
  const key = crypto.randomBytes(32).toString("base64");
  state.account.encrypted_password = encryptSecret("secret-pass", key);
  if (state.account.encrypted_token) {
    state.account.encrypted_token = encryptSecret("tok-initial", key);
  }

  return {
    getContext: () => ({
      supabase: createMockSupabase(state),
      websiteId: state.profile.website_id,
    }),
    decrypt: (p) => decryptSecret(p, key),
    encrypt: (p) => encryptSecret(p, key),
    authenticateAccount: async () => ({ ok: true, token: "tok-refreshed" }),
    submitApplication: async () => ({
      httpStatus: 201,
      result: "success",
      message: "Submitted",
      referenceNumber: "CASE-2026-001",
      rawResponse: {},
    }),
    sendSubmissionEmail: async () => ({ sent: true, providerId: "msg-1" }),
    ...overrides,
  };
}

function baseState(): MockDbState {
  const now = new Date().toISOString();
  return {
    profile: {
      id: "prof-1",
      website_id: "web-1",
      user_id: "user-1",
      account_id: "acct-1",
      watch_rule_id: null,
      profile_name: "My Vios TNVS",
      franchise_type_code: "TNVS",
      region_id: "reg-ncr",
      region_name: "National Capital Region (NCR)",
      province_id: null,
      province_name: null,
      route_id: null,
      route_name: null,
      number_of_units: 1,
      is_fleet: false,
      units: [
        {
          plate_number: "ABC1234",
          mv_file_number: "1301-12345",
          make: "Toyota",
          series: "Vios",
          year_model: 2024,
          body_type: "Sedan",
          engine_number: "ENG123",
          chassis_number: "CHS123",
          documents: { sales_invoice_file: "https://cdn.example.com/si.pdf" },
        },
      ],
      custom_documents: {},
      notify_email: "owner@example.com",
      lock_status: "idle",
      is_armed: true,
      submit_on_slot_increase: true,
      submit_at_midnight: false,
      submit_hourly: false,
      submitted_reference: null,
      last_error: null,
      last_attempted_at: null,
      created_at: now,
      updated_at: now,
    },
    account: {
      id: "acct-1",
      website_id: "web-1",
      user_id: "user-1",
      account_type: "operator",
      ltfrb_email: "owner@example.com",
      encrypted_password: "",
      encrypted_token: "has-token",
    },
    logs: [],
  };
}

describe("atomic slot reservation lock and outcomes", () => {
  it("prevents duplicate concurrent submissions via atomic lock", async () => {
    const state = baseState();
    let submitCalls = 0;

    const deps = makeDeps(state, {
      submitApplication: async () => {
        submitCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          httpStatus: 201,
          result: "success",
          message: "Submitted",
          referenceNumber: "CASE-2026-777",
          rawResponse: {},
        };
      },
    });

    const [first, second] = await Promise.all([
      attemptSlotReservation({ profileId: "prof-1", userId: "user-1" }, deps),
      attemptSlotReservation({ profileId: "prof-1", userId: "user-1" }, deps),
    ]);

    assert.equal(submitCalls, 1);
    const results = [first.result, second.result].sort();
    assert.deepEqual(results, ["locked", "success"]);
    assert.equal(state.profile.lock_status, "submitted");
    assert.equal(state.profile.is_armed, false);
    assert.equal(state.profile.submit_on_slot_increase, false);
    assert.equal(state.profile.submit_at_midnight, false);
    assert.equal(state.profile.submit_hourly, false);
    assert.equal(state.profile.submitted_reference, "CASE-2026-777");
  });

  it("releases lock, stays armed, and emails return message when LTFRB returns full_slot", async () => {
    const state = baseState();
    let emailedMsg = "";
    const deps = makeDeps(state, {
      submitApplication: async () => ({
        httpStatus: 422,
        result: "full_slot",
        message: "Slots are currently full.",
        referenceNumber: null,
        rawResponse: {},
      }),
      sendSubmissionEmail: async (emailParams) => {
        emailedMsg = emailParams.message;
        return { sent: true, providerId: "msg-full" };
      },
    });

    const outcome = await attemptSlotReservation(
      { profileId: "prof-1", userId: "user-1" },
      deps
    );

    assert.equal(outcome.result, "full_slot");
    assert.equal(emailedMsg, "Slots are currently full.");
    assert.equal(state.profile.lock_status, "idle");
    assert.equal(state.profile.is_armed, true);
    assert.equal(state.logs.length, 1);
    assert.equal(state.logs[0].result, "full_slot");
  });

  it("refreshes expired token on 401 auth_error and retries once", async () => {
    const state = baseState();
    let attempts = 0;
    let emailsSent = 0;

    const deps = makeDeps(state, {
      submitApplication: async (token) => {
        attempts++;
        if (attempts === 1) {
          return {
            httpStatus: 401,
            result: "auth_error",
            message: "Token expired",
            referenceNumber: null,
            rawResponse: {},
          };
        }
        assert.equal(token, "tok-refreshed");
        return {
          httpStatus: 201,
          result: "success",
          message: "Submitted after refresh",
          referenceNumber: "CASE-2026-888",
          rawResponse: {},
        };
      },
      sendSubmissionEmail: async () => {
        emailsSent++;
        return { sent: true, providerId: "msg-2" };
      },
    });

    const outcome = await attemptSlotReservation(
      { profileId: "prof-1", userId: "user-1" },
      deps
    );

    assert.equal(attempts, 2);
    assert.equal(emailsSent, 1);
    assert.equal(outcome.result, "success");
    assert.equal(outcome.referenceNumber, "CASE-2026-888");
  });

  it("disarms auto-submit and emails safety message on HTTP 403, 409, or 429", async () => {
    for (const status of [403, 409, 429] as const) {
      const state = baseState();
      state.profile.submit_hourly = true;
      let calls = 0;
      let safetyEmailSent = false;

      const deps = makeDeps(state, {
        submitApplication: async () => {
          calls++;
          return {
            httpStatus: status,
            result: status === 403 ? "auth_error" : status === 409 ? "validation_error" : "network_error",
            message: `Blocked or conflict (${status})`,
            referenceNumber: null,
            rawResponse: {},
          };
        },
        sendSubmissionEmail: async (emailParams) => {
          safetyEmailSent = Boolean(emailParams.safetyStopped);
          return { sent: true, providerId: "msg-stop" };
        },
      });

      const outcome = await attemptSlotReservation(
        { profileId: "prof-1", userId: "user-1" },
        deps
      );

      assert.equal(calls, 1);
      assert.equal(safetyEmailSent, true);
      assert.equal(state.profile.lock_status, "idle");
      assert.equal(state.profile.is_armed, false);
      assert.equal(state.profile.submit_hourly, false);
      assert.match(outcome.message, new RegExp(`HTTP ${status}`));
    }
  });
});
