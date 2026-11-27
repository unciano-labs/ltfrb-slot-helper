import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateLtfrbAccount,
  submitOperatorApplication,
  uploadLtfrbDocument,
  VEHICLE_DOCS_STORAGE_BUCKET,
  verifyDocumentUrlAccessible,
  type SubmissionOutcomeType,
} from "@/lib/ltfrb/client";
import type {
  ApplicationProfile,
  SubmissionTriggerType,
  UnitDocumentKey,
  VehicleUnitInput,
} from "@/lib/ltfrb/types";
import {
  attachTriggerToRawResponse,
  type SubmissionTriggerMeta,
} from "@/lib/monitor/submission-trigger";
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
  verifyDocumentUrl: (url: string) => Promise<boolean>;
  downloadBackupPdf: (storagePath: string) => Promise<{ blob: Blob; filename: string } | null>;
  uploadDocument: typeof uploadLtfrbDocument;
  decrypt: (payload: string) => string;
  encrypt: (plaintext: string) => string;
}

const DEFAULT_DEPS: ReservationDeps = {
  getContext: getTenantContext,
  submitApplication: submitOperatorApplication,
  authenticateAccount: authenticateLtfrbAccount,
  sendSubmissionEmail: sendSubmissionOutcomeEmail,
  verifyDocumentUrl: verifyDocumentUrlAccessible,
  downloadBackupPdf: async (storagePath: string) => {
    const { supabase } = getTenantContext();
    const { data, error } = await supabase.storage
      .from(VEHICLE_DOCS_STORAGE_BUCKET)
      .download(storagePath);
    if (error || !data) return null;
    const filename = storagePath.split("/").pop() || "document.pdf";
    return { blob: data, filename };
  },
  uploadDocument: uploadLtfrbDocument,
  decrypt: (p) => decryptSecret(p),
  encrypt: (p) => encryptSecret(p),
};

const ALL_DOCUMENT_KEYS: UnitDocumentKey[] = [
  "sales_invoice_file",
  "or_file",
  "cr_file",
  "affidavit_file",
  "delivery_receipt",
  "unit_photo_file",
];

async function insertSubmissionLog(
  supabase: SupabaseClient,
  row: {
    website_id: string;
    user_id: string;
    application_profile_id: string;
    watch_rule_id: string | null;
    http_status?: number | null;
    result: string;
    reference_number?: string | null;
    message: string;
    raw_response?: unknown;
  },
  triggerMeta: SubmissionTriggerMeta | null
): Promise<void> {
  const payload = triggerMeta
    ? {
        ...row,
        trigger_type: triggerMeta.triggerType,
        trigger_detail: triggerMeta.triggerDetail,
      }
    : row;

  const { error } = await supabase.from("ltfrb_submission_logs").insert(payload);

  // Graceful fallback if migration 007 (trigger_type / trigger_detail columns) is not applied yet
  if (error && triggerMeta && (error.code === "42703" || error.code === "PGRST204")) {
    await supabase.from("ltfrb_submission_logs").insert({
      ...row,
      raw_response: attachTriggerToRawResponse(row.raw_response, triggerMeta),
    });
  }
}

