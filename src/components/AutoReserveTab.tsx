"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ApplicationProfile,
  FranchiseType,
  LtfrbOptionItem,
  SubmissionLogRow,
  UnitDocuments,
  VehicleUnitInput,
} from "@/lib/ltfrb/types";

interface AutoReserveTabProps {
  franchiseTypes: FranchiseType[];
  monitoredFranchiseCodes: string[];
  hasSavedLtfrbAccount: boolean;
  userEmail: string | null;
  profiles: ApplicationProfile[];
  submissionLogs: SubmissionLogRow[];
  onGoToAccountTab: () => void;
  onRefresh: () => Promise<void>;
  onBanner: (banner: { kind: "success" | "error" | "info"; text: string }) => void;
}

interface UnitDraft {
  plate_number: string;
  mv_file_number: string;
  make: string;
  series: string;
  year_model: string;
  body_type: string;
  ev_type: "" | "BEV" | "PHEV" | "HEV";
  engine_number: string;
  chassis_number: string;
  sales_invoice_file: string | null;
  or_file: string | null;
  cr_file: string | null;
}

function createEmptyUnitDraft(requiresEvType: boolean): UnitDraft {
  return {
    plate_number: "",
    mv_file_number: "",
    make: "",
    series: "",
    year_model: String(new Date().getFullYear()),
    body_type: "Sedan",
    ev_type: requiresEvType ? "BEV" : "",
    engine_number: "",
    chassis_number: "",
    sales_invoice_file: null,
    or_file: null,
    cr_file: null,
  };
}

function unitInputToDraft(u: VehicleUnitInput, requiresEvType: boolean): UnitDraft {
  return {
    plate_number: u.plate_number ?? "",
    mv_file_number: u.mv_file_number ?? "",
    make: u.make ?? "",
    series: u.series ?? "",
    year_model: String(u.year_model ?? new Date().getFullYear()),
    body_type: u.body_type ?? "Sedan",
    ev_type: u.ev_type ?? (requiresEvType ? "BEV" : ""),
    engine_number: u.engine_number ?? "",
    chassis_number: u.chassis_number ?? "",
    sales_invoice_file: u.documents?.sales_invoice_file ?? null,
    or_file: u.documents?.or_file ?? null,
    cr_file: u.documents?.cr_file ?? null,
  };
}

