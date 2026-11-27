import type {
  FranchiseType,
  LtfrbOptionItem,
  RawFranchiseTypeItem,
  RawProvinceSlotItem,
  RawRegionSlotItem,
  SlotEntry,
  UnitDocuments,
  VehicleUnitInput,
} from "@/lib/ltfrb/types";

export const LTFRB_API_BASE = "https://ws.ltfrb-foa.ph";
const REQUEST_TIMEOUT_MS = 12_000;
const FRANCHISE_TYPES_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const POLITE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://ltfrb-foa.ph",
  Referer: "https://ltfrb-foa.ph/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

let cachedFranchiseTypes: { data: FranchiseType[]; fetchedAtMs: number } | null = null;

function politeDelay(minMs = 350, maxMs = 850): Promise<void> {
  const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLtfrbJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${LTFRB_API_BASE}${path}`, {
      method: "GET",
      headers: POLITE_HEADERS,
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 429 || response.status === 503 || response.status === 403) {
      throw new Error(
        `LTFRB asked us to slow down (HTTP ${response.status}). Skipping this check safely.`
      );
    }

    if (!response.ok) {
      throw new Error(`LTFRB API ${path} responded with HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeRegionSlots(items: RawRegionSlotItem[]): SlotEntry[] {
  return items.map((item) => {
    const ftCode = item.franchise_type?.code ?? "UNKNOWN";
    return {
      scope: "region",
      slotKey: `region:${item.region_code}:${ftCode}`,
      franchiseTypeCode: ftCode,
      franchiseTypeName: item.franchise_type?.name ?? ftCode,
      regionCode: item.region_code,
      regionName: item.region_name,
      provinceCode: null,
      provinceName: null,
      totalSlots: Number(item.total_slots ?? 0),
      remaining: Number(item.remaining ?? 0),
      filedApplication: Number(item.filed_application ?? 0),
      percentage: Number(item.percentage ?? 0),
    };
  });
}

export function normalizeProvinceSlots(items: RawProvinceSlotItem[]): SlotEntry[] {
  return items.map((item) => {
    const ftCode = item.franchise_type?.code ?? "UNKNOWN";
    return {
      scope: "province",
      slotKey: `province:${item.province_code}:${ftCode}`,
      franchiseTypeCode: ftCode,
      franchiseTypeName: item.franchise_type?.name ?? ftCode,
      regionCode: item.region_code,
      regionName: item.region_name,
      provinceCode: item.province_code,
      provinceName: item.province_name,
      totalSlots: Number(item.total_slots ?? 0),
      remaining: Number(item.remaining ?? 0),
      filedApplication: Number(item.filed_application ?? 0),
      percentage: Number(item.percentage ?? 0),
    };
  });
}

export function getCachedFranchiseTypesFromMemory(): FranchiseType[] | null {
  if (
    cachedFranchiseTypes &&
    Date.now() - cachedFranchiseTypes.fetchedAtMs < FRANCHISE_TYPES_TTL_MS
  ) {
    return cachedFranchiseTypes.data;
  }
  return null;
}

export async function fetchFranchiseTypes(): Promise<FranchiseType[]> {
  const cached = getCachedFranchiseTypesFromMemory();
  if (cached) {
    return cached;
  }

  const payload = await fetchLtfrbJson<{ data?: RawFranchiseTypeItem[] }>(
    "/api/v1/public/franchise-types"
  );
  const items = payload.data ?? [];
  const mapped = items.map((item) => ({
    id: item.id,
    code: item.attributes.code,
    specialCode: item.attributes.special_code ?? null,
    name: item.attributes.name,
    maxSlots: item.attributes.max_slots ?? null,
    minSlots: item.attributes.min_slots ?? null,
    fleetMinSlots: item.attributes.fleet_min_slots ?? null,
  }));

  cachedFranchiseTypes = { data: mapped, fetchedAtMs: Date.now() };
  return mapped;
}

export async function fetchLtfrbRegions(franchiseTypeCode?: string): Promise<LtfrbOptionItem[]> {
  const qs = franchiseTypeCode
    ? `?franchise_type_code=${encodeURIComponent(franchiseTypeCode)}`
    : "";
  const payload = await fetchLtfrbJson<{
    data?: Array<{ id: string; attributes: { id: string; code: string; name: string } }>;
  }>(`/api/v1/regions${qs}`);
  return (payload.data ?? []).map((item) => ({
    id: item.attributes.id ?? item.id,
    code: item.attributes.code,
    name: item.attributes.name,
  }));
}

export async function fetchLtfrbProvinces(
  regionCode?: string,
  franchiseTypeCode?: string
): Promise<LtfrbOptionItem[]> {
  const params = new URLSearchParams();
  if (regionCode) params.set("region_code", regionCode);
  if (franchiseTypeCode) params.set("franchise_type_code", franchiseTypeCode);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const payload = await fetchLtfrbJson<{
    data?: Array<{ id: string; attributes: { id: string; code: string; name: string } }>;
  }>(`/api/v1/province${qs}`);
  return (payload.data ?? []).map((item) => ({
    id: item.attributes.id ?? item.id,
    code: item.attributes.code,
    name: item.attributes.name,
  }));
}

export async function fetchLtfrbRoutes(regionId: string): Promise<LtfrbOptionItem[]> {
  const payload = await fetchLtfrbJson<{
    data?: Array<{ id: string; attributes: { id?: string; code?: string; name: string } }>;
  }>(`/api/v1/routes?region_id=${encodeURIComponent(regionId)}`);
  return (payload.data ?? []).map((item) => ({
    id: item.attributes.id ?? item.id,
    code: item.attributes.code ?? item.id,
    name: item.attributes.name,
  }));
}

export async function fetchRegionSlots(): Promise<SlotEntry[]> {
  const payload = await fetchLtfrbJson<{ data?: RawRegionSlotItem[] }>(
    "/api/v1/regions/slot-availability"
  );
  return normalizeRegionSlots(payload.data ?? []);
}

export async function fetchProvinceSlots(): Promise<SlotEntry[]> {
  const payload = await fetchLtfrbJson<{ data?: RawProvinceSlotItem[] }>(
    "/api/v1/province/slot-availability"
  );
  return normalizeProvinceSlots(payload.data ?? []);
}

export async function fetchAllSlots(): Promise<{
  franchiseTypes: FranchiseType[];
  regionSlots: SlotEntry[];
  provinceSlots: SlotEntry[];
}> {
  // Fetch sequentially with a small polite jitter instead of concurrent bursts
  const hadCachedTypes = Boolean(getCachedFranchiseTypesFromMemory());
  const franchiseTypes = await fetchFranchiseTypes();
  if (!hadCachedTypes) {
    await politeDelay();
  }
  const regionSlots = await fetchRegionSlots();
  await politeDelay();
  const provinceSlots = await fetchProvinceSlots();

  return { franchiseTypes, regionSlots, provinceSlots };
}

/**
 * Verifies LTFRB operator/TNC login credentials against ws.ltfrb-foa.ph.
 */
export async function authenticateLtfrbAccount(params: {
  accountType: "operator" | "tnc";
  email: string;
  password: string;
}): Promise<{ ok: boolean; token?: string; message?: string }> {
  const path =
    params.accountType === "tnc" ? "/api/v1/tnc/login" : "/api/v1/operator/login";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${LTFRB_API_BASE}${path}`, {
      method: "POST",
      headers: {
        ...POLITE_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: params.email, password: params.password }),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        ok: false,
        message:
          typeof data.message === "string"
            ? data.message
            : `Login failed (HTTP ${response.status})`,
      };
    }

    const nestedData = data.data as Record<string, unknown> | undefined;
    const nestedAttr = nestedData?.attributes as Record<string, unknown> | undefined;

    const token =
      (typeof data.token === "string" && data.token) ||
      (typeof data.access_token === "string" && data.access_token) ||
      (typeof nestedData?.token === "string" && nestedData.token) ||
      (typeof nestedData?.access_token === "string" && nestedData.access_token) ||
      (typeof nestedAttr?.token === "string" && nestedAttr.token) ||
      undefined;

    return {
      ok: true,
      token,
      message: "Signed in to LTFRB successfully.",
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not reach LTFRB login service.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface OperatorApplicationSubmitPayload {
  franchise_type: string;
  number_of_units: number;
  region_id: string;
  province_id?: string | null;
  route_id?: string | null;
  is_fleet: boolean;
  units: VehicleUnitInput[];
  custom_documents?: Record<string, string>;
}

export type SubmissionOutcomeType =
  | "success"
  | "full_slot"
  | "auth_error"
  | "validation_error"
  | "network_error";

export function classifySubmissionResponse(
  status: number,
  body: Record<string, unknown>
): { result: SubmissionOutcomeType; message: string; referenceNumber: string | null } {
  const dataObj = body.data as Record<string, unknown> | undefined;
  const attrs = dataObj?.attributes as Record<string, unknown> | undefined;

  if (status >= 200 && status < 300) {
    const caseNum =
      (typeof attrs?.case_number === "string" && attrs.case_number) ||
      (typeof dataObj?.id === "string" && dataObj.id) ||
      null;
    return {
      result: "success",
      message: caseNum
        ? `Application submitted! Case Number: ${caseNum}`
        : "Application submitted to LTFRB!",
      referenceNumber: caseNum,
    };
  }

  const apiErrors = Array.isArray(body.errors)
    ? (body.errors as Array<Record<string, unknown>>)
        .map((e) =>
          (typeof e?.detail === "string" && e.detail) ||
          (typeof e?.title === "string" && e.title) ||
          ""
        )
        .filter(Boolean)
        .join(" ")
    : "";

  const rawMsg =
    apiErrors ||
    (typeof body.message === "string" && body.message) ||
    (typeof body.error === "string" && body.error) ||
    JSON.stringify(body);

  if (status === 401 || status === 403) {
    return {
      result: "auth_error",
      message: rawMsg || "LTFRB session expired or unauthorized.",
      referenceNumber: null,
    };
  }

  const lower = rawMsg.toLowerCase();
  if (
    lower.includes("full") ||
    lower.includes("no slot") ||
    lower.includes("no available") ||
    lower.includes("slots") ||
    lower.includes("capacity")
  ) {
    return {
      result: "full_slot",
      message: rawMsg,
      referenceNumber: null,
    };
  }

  return {
    result: "validation_error",
    message: rawMsg || `LTFRB rejected the application (HTTP ${status}).`,
    referenceNumber: null,
  };
}

export async function submitOperatorApplication(
  token: string,
  payload: OperatorApplicationSubmitPayload
): Promise<{
  httpStatus: number | null;
  result: SubmissionOutcomeType;
  message: string;
  referenceNumber: string | null;
  rawResponse: Record<string, unknown>;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${LTFRB_API_BASE}/api/v1/operator/applications`, {
      method: "POST",
      headers: {
        ...POLITE_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawResponse = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const classified = classifySubmissionResponse(response.status, rawResponse);

    return {
      httpStatus: response.status,
      ...classified,
      rawResponse,
    };
  } catch (err) {
    return {
      httpStatus: null,
      result: "network_error",
      message: err instanceof Error ? err.message : "Network error reaching LTFRB.",
      referenceNumber: null,
      rawResponse: {},
    };
  } finally {
    clearTimeout(timer);
  }
}

export function hasValidOwnershipDocument(docs?: UnitDocuments | null): boolean {
  if (!docs) return false;
  const hasSalesInvoice = Boolean(docs.sales_invoice_file?.trim());
  const hasOrAndCr = Boolean(docs.or_file?.trim() && docs.cr_file?.trim());
  return hasSalesInvoice || hasOrAndCr;
}

export function validateApplicationUnits(params: {
  franchiseTypeCode: string;
  isFleet: boolean;
  numberOfUnits: number;
  units: VehicleUnitInput[];
  requireDocuments: boolean;
}): { valid: true } | { valid: false; error: string } {
  const { franchiseTypeCode, isFleet, numberOfUnits, units, requireDocuments } = params;

  if (!Number.isInteger(numberOfUnits) || numberOfUnits < 1 || numberOfUnits > 50) {
    return {
      valid: false,
      error: "Please enter a valid number of authorized units (between 1 and 50).",
    };
  }

  if (isFleet && numberOfUnits < 2) {
    return {
      valid: false,
      error: "Fleet applications require at least 2 authorized units. Switch to Individual for 1 unit.",
    };
  }

  if (!Array.isArray(units) || units.length !== numberOfUnits) {
    return {
      valid: false,
      error: `Please fill in vehicle details for all ${numberOfUnits} authorized unit(s).`,
    };
  }

  const requiresEvType = franchiseTypeCode === "E_TNVS" || franchiseTypeCode === "EVT";

  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    const label = numberOfUnits > 1 ? `Unit ${i + 1}: ` : "";

    if (!unit?.plate_number?.trim() || !unit?.mv_file_number?.trim() || !unit?.make?.trim() || !unit?.series?.trim() || !unit?.chassis_number?.trim()) {
      return {
        valid: false,
        error: `${label}Please complete plate number, MV file number, make, model, and chassis number.`,
      };
    }

    if (!unit?.body_type?.trim()) {
      return {
        valid: false,
        error: `${label}Please enter the vehicle Body Type (for example: Sedan, MPV, SUV, or Van).`,
      };
    }

    if (requiresEvType && (!unit.ev_type || !["BEV", "PHEV", "HEV"].includes(unit.ev_type))) {
      return {
        valid: false,
        error: `${label}Please pick an Electric Vehicle Type (BEV, PHEV, or HEV) for ${franchiseTypeCode}.`,
      };
    }

    if (requireDocuments && !hasValidOwnershipDocument(unit.documents)) {
      return {
        valid: false,
        error: `${label}Please upload your Sales Invoice PDF (or both OR and CR PDFs) before turning on Automatic Slot Reservation.`,
      };
    }
  }

  return { valid: true };
}

export async function uploadLtfrbDocument(params: {
  token: string;
  file: Blob;
  filename: string;
}): Promise<{ ok: boolean; httpStatus: number | null; url?: string; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const formData = new FormData();
    formData.append("file", params.file, params.filename);

    const response = await fetch(`${LTFRB_API_BASE}/file/upload`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Origin: POLITE_HEADERS.Origin,
        Referer: POLITE_HEADERS.Referer,
        "User-Agent": POLITE_HEADERS["User-Agent"],
        Authorization: `Bearer ${params.token}`,
      },
      body: formData,
      signal: controller.signal,
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const dataObj = body.data as Record<string, unknown> | undefined;
    const url = typeof dataObj?.url === "string" ? dataObj.url : undefined;

    if (!response.ok || !url) {
      return {
        ok: false,
        httpStatus: response.status,
        message:
          typeof body.message === "string"
            ? body.message
            : `Upload failed (HTTP ${response.status}).`,
      };
    }

    return {
      ok: true,
      httpStatus: response.status,
      url,
      message: "Document uploaded to LTFRB.",
    };
  } catch (err) {
    return {
      ok: false,
      httpStatus: null,
      message: err instanceof Error ? err.message : "Could not upload document to LTFRB.",
    };
  } finally {
    clearTimeout(timer);
  }
}
