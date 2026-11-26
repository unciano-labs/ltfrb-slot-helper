export const MAX_MONITORED_FRANCHISES = 2;

export function normalizeSelectedFranchises(codes: unknown): {
  valid: boolean;
  codes: string[];
  error?: string;
} {
  if (!Array.isArray(codes)) {
    return {
      valid: false,
      codes: [],
      error: "Please pick 1 or 2 franchise types.",
    };
  }

  const unique = Array.from(
    new Set(
      codes
        .map((c) => String(c ?? "").trim())
        .filter((c) => c.length > 0 && c !== "ALL")
    )
  );

  if (unique.length === 0) {
    return {
      valid: false,
      codes: [],
      error: "Please pick at least 1 franchise type to monitor.",
    };
  }

  if (unique.length > MAX_MONITORED_FRANCHISES) {
    return {
      valid: false,
      codes: unique.slice(0, MAX_MONITORED_FRANCHISES),
      error: `You can monitor up to ${MAX_MONITORED_FRANCHISES} franchise types per account. Please uncheck one first.`,
    };
  }

  return { valid: true, codes: unique };
}

export function isFranchiseAllowedForAccount(
  franchiseTypeCode: string,
  monitoredCodes: string[]
): boolean {
  if (!franchiseTypeCode || franchiseTypeCode === "ALL") return false;
  if (monitoredCodes.length === 0) return false;
  return monitoredCodes.slice(0, MAX_MONITORED_FRANCHISES).includes(franchiseTypeCode);
}