export async function attemptSlotReservation(
  params: {
    profileId: string;
    userId?: string;
    triggerType?: SubmissionTriggerType;
    triggerDetail?: string;
  },
  deps: ReservationDeps = DEFAULT_DEPS
): Promise<ReservationAttemptSummary> {
  const { supabase, websiteId } = deps.getContext();
  const now = new Date().toISOString();
  const triggerMeta: SubmissionTriggerMeta | null = params.triggerType
    ? {
        triggerType: params.triggerType,
        triggerDetail: params.triggerDetail ?? "",
      }
    : null;

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
        await insertSubmissionLog(
          supabase,
          {
            website_id: websiteId,
            user_id: profile.user_id,
            application_profile_id: profile.id,
            watch_rule_id: profile.watch_rule_id,
            result: "auth_error",
            message: msg,
          },
          triggerMeta
        );
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

    // Ensure every uploaded PDF URL is still valid (not expired on LTFRB S3).
    // If any URL returns AccessDenied/expired, re-upload our private Supabase backup copy first!
    const workingUnits: VehicleUnitInput[] = (profile.units ?? []).map((u) => ({
      ...u,
      documents: { ...(u.documents ?? {}) },
      document_storage_paths: { ...(u.document_storage_paths ?? {}) },
    }));
    let unitsRefreshed = false;

    for (let i = 0; i < workingUnits.length; i += 1) {
      const unit = workingUnits[i];
      const docs = unit.documents ?? {};
      const paths = unit.document_storage_paths ?? {};

      for (const docKey of ALL_DOCUMENT_KEYS) {
        const currentUrl = docs[docKey];
        if (!currentUrl || typeof currentUrl !== "string" || !currentUrl.trim()) continue;

        const isValid = await deps.verifyDocumentUrl(currentUrl);
        if (isValid) continue;

        const backupPath = paths[docKey];
        if (!backupPath) {
          const unitLabel = workingUnits.length > 1 ? `Unit ${i + 1} ` : "";
          const msg = `${unitLabel}uploaded PDF (${docKey}) expired on LTFRB and no backup copy exists. Please open Auto-Reserve and re-upload that PDF once so future submissions can auto-refresh it.`;
          await insertSubmissionLog(
            supabase,
            {
              website_id: websiteId,
              user_id: profile.user_id,
              application_profile_id: profile.id,
              watch_rule_id: profile.watch_rule_id,
              result: "validation_error",
              message: msg,
            },
            triggerMeta
          );
          await releaseLock("idle", { is_armed: false, last_error: msg });
          const notifyAddr = profile.notify_email || (accountRow.ltfrb_email as string);
          if (notifyAddr) {
            await deps.sendSubmissionEmail({
              to: notifyAddr,
              profileName: profile.profile_name,
              franchiseTypeCode: profile.franchise_type_code,
              regionName: profile.region_name,
              provinceName: profile.province_name,
              result: "validation_error",
              httpStatus: null,
              message: msg,
              referenceNumber: null,
              attemptedAtIso: new Date().toISOString(),
            });
          }
          return {
            profileId: profile.id,
            profileName: profile.profile_name,
            result: "validation_error",
            message: msg,
            referenceNumber: null,
          };
        }

        const backup = await deps.downloadBackupPdf(backupPath);
        if (!backup) {
          const unitLabel = workingUnits.length > 1 ? `Unit ${i + 1} ` : "";
          const msg = `${unitLabel}backup PDF (${docKey}) could not be read from storage. Please re-upload the PDF under Auto-Reserve.`;
          await insertSubmissionLog(
            supabase,
            {
              website_id: websiteId,
              user_id: profile.user_id,
              application_profile_id: profile.id,
              watch_rule_id: profile.watch_rule_id,
              result: "validation_error",
              message: msg,
            },
            triggerMeta
          );
          await releaseLock("idle", { is_armed: false, last_error: msg });
          return {
            profileId: profile.id,
            profileName: profile.profile_name,
            result: "validation_error",
            message: msg,
            referenceNumber: null,
          };
        }

        let reupload = await deps.uploadDocument({
          token,
          file: backup.blob,
          filename: backup.filename,
        });

        if (!reupload.ok && (reupload.httpStatus === 401 || reupload.httpStatus === 403)) {
          const refreshed = await refreshToken();
          if (refreshed.ok && refreshed.token) {
            token = refreshed.token;
            reupload = await deps.uploadDocument({
              token,
              file: backup.blob,
              filename: backup.filename,
            });
          }
        }

        if (!reupload.ok || !reupload.url) {
          const outcomeType =
            reupload.httpStatus === 401 || reupload.httpStatus === 403
              ? "auth_error"
              : "network_error";
          const msg = `Could not re-upload expired ${docKey} to LTFRB before submitting: ${reupload.message}`;
          await insertSubmissionLog(
            supabase,
            {
              website_id: websiteId,
              user_id: profile.user_id,
              application_profile_id: profile.id,
              watch_rule_id: profile.watch_rule_id,
              http_status: reupload.httpStatus,
              result: outcomeType,
              message: msg,
            },
            triggerMeta
          );
          await releaseLock("idle", { last_error: msg });
          return {
            profileId: profile.id,
            profileName: profile.profile_name,
            result: outcomeType,
            message: msg,
            referenceNumber: null,
          };
        }

        docs[docKey] = reupload.url;
        unit.documents = docs;
        unitsRefreshed = true;
      }
    }

    if (unitsRefreshed) {
      await supabase
        .from("ltfrb_application_profiles")
        .update({
          units: workingUnits,
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id)
        .eq("website_id", websiteId);
    }

    const normalizedUnits = workingUnits.map((u) => {
      const { document_storage_paths: _omitPaths, ...rest } = u;
      void _omitPaths;
      const docs = u.documents ?? {};
      return {
        ...rest,
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

    await insertSubmissionLog(
      supabase,
      {
        website_id: websiteId,
        user_id: profile.user_id,
        application_profile_id: profile.id,
        watch_rule_id: profile.watch_rule_id,
        http_status: outcome.httpStatus,
        result: outcome.result,
        reference_number: outcome.referenceNumber,
        message: outcome.message,
        raw_response: outcome.rawResponse,
      },
      triggerMeta
    );

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
