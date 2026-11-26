"use client";

import { useEffect, useState } from "react";
import type { FranchiseType } from "@/lib/ltfrb/types";
import { MAX_MONITORED_FRANCHISES } from "@/lib/monitor/preferences";

interface FranchisePickerCardProps {
  franchiseTypes: FranchiseType[];
  savedCodes: string[];
  onSaved: (codes: string[]) => Promise<void>;
  onBanner: (banner: { kind: "success" | "error" | "info"; text: string }) => void;
}

export default function FranchisePickerCard({
  franchiseTypes,
  savedCodes,
  onSaved,
  onBanner,
}: FranchisePickerCardProps) {
  const [draftCodes, setDraftCodes] = useState<string[]>(savedCodes);
  const [isEditing, setIsEditing] = useState(savedCodes.length === 0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftCodes(savedCodes);
    if (savedCodes.length === 0) {
      setIsEditing(true);
    }
  }, [savedCodes]);

  const savedNames = savedCodes.map(
    (code) => franchiseTypes.find((ft) => ft.code === code)?.name ?? code
  );

  function toggleCode(code: string) {
    setDraftCodes((prev) => {
      if (prev.includes(code)) {
        return prev.filter((c) => c !== code);
      }
      if (prev.length >= MAX_MONITORED_FRANCHISES) {
        return prev;
      }
      return [...prev, code];
    });
  }

  async function handleSave() {
    if (draftCodes.length === 0) {
      onBanner({
        kind: "error",
        text: "Please pick at least 1 franchise type to monitor for your account.",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitoredFranchiseCodes: draftCodes }),
      });

      const data = (await res.json()) as {
        error?: string;
        monitoredFranchiseCodes?: string[];
      };

      if (!res.ok) {
        throw new Error(data.error || "Could not save your franchise choices.");
      }

      const finalCodes = data.monitoredFranchiseCodes ?? draftCodes;
      await onSaved(finalCodes);
      setIsEditing(false);
      onBanner({
        kind: "success",
        text: `Saved! Your account will now only monitor: ${finalCodes.join(" and ")}.`,
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save your choices.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!isEditing && savedCodes.length > 0) {
    return (
      <div className="mb-8 rounded-2xl bg-white p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-base font-bold text-[#4B5563]">
              Monitored Franchises for Your Account (Up to {MAX_MONITORED_FRANCHISES})
            </p>
            <p className="mt-1 text-xl font-bold text-[#17191C]">
              {savedNames.join(" • ")}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="min-h-12 shrink-0 rounded-xl bg-[#EEF1F4] px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          >
            Change My Franchises
          </button>
        </div>
      </div>
    );
  }

  const reachedMax = draftCodes.length >= MAX_MONITORED_FRANCHISES;

  return (
    <section
      aria-labelledby="franchise-picker-heading"
      className="mb-8 rounded-2xl bg-white p-6 sm:p-8"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="franchise-picker-heading" className="text-2xl font-bold text-[#17191C]">
            Choose Up to {MAX_MONITORED_FRANCHISES} Franchises to Monitor
          </h2>
          <p className="mt-1 text-lg leading-relaxed text-[#374151]">
            Tap 1 or 2 franchise types below. Only the franchises you pick will be checked,
            emailed, and reserved for your account.
          </p>
        </div>
        <span className="inline-block shrink-0 rounded-xl bg-[#DBEAFE] px-4 py-2 text-lg font-bold text-[#1E3A8A]">
          {draftCodes.length} of {MAX_MONITORED_FRANCHISES} picked
        </span>
      </div>

      {reachedMax && (
        <p className="mt-4 rounded-xl bg-[#EEF1F4] px-4 py-3 text-base font-bold text-[#374151]">
          You picked {MAX_MONITORED_FRANCHISES} franchises (the maximum). Tap a green item below to
          uncheck it if you want to pick a different one.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {franchiseTypes.map((ft) => {
          const isSelected = draftCodes.includes(ft.code);
          const isDisabled = !isSelected && reachedMax;

          return (
            <button
              key={ft.code}
              type="button"
              onClick={() => toggleCode(ft.code)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              className={`min-h-12 rounded-xl px-5 py-4 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                isSelected
                  ? "bg-[#DCFCE7] text-[#14532D]"
                  : isDisabled
                  ? "bg-[#F6F5F1] text-[#6B7280] opacity-60"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              <span className="block">{ft.name}</span>
              <span className="mt-1 block text-base font-normal">
                {isSelected ? `Selected (${ft.code})` : `Tap to select (${ft.code})`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || draftCodes.length === 0}
          className="min-h-12 rounded-xl bg-[#1D4ED8] px-6 py-3.5 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
        >
          {saving ? "Saving Choices..." : "Save My Monitored Franchises"}
        </button>

        {savedCodes.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setDraftCodes(savedCodes);
              setIsEditing(false);
            }}
            className="min-h-12 rounded-xl bg-[#EEF1F4] px-5 py-3.5 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
