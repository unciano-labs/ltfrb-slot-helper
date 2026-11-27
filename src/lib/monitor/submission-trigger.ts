import type { SubmissionLogRow, SubmissionTriggerType } from "@/lib/ltfrb/types";

export interface SubmissionTriggerMeta {
  triggerType: SubmissionTriggerType;
  triggerDetail: string;
}

export interface SubmissionTriggerDisplay {
  badgeLabel: string;
  badgeStyle: string;
  detailText: string | null;
}

const VALID_TRIGGER_TYPES = new Set<SubmissionTriggerType>([
  "slot_increased",
  "scheduled_hours",
  "hourly",
  "manual",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Formats a Date into concise Manila Time (e.g. "Nov 27, 4:42 PM").
 */
export function formatManilaShortTimestamp(date: Date): string {
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Embeds fallback trigger metadata inside `raw_response` if dedicated columns
 * (`trigger_type`, `trigger_detail`) are not yet present in Postgres.
 */
export function attachTriggerToRawResponse(
  rawResponse: unknown,
  meta: SubmissionTriggerMeta
): Record<string, unknown> {
  const triggerPayload = {
    trigger_type: meta.triggerType,
    trigger_detail: meta.triggerDetail,
  };
  if (isPlainObject(rawResponse)) {
    return { ...rawResponse, _trigger: triggerPayload };
  }
  return { _trigger: triggerPayload, response: rawResponse ?? null };
}

/**
 * Normalizes a `ltfrb_submission_logs` database row, reading `trigger_type`
 * and `trigger_detail` from columns first and falling back to `raw_response._trigger`.
 */
export function normalizeSubmissionLogRow(row: Record<string, unknown>): SubmissionLogRow {
  const colType = typeof row.trigger_type === "string" ? row.trigger_type : null;
  const colDetail = typeof row.trigger_detail === "string" ? row.trigger_detail : null;

  let triggerType: SubmissionTriggerType | null =
    colType && VALID_TRIGGER_TYPES.has(colType as SubmissionTriggerType)
      ? (colType as SubmissionTriggerType)
      : null;
  let triggerDetail: string | null = colDetail;

  if ((!triggerType || !triggerDetail) && isPlainObject(row.raw_response)) {
    const embedded = row.raw_response._trigger;
    if (isPlainObject(embedded)) {
      const embType = typeof embedded.trigger_type === "string" ? embedded.trigger_type : null;
      const embDetail =
        typeof embedded.trigger_detail === "string" ? embedded.trigger_detail : null;
      if (!triggerType && embType && VALID_TRIGGER_TYPES.has(embType as SubmissionTriggerType)) {
        triggerType = embType as SubmissionTriggerType;
      }
      if (!triggerDetail && embDetail) {
        triggerDetail = embDetail;
      }
    }
  }

  return {
    id: String(row.id ?? ""),
    application_profile_id: String(row.application_profile_id ?? ""),
    attempted_at: String(row.attempted_at ?? ""),
    http_status: typeof row.http_status === "number" ? row.http_status : null,
    result: row.result as SubmissionLogRow["result"],
    reference_number: typeof row.reference_number === "string" ? row.reference_number : null,
    message: typeof row.message === "string" ? row.message : null,
    trigger_type: triggerType,
    trigger_detail: triggerDetail,
  };
}

/**
 * Produces senior-friendly badge and detail text showing what triggered an application submission.
 */
export function formatSubmissionTriggerDisplay(
  log: Pick<SubmissionLogRow, "trigger_type" | "trigger_detail">
): SubmissionTriggerDisplay {
  const type = log.trigger_type ?? null;
  const detail = log.trigger_detail ?? null;

  switch (type) {
    case "slot_increased":
      return {
        badgeLabel: "Triggered by Slot Increase",
        badgeStyle: "bg-[#DCFCE7] text-[#14532D]",
        detailText: detail,
      };
    case "scheduled_hours":
      return {
        badgeLabel: "Triggered by Scheduled TIME",
        badgeStyle: "bg-[#FEF3C7] text-[#78350F]",
        detailText: detail,
      };
    case "hourly":
      return {
        badgeLabel: "Triggered by Hourly TIME",
        badgeStyle: "bg-[#DBEAFE] text-[#1E3A8A]",
        detailText: detail,
      };
    case "manual":
      return {
        badgeLabel: "Triggered Manually",
        badgeStyle: "bg-[#E4E4E7] text-[#27272A]",
        detailText: detail,
      };
    default:
      return {
        badgeLabel: "Before Trigger Tracking",
        badgeStyle: "bg-[#E4E4E7] text-[#52525B]",
        detailText: null,
      };
  }
}
