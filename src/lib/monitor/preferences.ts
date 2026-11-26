export const MAX_MONITORED_FRANCHISES = 2;

export function normalizeSelectedFranchises(
  codes: unknown,
  maxAllowed: number = MAX_MONITORED_FRANCHISES
): {
  valid: boolean;
  codes: string[];
  error?: string;
} {
  const cap = Math.max(1, maxAllowed);
  if (!Array.isArray(codes)) {
    return {
      valid: false,
      codes: [],
      error: `Please pick up to ${cap} franchise type${cap === 1 ? "" : "s"}.`,
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

  if (unique.length > cap) {
    return {
      valid: false,
      codes: unique.slice(0, cap),
      error: `Your current plan allows monitoring up to ${cap} franchise type${cap === 1 ? "" : "s"}. Upgrade or add extra alert slots (+₱100 each) to monitor more.`,
    };
  }

  return { valid: true, codes: unique };
}

export function isFranchiseAllowedForAccount(
  franchiseTypeCode: string,
  monitoredCodes: string[],
  maxAllowed: number = MAX_MONITORED_FRANCHISES
): boolean {
  if (!franchiseTypeCode || franchiseTypeCode === "ALL") return false;
  if (monitoredCodes.length === 0) return false;
  const cap = Math.max(1, maxAllowed);
  return monitoredCodes.slice(0, cap).includes(franchiseTypeCode);
}