function formatManilaTime(iso: string | null | undefined): string {
  if (!iso) return "Not attempted yet";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Not attempted yet";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AutoReserveTab({
  franchiseTypes,
  monitoredFranchiseCodes,
  hasSavedLtfrbAccount,
  userEmail,
  profiles,
  submissionLogs,
  onGoToAccountTab,
  onRefresh,
  onBanner,
}: AutoReserveTabProps) {
  const allowedFranchiseTypes = franchiseTypes.filter((ft) =>
    monitoredFranchiseCodes.includes(ft.code)
  );
  const [regions, setRegions] = useState<LtfrbOptionItem[]>([]);
  const [provinces, setProvinces] = useState<LtfrbOptionItem[]>([]);
  const [routes, setRoutes] = useState<LtfrbOptionItem[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [profileName, setProfileName] = useState("");
  const [franchiseTypeCode, setFranchiseTypeCode] = useState(
    monitoredFranchiseCodes[0] ?? ""
  );
  const [isFleet, setIsFleet] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const [selectedProvinceId, setSelectedProvinceId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(userEmail ?? "");
  const [armImmediately, setArmImmediately] = useState(true);
  const [submitOnIncrease, setSubmitOnIncrease] = useState(true);
  const [submitAtMidnight, setSubmitAtMidnight] = useState(false);
  const [submitHourly, setSubmitHourly] = useState(false);

  const requiresEvType = franchiseTypeCode === "E_TNVS" || franchiseTypeCode === "EVT";
  const selectedFranchiseMeta = franchiseTypes.find((ft) => ft.code === franchiseTypeCode) ?? null;

  const [unitsDraft, setUnitsDraft] = useState<UnitDraft[]>(() => [
    createEmptyUnitDraft(requiresEvType),
  ]);
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function resizeUnitsCount(nextCount: number) {
    const clamped = Math.max(1, Math.min(50, Math.floor(nextCount)));
    setUnitsDraft((prev) => {
      if (prev.length === clamped) return prev;
      if (prev.length > clamped) return prev.slice(0, clamped);
      const next = [...prev];
      while (next.length < clamped) {
        next.push(createEmptyUnitDraft(requiresEvType));
      }
      return next;
    });
  }

  function handleSelectApplicationType(fleetMode: boolean) {
    setIsFleet(fleetMode);
    if (fleetMode) {
      const fleetMin = Math.max(2, selectedFranchiseMeta?.fleetMinSlots ?? 2);
      if (unitsDraft.length < fleetMin) {
        resizeUnitsCount(fleetMin);
      }
    } else if (unitsDraft.length > 1) {
      resizeUnitsCount(1);
    }
  }

  function updateUnitField<K extends keyof UnitDraft>(
    unitIndex: number,
    field: K,
    value: UnitDraft[K]
  ) {
    setUnitsDraft((prev) =>
      prev.map((unit, idx) => (idx === unitIndex ? { ...unit, [field]: value } : unit))
    );
  }

  function resetFormToNew() {
    const initialCode = monitoredFranchiseCodes[0] ?? "";
    const initialEv = initialCode === "E_TNVS" || initialCode === "EVT";
    setEditingProfileId(null);
    setProfileName("");
    setFranchiseTypeCode(initialCode);
    setIsFleet(false);
    setSelectedRegionId("");
    setSelectedProvinceId("");
    setSelectedRouteId("");
    setNotifyEmail(userEmail ?? "");
    setArmImmediately(true);
    setSubmitOnIncrease(true);
    setSubmitAtMidnight(false);
    setSubmitHourly(false);
    setUnitsDraft([createEmptyUnitDraft(initialEv)]);
  }

  function startEditingProfile(profile: ApplicationProfile) {
    const profileEv =
      profile.franchise_type_code === "E_TNVS" || profile.franchise_type_code === "EVT";
    const loadedUnits =
      profile.units && profile.units.length > 0
        ? profile.units.map((u) => unitInputToDraft(u, profileEv))
        : [createEmptyUnitDraft(profileEv)];

    setEditingProfileId(profile.id);
    setProfileName(profile.profile_name);
    setFranchiseTypeCode(profile.franchise_type_code);
    setIsFleet(Boolean(profile.is_fleet));
    setSelectedRegionId(profile.region_id);
    setSelectedProvinceId(profile.province_id ?? "");
    setSelectedRouteId(profile.route_id ?? "");
    setNotifyEmail(profile.notify_email ?? userEmail ?? "");
    setArmImmediately(profile.is_armed);
    setSubmitOnIncrease(profile.submit_on_slot_increase ?? true);
    setSubmitAtMidnight(Boolean(profile.submit_at_midnight));
    setSubmitHourly(Boolean(profile.submit_hourly));
    setUnitsDraft(loadedUnits);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function uploadPdfFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/ltfrb/upload", {
      method: "POST",
      body: formData,
    });
    const json = (await res.json()) as { ok?: boolean; url?: string; error?: string };
    if (!res.ok || !json.url) {
      throw new Error(json.error || "Could not upload PDF file to LTFRB.");
    }
    return json.url;
  }

  async function handleFormFileChange(
    unitIndex: number,
    docKey: "sales_invoice_file" | "or_file" | "cr_file",
    file: File | undefined
  ) {
    if (!file) return;
    setUploadingKey(`form:${unitIndex}:${docKey}`);
    try {
      const url = await uploadPdfFile(file);
      updateUnitField(unitIndex, docKey, url);
      onBanner({
        kind: "success",
        text: `Unit ${unitIndex + 1} PDF uploaded and ready for your application.`,
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "PDF upload failed.",
      });
    } finally {
      setUploadingKey(null);
    }
  }

  async function handleAttachDocToSavedProfile(
    profile: ApplicationProfile,
    docField: "sales_invoice_file" | "or_file" | "cr_file",
    file: File | undefined
  ) {
    if (!file) return;
    setUploadingKey(`${profile.id}:${docField}`);
    try {
      const url = await uploadPdfFile(file);
      const currentUnits = [...(profile.units ?? [])];
      const firstUnit = {
        ...(currentUnits[0] ?? {}),
        documents: {
          ...(currentUnits[0]?.documents ?? {}),
          [docField]: url,
        },
      };
      currentUnits[0] = firstUnit;

      const res = await fetch("/api/reservation/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: profile.id, units: currentUnits }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error || "Could not save uploaded PDF to profile.");
      }

      await onRefresh();
      onBanner({
        kind: "success",
        text: "Document uploaded and saved to your reservation profile.",
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not upload document.",
      });
    } finally {
      setUploadingKey(null);
    }
  }

  useEffect(() => {
    if (
      monitoredFranchiseCodes.length > 0 &&
      !monitoredFranchiseCodes.includes(franchiseTypeCode)
    ) {
      setFranchiseTypeCode(monitoredFranchiseCodes[0]);
    }
  }, [franchiseTypeCode, monitoredFranchiseCodes]);

  useEffect(() => {
    if (requiresEvType) {
      setUnitsDraft((prev) =>
        prev.map((u) => (u.ev_type ? u : { ...u, ev_type: "BEV" }))
      );
    }
  }, [requiresEvType]);

  async function handleUpdateSavedEvType(
    profile: ApplicationProfile,
    nextEvType: "BEV" | "PHEV" | "HEV"
  ) {
    const updatedUnits = (profile.units ?? []).map((u) => ({
      ...u,
      ev_type: u.ev_type || nextEvType,
    }));

    const res = await fetch("/api/reservation/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: profile.id, units: updatedUnits }),
    });

    if (res.ok) {
      await onRefresh();
      onBanner({
        kind: "success",
        text: `Updated Electric Vehicle Type to ${nextEvType}. You can try submitting now.`,
      });
    } else {
      onBanner({ kind: "error", text: "Could not update Electric Vehicle Type." });
    }
  }

  useEffect(() => {
    if (!franchiseTypeCode) {
      setRegions([]);
      return;
    }
    let active = true;
    async function loadRegions() {
      setLoadingOptions(true);
      try {
        const res = await fetch(
          `/api/ltfrb/options?franchise_type_code=${encodeURIComponent(franchiseTypeCode)}`
        );
        const json = (await res.json()) as { regions?: LtfrbOptionItem[] };
        if (active) {
          setRegions(json.regions ?? []);
        }
      } finally {
        if (active) setLoadingOptions(false);
      }
    }
    void loadRegions();
    return () => {
      active = false;
    };
  }, [franchiseTypeCode]);

  useEffect(() => {
    let active = true;
    const region = regions.find((r) => r.id === selectedRegionId);
    if (!region) {
      setProvinces([]);
      setRoutes([]);
      return;
    }

    async function loadSubOptions() {
      const res = await fetch(
        `/api/ltfrb/options?franchise_type_code=${encodeURIComponent(
          franchiseTypeCode
        )}&region_code=${encodeURIComponent(region!.code)}&region_id=${encodeURIComponent(
          region!.id
        )}`
      );
      const json = (await res.json()) as {
        provinces?: LtfrbOptionItem[];
        routes?: LtfrbOptionItem[];
      };
      if (active) {
        setProvinces(json.provinces ?? []);
        setRoutes(json.routes ?? []);
      }
    }

    void loadSubOptions();
    return () => {
      active = false;
    };
  }, [franchiseTypeCode, regions, selectedRegionId]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const region = regions.find((r) => r.id === selectedRegionId);
      const province = provinces.find((p) => p.id === selectedProvinceId);
      const route = routes.find((rt) => rt.id === selectedRouteId);

      if (!region) {
        throw new Error("Please select a Region first.");
      }

      const serializedUnits: VehicleUnitInput[] = unitsDraft.map((u) => {
        const documents: UnitDocuments = {
          sales_invoice_file: u.sales_invoice_file,
          or_file: u.or_file,
          cr_file: u.cr_file,
        };
        return {
          plate_number: u.plate_number.trim().toUpperCase(),
          mv_file_number: u.mv_file_number.trim(),
          make: u.make.trim(),
          series: u.series.trim(),
          year_model: Number(u.year_model) || new Date().getFullYear(),
          body_type: u.body_type.trim() || "Sedan",
          ...(u.ev_type ? { ev_type: u.ev_type } : {}),
          engine_number: u.engine_number.trim(),
          chassis_number: u.chassis_number.trim(),
          documents,
        };
      });

      const isEditing = Boolean(editingProfileId);
      const res = await fetch("/api/reservation/profiles", {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isEditing ? { id: editingProfileId } : {}),
          profile_name:
            profileName.trim() ||
            `${franchiseTypeCode} (${isFleet ? `Fleet ${serializedUnits.length}` : "Individual"}) — ${region.name}`,
          franchise_type_code: franchiseTypeCode,
          region_id: region.id,
          region_name: region.name,
          province_id: province?.id ?? null,
          province_name: province?.name ?? null,
          route_id: route?.id ?? null,
          route_name: route?.name ?? null,
          number_of_units: serializedUnits.length,
          is_fleet: isFleet,
          notify_email: notifyEmail.trim() || userEmail,
          is_armed: armImmediately,
          submit_on_slot_increase: submitOnIncrease,
          submit_at_midnight: submitAtMidnight,
          submit_hourly: submitHourly,
          units: serializedUnits,
        }),
      });

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Could not save reservation details.");
      }

      resetFormToNew();
      await onRefresh();
      onBanner({
        kind: "success",
        text: isEditing
          ? "Your reservation profile changes were saved."
          : armImmediately
          ? "Saved! Automatic slot reservation is turned ON and ready."
          : "Saved! You can turn on automatic reservation anytime below.",
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save reservation profile.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleArmed(profile: ApplicationProfile) {
    const res = await fetch("/api/reservation/profiles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: profile.id, is_armed: !profile.is_armed }),
    });
    if (res.ok) {
      await onRefresh();
    } else {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      onBanner({
        kind: "error",
        text: json.error || "Could not update automatic reservation setting.",
      });
    }
  }

  async function handleSubmitNow(profileId: string) {
    setSubmittingId(profileId);
    try {
      const res = await fetch("/api/reservation/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        summary?: { message: string; result: string };
      };
      if (!res.ok && !json.summary) {
        throw new Error(json.error || "Submission failed.");
      }
      await onRefresh();
      onBanner({
        kind: json.summary?.result === "success" ? "success" : "info",
        text: json.summary?.message || "Reservation attempt completed.",
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not send reservation to LTFRB.",
      });
    } finally {
      setSubmittingId(null);
    }
  }

  async function handleDeleteProfile(id: string) {
    const res = await fetch(`/api/reservation/profiles?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await onRefresh();
      onBanner({ kind: "info", text: "Reservation profile removed." });
    } else {
      onBanner({ kind: "error", text: "Could not remove reservation profile." });
    }
  }

  const minUnitsAllowed = isFleet ? Math.max(2, selectedFranchiseMeta?.fleetMinSlots ?? 2) : 1;
  const maxUnitsAllowed = selectedFranchiseMeta?.maxSlots ?? 50;

  return (
    <section aria-labelledby="reserve-heading" className="space-y-8">
      {!hasSavedLtfrbAccount && (
        <div className="rounded-2xl bg-[#FEF3C7] p-6 text-[#78350F]">
          <h2 className="text-xl font-bold">Step 1 Needed: Save Your LTFRB Login First</h2>
          <p className="mt-2 text-lg leading-relaxed">
            Before this app can submit an application for you, please sign in and save your LTFRB
            account details first.
          </p>
          <button
            type="button"
            onClick={onGoToAccountTab}
            className="mt-4 min-h-12 rounded-xl bg-[#17191C] px-6 py-3 text-lg font-bold text-white hover:bg-[#2C3036] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          >
            Go to My LTFRB Account
          </button>
        </div>
      )}

      {/* Application Form */}
      <form ref={formRef} onSubmit={handleSaveProfile} className="rounded-2xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="reserve-heading" className="text-2xl font-bold text-[#17191C]">
              {editingProfileId
                ? "Edit Saved Reservation Profile"
                : "Prepare Automatic Slot Reservation"}
            </h2>
            <p className="mt-2 text-lg leading-relaxed text-[#374151]">
              {editingProfileId
                ? "Update any details or documents below, then tap Save Profile Changes."
                : "Fill in your LTFRB application type, authorized units, franchise area, and vehicle details once. We submit automatically when matching open slots appear."}
            </p>
          </div>

          {editingProfileId && (
            <button
              type="button"
              onClick={resetFormToNew}
              className="min-h-12 shrink-0 rounded-xl bg-[#EEF1F4] px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              Cancel Editing
            </button>
          )}
        </div>

        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label htmlFor="res-name" className="block text-lg font-bold text-[#17191C]">
                Nickname for This Application
              </label>
              <input
                id="res-name"
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="Example: My Toyota Vios TNVS"
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              />
            </div>

            <div>
              <label htmlFor="res-franchise" className="block text-lg font-bold text-[#17191C]">
                Franchise Type
              </label>
              <select
                id="res-franchise"
                required
                value={franchiseTypeCode}
                onChange={(e) => {
                  setFranchiseTypeCode(e.target.value);
                  setSelectedRegionId("");
                  setSelectedProvinceId("");
                  setSelectedRouteId("");
                }}
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                {allowedFranchiseTypes.length === 0 ? (
                  <option value="">Pick your monitored franchise in Check Open Slots first</option>
                ) : (
                  allowedFranchiseTypes.map((ft) => (
                    <option key={ft.code} value={ft.code}>
                      {ft.name} ({ft.code})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Application Type (Individual vs Fleet) + No. of Authorized Units */}
          <div className="rounded-xl bg-[#F6F5F1] p-5 sm:p-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="text-lg font-bold text-[#17191C]">
                  Application Type (Individual or Fleet)
                </p>
                <p className="mt-1 text-base text-[#4B5563]">
                  Matches the LTFRB portal Application Type field (`is_fleet`).
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={!isFleet}
                    onClick={() => handleSelectApplicationType(false)}
                    className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                      !isFleet
                        ? "bg-[#1D4ED8] text-white"
                        : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                    }`}
                  >
                    Individual
                  </button>
                  <button
                    type="button"
                    aria-pressed={isFleet}
                    onClick={() => handleSelectApplicationType(true)}
                    className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                      isFleet
                        ? "bg-[#1D4ED8] text-white"
                        : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                    }`}
                  >
                    Fleet
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="res-units-count" className="block text-lg font-bold text-[#17191C]">
                  No. of Authorized Units
                </label>
                <p className="mt-1 text-base text-[#4B5563]">
                  {isFleet
                    ? `Minimum ${minUnitsAllowed} units for Fleet. Requires ${unitsDraft.length}+ open slots at once.`
                    : "Usually 1 unit for Individual operator applications."}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => resizeUnitsCount(Math.max(minUnitsAllowed, unitsDraft.length - 1))}
                    disabled={unitsDraft.length <= minUnitsAllowed}
                    className="min-h-12 min-w-12 rounded-xl bg-white px-4 py-2 text-xl font-bold text-[#17191C] hover:bg-[#E2E6EB] disabled:opacity-50"
                  >
                    -
                  </button>
                  <input
                    id="res-units-count"
                    type="number"
                    min={minUnitsAllowed}
                    max={maxUnitsAllowed}
                    value={unitsDraft.length}
                    onChange={(e) => {
                      const val = Number(e.target.value) || minUnitsAllowed;
                      resizeUnitsCount(Math.max(minUnitsAllowed, Math.min(maxUnitsAllowed, val)));
                    }}
                    className="min-h-12 w-24 rounded-xl bg-white px-3 py-2 text-center text-xl font-bold text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                  />
                  <button
                    type="button"
                    onClick={() => resizeUnitsCount(Math.min(maxUnitsAllowed, unitsDraft.length + 1))}
                    disabled={unitsDraft.length >= maxUnitsAllowed}
                    className="min-h-12 min-w-12 rounded-xl bg-[#1D4ED8] px-4 py-2 text-xl font-bold text-white hover:bg-[#1E40AF] disabled:opacity-50"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label htmlFor="res-region" className="block text-lg font-bold text-[#17191C]">
                Region
              </label>
              <select
                id="res-region"
                required
                value={selectedRegionId}
                onChange={(e) => {
                  setSelectedRegionId(e.target.value);
                  setSelectedProvinceId("");
                  setSelectedRouteId("");
                }}
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                <option value="">
                  {loadingOptions ? "Loading regions..." : "Choose a Region"}
                </option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="res-province" className="block text-lg font-bold text-[#17191C]">
                Province (If Applicable)
              </label>
              <select
                id="res-province"
                value={selectedProvinceId}
                onChange={(e) => setSelectedProvinceId(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                <option value="">Any / Not Required</option>
                {provinces.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {routes.length > 0 && (
            <div>
              <label htmlFor="res-route" className="block text-lg font-bold text-[#17191C]">
                Route / Area of Operation
              </label>
              <select
                id="res-route"
                value={selectedRouteId}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                <option value="">Choose a Route (If Required)</option>
                {routes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Vehicle Details & Per-Unit Documents */}
          <div className="space-y-6">
            {unitsDraft.map((unit, idx) => (
              <div key={idx} className="space-y-6 rounded-xl bg-[#F6F5F1] p-5 sm:p-6">
                <div>
                  <h3 className="text-xl font-bold text-[#17191C]">
                    {unitsDraft.length > 1
                      ? `Vehicle Unit ${idx + 1} of ${unitsDraft.length}`
                      : "Vehicle Details"}
                  </h3>
                  <p className="mt-1 text-base text-[#4B5563]">
                    Copy these exactly from your vehicle OR/CR registration or Sales Invoice.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`veh-plate-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Plate Number
                    </label>
                    <input
                      id={`veh-plate-${idx}`}
                      type="text"
                      required
                      value={unit.plate_number}
                      onChange={(e) => updateUnitField(idx, "plate_number", e.target.value)}
                      placeholder="ABC1234"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg uppercase text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-mv-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      MV File Number
                    </label>
                    <input
                      id={`veh-mv-${idx}`}
                      type="text"
                      required
                      value={unit.mv_file_number}
                      onChange={(e) => updateUnitField(idx, "mv_file_number", e.target.value)}
                      placeholder="1301-0000123456"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-make-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Vehicle Make (Brand)
                    </label>
                    <input
                      id={`veh-make-${idx}`}
                      type="text"
                      required
                      value={unit.make}
                      onChange={(e) => updateUnitField(idx, "make", e.target.value)}
                      placeholder="Toyota"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-series-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Vehicle Model / Series
                    </label>
                    <input
                      id={`veh-series-${idx}`}
                      type="text"
                      required
                      value={unit.series}
                      onChange={(e) => updateUnitField(idx, "series", e.target.value)}
                      placeholder="Vios"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-year-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Year Model
                    </label>
                    <input
                      id={`veh-year-${idx}`}
                      type="number"
                      required
                      min={2010}
                      max={2030}
                      value={unit.year_model}
                      onChange={(e) => updateUnitField(idx, "year_model", e.target.value)}
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-body-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Body Type
                    </label>
                    <input
                      id={`veh-body-${idx}`}
                      type="text"
                      required
                      value={unit.body_type}
                      onChange={(e) => updateUnitField(idx, "body_type", e.target.value)}
                      placeholder="Sedan, MPV, SUV, or Van"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-ev-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      {requiresEvType
                        ? "Electric Vehicle Type (Required for E-TNVS / EVT)"
                        : "Electric Vehicle Type (Optional)"}
                    </label>
                    <select
                      id={`veh-ev-${idx}`}
                      required={requiresEvType}
                      value={unit.ev_type}
                      onChange={(e) =>
                        updateUnitField(idx, "ev_type", e.target.value as "" | "BEV" | "PHEV" | "HEV")
                      }
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    >
                      {!requiresEvType && (
                        <option value="">Not Electric (Gasoline / Diesel)</option>
                      )}
                      <option value="BEV">BEV — Battery Electric Vehicle</option>
                      <option value="PHEV">PHEV — Plug-in Hybrid Electric Vehicle</option>
                      <option value="HEV">HEV — Hybrid Electric Vehicle</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-engine-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Engine Number
                    </label>
                    <input
                      id={`veh-engine-${idx}`}
                      type="text"
                      required={unit.ev_type !== "BEV" && unit.ev_type !== "PHEV"}
                      value={unit.engine_number}
                      onChange={(e) => updateUnitField(idx, "engine_number", e.target.value)}
                      placeholder="Engine serial number"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`veh-chassis-${idx}`}
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      Chassis Number
                    </label>
                    <input
                      id={`veh-chassis-${idx}`}
                      type="text"
                      required
                      value={unit.chassis_number}
                      onChange={(e) => updateUnitField(idx, "chassis_number", e.target.value)}
                      placeholder="Chassis / VIN number"
                      className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#17191C] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>
                </div>

                {/* Per-Unit Ownership Documents */}
                <div className="space-y-4">
                  <h4 className="text-lg font-bold text-[#17191C]">
                    {unitsDraft.length > 1
                      ? `Unit ${idx + 1} Documents (PDF Files, up to 5 MB)`
                      : "Vehicle Documents (PDF Files, up to 5 MB)"}
                  </h4>
                  {idx === 0 && !hasSavedLtfrbAccount && (
                    <p className="rounded-xl bg-[#FEF3C7] px-4 py-3 text-base font-bold text-[#78350F]">
                      Please save your LTFRB login in Step 3 first before uploading PDF files.
                    </p>
                  )}

                  {[
                    {
                      key: "sales_invoice_file" as const,
                      title: "Sales Invoice (PDF) — Upload Now",
                      hint: "Required at filing if you do not have your OR/CR yet.",
                      url: unit.sales_invoice_file,
                    },
                    {
                      key: "or_file" as const,
                      title: "Official Receipt / OR (PDF) — Optional for Later",
                      hint: "Leave empty for now if you are still waiting for your LTO OR.",
                      url: unit.or_file,
                    },
                    {
                      key: "cr_file" as const,
                      title: "Certificate of Registration / CR (PDF) — Optional for Later",
                      hint: "Leave empty for now if you are still waiting for your LTO CR.",
                      url: unit.cr_file,
                    },
                  ].map((doc) => {
                    const uploadToken = `form:${idx}:${doc.key}`;
                    return (
                      <div key={doc.key} className="rounded-xl bg-white p-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="text-lg font-bold text-[#17191C]">{doc.title}</p>
                            <p className="mt-1 text-base text-[#4B5563]">{doc.hint}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-3">
                            {doc.url ? (
                              <>
                                <span className="inline-block rounded-xl bg-[#DCFCE7] px-4 py-2 text-base font-bold text-[#14532D]">
                                  PDF Uploaded
                                </span>
                                <a
                                  href={doc.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex min-h-12 items-center rounded-xl bg-[#EEF1F4] px-4 py-2.5 text-base font-bold text-[#17191C] hover:bg-[#E2E6EB]"
                                >
                                  View PDF
                                </a>
                                <button
                                  type="button"
                                  onClick={() => updateUnitField(idx, doc.key, null)}
                                  className="min-h-12 rounded-xl bg-[#FEE2E2] px-4 py-2.5 text-base font-bold text-[#7F1D1D] hover:bg-[#FECACA]"
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <label
                                className={`inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl px-5 py-3 text-lg font-bold focus-within:ring-4 focus-within:ring-blue-700/30 ${
                                  hasSavedLtfrbAccount
                                    ? "bg-[#1D4ED8] text-white hover:bg-[#1E40AF]"
                                    : "bg-[#E7E5E4] text-[#6B7280]"
                                }`}
                              >
                                {uploadingKey === uploadToken
                                  ? "Uploading PDF..."
                                  : "Choose PDF File"}
                                <input
                                  type="file"
                                  accept="application/pdf,.pdf"
                                  disabled={!hasSavedLtfrbAccount || uploadingKey !== null}
                                  onChange={(e) => {
                                    const picked = e.target.files?.[0];
                                    void handleFormFileChange(idx, doc.key, picked);
                                    e.target.value = "";
                                  }}
                                  className="sr-only"
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="res-email" className="block text-lg font-bold text-[#17191C]">
              Confirmation Email Address
            </label>
            <input
              id="res-email"
              type="email"
              required
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="name@example.com"
              className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            />
          </div>

          <div className="rounded-xl bg-[#F6F5F1] p-5 sm:p-6">
            <p className="text-lg font-bold text-[#17191C]">
              When Should We Automatically Submit?
            </p>
            <p className="mt-1 text-base text-[#4B5563]">
              Pick one or more times below. As soon as your application succeeds, automatic
              submission stops right away.
            </p>

            <div className="mt-4 space-y-3">
              <button
                type="button"
                role="switch"
                aria-checked={submitOnIncrease}
                onClick={() => setSubmitOnIncrease((prev) => !prev)}
                className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                  submitOnIncrease
                    ? "bg-[#DCFCE7] text-[#14532D]"
                    : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                }`}
              >
                {submitOnIncrease ? "ON: " : "OFF: "}When open slots INCREASE (or a new slot opens)
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={submitAtMidnight}
                onClick={() => setSubmitAtMidnight((prev) => !prev)}
                className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                  submitAtMidnight
                    ? "bg-[#DCFCE7] text-[#14532D]"
                    : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                }`}
              >
                {submitAtMidnight ? "ON: " : "OFF: "}At 12:00 MN, 7:00 AM &amp; 8:00 AM (Manila
                Time)
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={submitHourly}
                onClick={() => setSubmitHourly((prev) => !prev)}
                className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                  submitHourly
                    ? "bg-[#DCFCE7] text-[#14532D]"
                    : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                }`}
              >
                {submitHourly ? "ON: " : "OFF: "}Once every hour (only when slots are above 0;
                auto-stops on 403/409/429 for safety)
              </button>
            </div>

            <div className="mt-5">
              <button
                type="button"
                role="switch"
                aria-checked={armImmediately}
                onClick={() => setArmImmediately((prev) => !prev)}
                className={`min-h-12 w-full rounded-xl px-5 py-3 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:w-auto ${
                  armImmediately
                    ? "bg-[#DBEAFE] text-[#1E3A8A]"
                    : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                }`}
              >
                {armImmediately
                  ? "Automatic Submit is ON (Tap to Save as Draft Only)"
                  : "Save as Draft Only (Tap to Turn On Automatic Submit)"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={
                saving ||
                allowedFranchiseTypes.length === 0 ||
                (armImmediately && !submitOnIncrease && !submitAtMidnight && !submitHourly)
              }
              className="min-h-12 w-full rounded-xl bg-[#1D4ED8] px-6 py-4 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60 sm:w-auto"
            >
              {saving
                ? "Saving Details..."
                : editingProfileId
                ? "Save Profile Changes"
                : "Save Reservation Profile"}
            </button>

            {editingProfileId && (
              <button
                type="button"
                onClick={resetFormToNew}
                className="min-h-12 w-full rounded-xl bg-[#EEF1F4] px-6 py-4 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:w-auto"
              >
                Cancel Editing
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Saved Reservation Profiles */}
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <h3 className="text-2xl font-bold text-[#17191C]">Your Saved Reservation Profiles</h3>
        {profiles.length === 0 ? (
          <p className="mt-3 text-lg text-[#4B5563]">
            No reservation profiles saved yet. Fill in the form above to get ready.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {profiles.map((profile) => {
              const isSubmitted = profile.lock_status === "submitted";
              const unit0 = profile.units?.[0];
              const docs = unit0?.documents;
              const unitCount = profile.number_of_units || profile.units?.length || 1;
              const needsEv =
                (profile.franchise_type_code === "E_TNVS" ||
                  profile.franchise_type_code === "EVT") &&
                (profile.units ?? []).some((u) => !u.ev_type);

              return (
                <div key={profile.id} className="space-y-4 rounded-xl bg-[#EEF1F4] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xl font-bold text-[#17191C]">{profile.profile_name}</p>
                        <span className="rounded-lg bg-white px-3 py-1 text-base font-bold text-[#102E7A]">
                          {profile.is_fleet ? "Fleet" : "Individual"} • {unitCount} Unit
                          {unitCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <p className="mt-1 text-lg text-[#374151]">
                        {profile.franchise_type_code}
                        {unit0?.ev_type ? ` (${unit0.ev_type})` : ""} •{" "}
                        {profile.province_name
                          ? `${profile.province_name}, ${profile.region_name}`
                          : profile.region_name}
                      </p>
                      {profile.units && profile.units.length > 0 && (
                        <p className="mt-1 text-base text-[#4B5563]">
                          Units:{" "}
                          <strong>
                            {profile.units
                              .map((u) => u.plate_number || "No Plate")
                              .join(", ")}
                          </strong>
                        </p>
                      )}
                      {needsEv && !isSubmitted && (
                        <div className="mt-3 rounded-xl bg-[#FEF3C7] p-4 text-[#78350F]">
                          <p className="text-base font-bold">
                            Action Needed: Pick your Electric Vehicle Type for{" "}
                            {profile.franchise_type_code}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-3">
                            {(["BEV", "PHEV", "HEV"] as const).map((choice) => (
                              <button
                                key={choice}
                                type="button"
                                onClick={() => void handleUpdateSavedEvType(profile, choice)}
                                className="min-h-12 rounded-xl bg-white px-5 py-2.5 text-base font-bold text-[#17191C] hover:bg-[#E2E6EB]"
                              >
                                Set {choice}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span
                          className={`inline-block rounded-lg px-3 py-1.5 text-base font-bold ${
                            docs?.sales_invoice_file
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : "bg-white text-[#4B5563]"
                          }`}
                        >
                          {docs?.sales_invoice_file ? "Sales Invoice: Ready" : "Sales Invoice: None"}
                        </span>
                        <span
                          className={`inline-block rounded-lg px-3 py-1.5 text-base font-bold ${
                            docs?.or_file
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : "bg-white text-[#4B5563]"
                          }`}
                        >
                          {docs?.or_file ? "OR: Ready" : "OR: Add Later"}
                        </span>
                        <span
                          className={`inline-block rounded-lg px-3 py-1.5 text-base font-bold ${
                            docs?.cr_file
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : "bg-white text-[#4B5563]"
                          }`}
                        >
                          {docs?.cr_file ? "CR: Ready" : "CR: Add Later"}
                        </span>
                      </div>
                      {profile.submitted_reference && (
                        <p className="mt-2 text-lg font-bold text-[#14532D]">
                          LTFRB Case Number: {profile.submitted_reference}
                        </p>
                      )}
                      {isSubmitted ? (
                        <p className="mt-2 text-base font-bold text-[#14532D]">
                          Application submitted! Auto-submission is stopped for this profile.
                        </p>
                      ) : (
                        <p className="mt-2 text-base text-[#374151]">
                          Auto-submit timing:{" "}
                          <strong>
                            {[
                              (profile.submit_on_slot_increase ?? true) && "When slots increase",
                              profile.submit_at_midnight && "12:00 MN, 7:00 AM & 8:00 AM (Manila)",
                              profile.submit_hourly && "Once every hour",
                            ]
                              .filter(Boolean)
                              .join(" • ") || "Manual only"}
                          </strong>
                        </p>
                      )}
                      {profile.last_error && !isSubmitted && (
                        <p className="mt-2 text-base text-[#7F1D1D]">
                          Last message: {profile.last_error}
                        </p>
                      )}
                    </div>

                    <span
                      className={`inline-block rounded-xl px-4 py-2 text-base font-bold ${
                        isSubmitted
                          ? "bg-[#DCFCE7] text-[#14532D]"
                          : profile.is_armed
                          ? "bg-[#DBEAFE] text-[#1E3A8A]"
                          : "bg-[#E7E5E4] text-[#292524]"
                      }`}
                    >
                      {isSubmitted
                        ? "Submitted"
                        : profile.is_armed
                        ? "Auto-Reserve Ready"
                        : "Paused"}
                    </span>
                  </div>

                  {!isSubmitted && (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleSubmitNow(profile.id)}
                        disabled={submittingId === profile.id || !hasSavedLtfrbAccount}
                        className="min-h-12 rounded-xl bg-[#1D4ED8] px-5 py-3 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
                      >
                        {submittingId === profile.id
                          ? "Submitting to LTFRB..."
                          : "Try Submitting Now"}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleArmed(profile)}
                        className="min-h-12 rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        {profile.is_armed ? "Pause Auto-Reserve" : "Turn On Auto-Reserve"}
                      </button>

                      <button
                        type="button"
                        onClick={() => startEditingProfile(profile)}
                        className="min-h-12 rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        Edit Details
                      </button>

                      {hasSavedLtfrbAccount && !docs?.or_file && (
                        <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB]">
                          {uploadingKey === `${profile.id}:or_file`
                            ? "Uploading OR..."
                            : "Add OR PDF"}
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            disabled={uploadingKey !== null}
                            onChange={(e) => {
                              const picked = e.target.files?.[0];
                              void handleAttachDocToSavedProfile(profile, "or_file", picked);
                              e.target.value = "";
                            }}
                            className="sr-only"
                          />
                        </label>
                      )}

                      {hasSavedLtfrbAccount && !docs?.cr_file && (
                        <label className="inline-flex min-h-12 cursor-pointer items-center rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB]">
                          {uploadingKey === `${profile.id}:cr_file`
                            ? "Uploading CR..."
                            : "Add CR PDF"}
                          <input
                            type="file"
                            accept="application/pdf,.pdf"
                            disabled={uploadingKey !== null}
                            onChange={(e) => {
                              const picked = e.target.files?.[0];
                              void handleAttachDocToSavedProfile(profile, "cr_file", picked);
                              e.target.value = "";
                            }}
                            className="sr-only"
                          />
                        </label>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(profile.id)}
                        className="min-h-12 rounded-xl bg-[#FEE2E2] px-5 py-3 text-lg font-bold text-[#7F1D1D] hover:bg-[#FECACA] focus:outline-none focus:ring-4 focus:ring-red-700/30"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submission History */}
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <h3 className="text-2xl font-bold text-[#17191C]">Recent Reservation Attempts</h3>
        {submissionLogs.length === 0 ? (
          <p className="mt-3 text-lg text-[#4B5563]">No reservation attempts recorded yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {submissionLogs.map((log) => (
              <div key={log.id} className="rounded-xl bg-[#EEF1F4] p-4">
                <p className="text-lg font-bold text-[#17191C]">
                  {log.result === "success"
                    ? "Submitted Successfully"
                    : log.result === "full_slot"
                    ? "Slot Was Full"
                    : "Needs Attention"}
                  {log.reference_number ? ` • Case #${log.reference_number}` : ""}
                </p>
                <p className="mt-1 text-base text-[#374151]">
                  {log.message} • {formatManilaTime(log.attempted_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
