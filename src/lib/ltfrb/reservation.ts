import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateLtfrbAccount,
  submitOperatorApplication,
  type SubmissionOutcomeType,
} from "@/lib/ltfrb/client";
import type { ApplicationProfile } from "@/lib/ltfrb/types";
import { sendSubmissionOutcomeEmail } from "@/lib/notifications/email";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { getTenantContext } from "@/lib/supabase/server";

export interface ReservationAttemptSummary {
  profileId: string;
  profileName: string;
  result: SubmissionOutcomeType | "locked" | "missing_account";
  message: string;
  referenceNumber: string | null;
}

export interface ReservationDeps {
  getContext: () => { supabase: SupabaseClient; websiteId: string };
  submitApplication: typeof submitOperatorApplication;
  authenticateAccount: typeof authenticateLtfrbAccount;
  sendSubmissionEmail: typeof sendSubmissionOutcomeEmail;
  decrypt: (payload: string) => string;
  encrypt: (plaintext: string) => string;
}

const DEFAULT_DEPS: ReservationDeps = {
  getContext: getTenantContext,
  submitApplication: submitOperatorApplication,
  authenticateAccount: authenticateLtfrbAccount,
  sendSubmissionEmail: sendSubmissionOutcomeEmail,
  decrypt: (p) => decryptSecret(p),
  encrypt: (p) => encryptSecret(p),
};

export async function attemptSlotReservation(
  params: { profileId: string; userId?: string },
  deps: ReservationDeps = DEFAULT_DEPS
): Promise<ReservationAttemptSummary> {
  const { supabase, websiteId } = deps.getContext();
  const now = new Date().toISOString();

  // 1. Acquire atomic lock: idle -> submitting
  let lockQuery = supabase
    .from("ltfrb_application_profiles")
    .update({
      lock_status: "submitting",
      last_attempted_at: now,
      updated_at: now,
    })
    .eq("id", params.profileId)
    .eq("website_id", websiteId)
    .eq("lock_status", "idle");

  if (params.userId) {
    lockQuery = lockQuery.eq("user_id", params.userId);
  }

  const { data: lockedProfile, error: lockErr } = await lockQuery.select("*").maybeSingle();

  if (lockErr || !lockedProfile) {
    return {
      profileId: params.profileId,
      profileName: "Reservation Profile",
      result: "locked",
      message: "This reservation is either already submitting or has already been submitted.",
      referenceNumber: null,
    };
  }

  const profile = lockedProfile as ApplicationProfile;

  const releaseLock = async (
    nextStatus: "idle" | "submitted",
    updates: Record<string, unknown> = {}
  ) => {
    await supabase
      .from("ltfrb_application_profiles")
      .update({
        lock_status: nextStatus,
        updated_at: new Date().toISOString(),
        ...updates,
      })
      .eq("id", profile.id)
      .eq("website_id", websiteId);
  };

  try {
    // 2. Load the user's saved LTFRB account
    let accountQuery = supabase
      .from("ltfrb_accounts")
      .select("*")
      .eq("website_id", websiteId)
      .eq("user_id", profile.user_id);

    if (profile.account_id) {
      accountQuery = accountQuery.eq("id", profile.account_id);
    } else {
      accountQuery = accountQuery.order("updated_at", { ascending: false }).limit(1);
    }

    const { data: accountRow } = await accountQuery.maybeSingle();

    if (!accountRow) {
      const msg = "No saved LTFRB account found. Please save your LTFRB login first.";
      await releaseLock("idle", { last_error: msg });
      return {
        profileId: profile.id,
        profileName: profile.profile_name,
        result: "missing_account",
        message: msg,
        referenceNumber: null,
      };
    }

    let token: string | null = accountRow.encrypted_token
      ? deps.decrypt(accountRow.encrypted_token as string)
      : null;

    const refreshToken = async (): Promise<{ ok: boolean; token?: string; message?: string }> => {
      const password = deps.decrypt(accountRow.encrypted_password as string);
      const auth = await deps.authenticateAccount({
        accountType: (accountRow.account_type as "operator" | "tnc") ?? "operator",
        email: accountRow.ltfrb_email as string,
        password,
      });
      if (auth.ok && auth.token) {
        await supabase
          .from("ltfrb_accounts")
          .update({
            encrypted_token: deps.encrypt(auth.token),
            last_verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", accountRow.id)
          .eq("website_id", websiteId);
      }
      return auth;
    };

    if (!token) {
      const refreshed = await refreshToken();
      if (!refreshed.ok || !refreshed.token) {
        const msg = refreshed.message ?? "Could not sign in to LTFRB with your saved credentials.";
        await supabase.from("ltfrb_submission_logs").insert({
          website_id: websiteId,
          user_id: profile.user_id,
          application_profile_id: profile.id,
          watch_rule_id: profile.watch_rule_id,
          result: "auth_error",
          message: msg,
        });
        await releaseLock("idle", { last_error: msg });
        const emailTo = profile.notify_email || (accountRow.ltfrb_email as string);
        if (emailTo) {
          await deps.sendSubmissionEmail({
            to: emailTo,
            profileName: profile.profile_name,
            franchiseTypeCode: profile.franchise_type_code,
            regionName: profile.region_name,
            provinceName: profile.province_name,
            result: "auth_error",
            httpStatus: 401,
            message: msg,
            referenceNumber: null,
            attemptedAtIso: new Date().toISOString(),
          });
        }
        return {
          profileId: profile.id,
          profileName: profile.profile_name,
          result: "auth_error",
          message: msg,
          referenceNumber: null,
        };
      }
      token = refreshed.token;
    }

    const normalizedUnits = (profile.units ?? []).map((u) => {
      const docs = u.documents ?? {};
      return {
        ...u,
        engine_number: (u.engine_number ?? "").trim(),
        body_type: u.body_type || "Sedan",
        documents: {
          affidavit_file: docs.affidavit_file ?? null,
          cr_file: docs.cr_file ?? null,
          delivery_receipt: docs.delivery_receipt ?? null,
          or_file: docs.or_file ?? null,
          sales_invoice_file: docs.sales_invoice_file ?? null,
          unit_photo_file: docs.unit_photo_file ?? null,
        },
      };
    });

    const hasCustomDocs =
      profile.custom_documents && Object.keys(profile.custom_documents).length > 0;

    const payload = {
      franchise_type: profile.franchise_type_code,
      is_fleet: profile.is_fleet,
      number_of_units: profile.number_of_units,
      province_id: profile.province_id ?? "",
      region_id: profile.region_id,
      route_id: profile.route_id ?? "",
      units: normalizedUnits,
      ...(hasCustomDocs ? { custom_documents: profile.custom_documents } : {}),
    };

    let outcome = await deps.submitApplication(token, payload);

    // Retry once with fresh login only on 401 expired token (never retry 403/409/429)
    if (outcome.result === "auth_error" && outcome.httpStatus === 401) {
      const refreshed = await refreshToken();
      if (refreshed.ok && refreshed.token) {
        outcome = await deps.submitApplication(refreshed.token, payload);
      }
    }

    await supabase.from("ltfrb_submission_logs").insert({
      website_id: websiteId,
      user_id: profile.user_id,
      application_profile_id: profile.id,
      watch_rule_id: profile.watch_rule_id,
      http_status: outcome.httpStatus,
      result: outcome.result,
      reference_number: outcome.referenceNumber,
      message: outcome.message,
      raw_response: outcome.rawResponse,
    });

    const safetyStopStatuses = new Set([403, 409, 429]);
    const shouldSafetyStop =
      outcome.httpStatus !== null && safetyStopStatuses.has(outcome.httpStatus);

    const emailTo = profile.notify_email || (accountRow.ltfrb_email as string);

    if (outcome.result === "success") {
      await releaseLock("submitted", {
        is_armed: false,
        submit_on_slot_increase: false,
        submit_at_midnight: false,
        submit_hourly: false,
        submitted_reference: outcome.referenceNumber,
        last_error: null,
      });

      if (emailTo) {
        await deps.sendSubmissionEmail({
          to: emailTo,
          profileName: profile.profile_name,
          franchiseTypeCode: profile.franchise_type_code,
          regionName: profile.region_name,
          provinceName: profile.province_name,
          result: "success",
          httpStatus: outcome.httpStatus,
          message: outcome.message,
          referenceNumber: outcome.referenceNumber,
          attemptedAtIso: new Date().toISOString(),
        });
      }
    } else if (shouldSafetyStop) {
      const safetyMsg = `Paused automatic submission for safety after LTFRB returned HTTP ${outcome.httpStatus}: ${outcome.message}`;
      await releaseLock("idle", {
        is_armed: false,
        submit_hourly: false,
        last_error: safetyMsg,
      });

      if (emailTo) {
        await deps.sendSubmissionEmail({
          to: emailTo,
          profileName: profile.profile_name,
          franchiseTypeCode: profile.franchise_type_code,
          regionName: profile.region_name,
          provinceName: profile.province_name,
          result: outcome.result,
          httpStatus: outcome.httpStatus,
          message: safetyMsg,
          referenceNumber: null,
          safetyStopped: true,
          attemptedAtIso: new Date().toISOString(),
        });
      }

      return {
        profileId: profile.id,
        profileName: profile.profile_name,
        result: outcome.result,
        message: safetyMsg,
        referenceNumber: null,
      };
    } else {
      await releaseLock("idle", { last_error: outcome.message });

      if (emailTo) {
        await deps.sendSubmissionEmail({
          to: emailTo,
          profileName: profile.profile_name,
          franchiseTypeCode: profile.franchise_type_code,
          regionName: profile.region_name,
          provinceName: profile.province_name,
          result: outcome.result,
          httpStatus: outcome.httpStatus,
          message: outcome.message,
          referenceNumber: outcome.referenceNumber,
          attemptedAtIso: new Date().toISOString(),
        });
      }
    }

    return {
      profileId: profile.id,
      profileName: profile.profile_name,
      result: outcome.result,
      message: outcome.message,
      referenceNumber: outcome.referenceNumber,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected error during reservation.";
    await releaseLock("idle", { last_error: msg });
    return {
      profileId: profile.id,
      profileName: profile.profile_name,
      result: "network_error",
      message: msg,
      referenceNumber: null,
    };
  }
}
