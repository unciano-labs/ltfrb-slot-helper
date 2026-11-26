"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AutoReserveTab from "@/components/AutoReserveTab";
import FranchisePickerCard from "@/components/FranchisePickerCard";
import SignInRequiredCard from "@/components/SignInRequiredCard";
import type {
  ApplicationProfile,
  FranchiseType,
  SlotEntry,
  SlotScope,
  SubmissionLogRow,
  WatchRule,
} from "@/lib/ltfrb/types";
import type {
  CronRunSummary,
  DashboardPayload,
  NotificationLogSummary,
  SavedAccountSummary,
  SlotLoadMode,
} from "@/lib/monitor/dashboard-data";

type ActiveTab = "slots" | "alerts" | "account" | "reserve";

interface SessionUser {
  id: string;
  email: string | null;
}

type CronRunRow = CronRunSummary;
type NotificationLogRow = NotificationLogSummary;
type SavedAccountRow = SavedAccountSummary;

interface MonitorAppProps {
  initialData?: DashboardPayload;
}

function formatManilaTime(iso: string | null | undefined): string {
  if (!iso) return "Not checked yet";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Not checked yet";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function MonitorApp({ initialData }: MonitorAppProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("slots");
  const [loading, setLoading] = useState(!initialData);
  const [refreshingLiveSlots, setRefreshingLiveSlots] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);
  const [banner, setBanner] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null
  );

  const [user, setUser] = useState<SessionUser | null>(initialData?.user ?? null);
  const [monitoredFranchiseCodes, setMonitoredFranchiseCodes] = useState<string[]>(
    initialData?.monitoredFranchiseCodes ?? []
  );
  const [showAllPublicSlots, setShowAllPublicSlots] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(
    Boolean(initialData?.supabaseConfigured)
  );
  const [fetchedAt, setFetchedAt] = useState<string | null>(initialData?.fetchedAt ?? null);
  const [franchiseTypes, setFranchiseTypes] = useState<FranchiseType[]>(
    initialData?.franchiseTypes ?? []
  );
  const [regionSlots, setRegionSlots] = useState<SlotEntry[]>(initialData?.regionSlots ?? []);
  const [provinceSlots, setProvinceSlots] = useState<SlotEntry[]>(
    initialData?.provinceSlots ?? []
  );
  const [lastRun, setLastRun] = useState<CronRunRow | null>(initialData?.lastRun ?? null);
  const [watchRules, setWatchRules] = useState<WatchRule[]>(initialData?.watchRules ?? []);
  const [recentNotifications, setRecentNotifications] = useState<NotificationLogRow[]>(
    initialData?.recentNotifications ?? []
  );
  const [reservationProfiles, setReservationProfiles] = useState<ApplicationProfile[]>(
    initialData?.reservationProfiles ?? []
  );
  const [submissionLogs, setSubmissionLogs] = useState<SubmissionLogRow[]>(
    initialData?.submissionLogs ?? []
  );
  const [savedAccount, setSavedAccount] = useState<SavedAccountRow | null>(
    initialData?.savedAccount ?? null
  );

  // Slot Explorer filters
  const [viewScope, setViewScope] = useState<SlotScope>("region");
  const [selectedFranchiseCode, setSelectedFranchiseCode] = useState<string>("ALL");
  const [selectedAreaName, setSelectedAreaName] = useState<string>("ALL");
  const [onlyOpenSlots, setOnlyOpenSlots] = useState<boolean>(false);

  // New Email Alert form
  const [ruleLabel, setRuleLabel] = useState("");
  const [ruleScope, setRuleScope] = useState<SlotScope>("region");
  const [ruleFranchiseCode, setRuleFranchiseCode] = useState(
    initialData?.monitoredFranchiseCodes?.[0] ?? "TNVS"
  );
  const [ruleRegionCode, setRuleRegionCode] = useState("ALL");
  const [ruleProvinceCode, setRuleProvinceCode] = useState("ALL");
  const [ruleEmail, setRuleEmail] = useState(initialData?.user?.email ?? "");
  const [ruleCooldown, setRuleCooldown] = useState("60");
  const [notifyWhenAvailable, setNotifyWhenAvailable] = useState(true);
  const [notifyWhenIncreased, setNotifyWhenIncreased] = useState(true);
  const [notifyWhenDecreased, setNotifyWhenDecreased] = useState(false);
  const [savingRule, setSavingRule] = useState(false);

  // LTFRB Account form
  const [ltfrbAccountType, setLtfrbAccountType] = useState<"operator" | "tnc">("operator");
  const [ltfrbEmail, setLtfrbEmail] = useState("");
  const [ltfrbPassword, setLtfrbPassword] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  const applyPayload = useCallback((slotsJson: DashboardPayload) => {
    setUser(slotsJson.user ?? null);
    const savedCodes: string[] = slotsJson.monitoredFranchiseCodes ?? [];
    setMonitoredFranchiseCodes(savedCodes);
    if (savedCodes.length > 0) {
      setRuleFranchiseCode((prev) => (savedCodes.includes(prev) ? prev : savedCodes[0]));
    }
    if (slotsJson.user?.email) {
      setRuleEmail((prev) => prev || slotsJson.user?.email || "");
    }
    setSupabaseConfigured(Boolean(slotsJson.supabaseConfigured));
    setFetchedAt(slotsJson.fetchedAt ?? null);
    setFranchiseTypes(slotsJson.franchiseTypes ?? []);
    setRegionSlots(slotsJson.regionSlots ?? []);
    setProvinceSlots(slotsJson.provinceSlots ?? []);
    setLastRun(slotsJson.lastRun ?? null);
    setWatchRules(slotsJson.watchRules ?? []);
    setRecentNotifications(slotsJson.recentNotifications ?? []);
    setReservationProfiles(slotsJson.reservationProfiles ?? []);
    setSubmissionLogs(slotsJson.submissionLogs ?? []);
    setSavedAccount(slotsJson.savedAccount ?? null);
  }, []);

  const refreshLiveSlots = useCallback(async () => {
    setRefreshingLiveSlots(true);
    try {
      const res = await fetch("/api/slots?mode=live", { cache: "no-store" });
      if (!res.ok) return;
      const liveJson = (await res.json()) as DashboardPayload;
      setFetchedAt(liveJson.fetchedAt ?? null);
      if (liveJson.franchiseTypes?.length) {
        setFranchiseTypes(liveJson.franchiseTypes);
      }
      setRegionSlots(liveJson.regionSlots ?? []);
      setProvinceSlots(liveJson.provinceSlots ?? []);
    } finally {
      setRefreshingLiveSlots(false);
    }
  }, []);

  const loadData = useCallback(
    async (mode: SlotLoadMode = "cached") => {
      try {
        const slotsRes = await fetch(`/api/slots?mode=${mode}`, { cache: "no-store" });
        const slotsJson = (await slotsRes.json()) as DashboardPayload & { error?: string };
        if (!slotsRes.ok) {
          throw new Error(slotsJson.error || "Could not load LTFRB slot data.");
        }

        applyPayload(slotsJson);

        if (
          mode === "cached" &&
          (slotsJson.regionSlots.length === 0 || slotsJson.isStale)
        ) {
          void refreshLiveSlots();
        }
      } catch (err) {
        setBanner({
          kind: "error",
          text:
            err instanceof Error
              ? err.message
              : "We could not connect to LTFRB right now. Please try again in a minute.",
        });
      } finally {
        setLoading(false);
      }
    },
    [applyPayload, refreshLiveSlots]
  );

  useEffect(() => {
    if (initialData) {
      applyPayload(initialData);
      setLoading(false);
      if (initialData.regionSlots.length === 0 || initialData.isStale) {
        void refreshLiveSlots();
      }
      return;
    }
    void loadData("cached");
  }, [applyPayload, initialData, loadData, refreshLiveSlots]);

  const hasAccountFranchiseFilter =
    Boolean(user) && monitoredFranchiseCodes.length > 0 && !showAllPublicSlots;

  const visibleFranchiseTypes = useMemo(() => {
    if (!user || monitoredFranchiseCodes.length === 0) return franchiseTypes;
    return franchiseTypes.filter((ft) => monitoredFranchiseCodes.includes(ft.code));
  }, [franchiseTypes, monitoredFranchiseCodes, user]);

  const activeSlots = useMemo(() => {
    const base = viewScope === "region" ? regionSlots : provinceSlots;
    if (!hasAccountFranchiseFilter) return base;
    return base.filter((slot) => monitoredFranchiseCodes.includes(slot.franchiseTypeCode));
  }, [hasAccountFranchiseFilter, monitoredFranchiseCodes, provinceSlots, regionSlots, viewScope]);

  const areaOptions = useMemo(() => {
    const names = new Set<string>();
    for (const slot of activeSlots) {
      names.add(viewScope === "province" && slot.provinceName ? slot.provinceName : slot.regionName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [activeSlots, viewScope]);

  const filteredSlots = useMemo(() => {
    return activeSlots.filter((slot) => {
      if (selectedFranchiseCode !== "ALL" && slot.franchiseTypeCode !== selectedFranchiseCode) {
        return false;
      }
      const area =
        viewScope === "province" && slot.provinceName ? slot.provinceName : slot.regionName;
      if (selectedAreaName !== "ALL" && area !== selectedAreaName) {
        return false;
      }
      if (onlyOpenSlots && slot.remaining <= 0) {
        return false;
      }
      return true;
    });
  }, [activeSlots, onlyOpenSlots, selectedAreaName, selectedFranchiseCode, viewScope]);

  const openSlotsCount = useMemo(
    () => activeSlots.filter((s) => s.remaining > 0).length,
    [activeSlots]
  );

  const ruleRegionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of [...regionSlots, ...provinceSlots]) {
      map.set(s.regionCode, s.regionName);
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [provinceSlots, regionSlots]);

  const ruleProvinceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of provinceSlots) {
      if (s.provinceCode && s.provinceName) {
        map.set(s.provinceCode, `${s.provinceName} (${s.regionName})`);
      }
    }
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [provinceSlots]);

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMonitoredFranchiseCodes([]);
    setShowAllPublicSlots(false);
    setSavedAccount(null);
    setWatchRules([]);
    setRecentNotifications([]);
    setReservationProfiles([]);
    setSubmissionLogs([]);
    setBanner({ kind: "info", text: "You have signed out." });
  }

  async function handleCheckNow() {
    setCheckingNow(true);
    setBanner(null);

    try {
      if (!supabaseConfigured || !user) {
        await loadData("live");
        setBanner({
          kind: "info",
          text: user
            ? "Live slots refreshed from LTFRB."
            : "Live slots refreshed from LTFRB. Sign in to run your saved email alerts and auto-reservations.",
        });
        return;
      }

      const res = await fetch("/api/slots/check", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not run slot check.");
      }

      if (data.rateLimited) {
        setBanner({
          kind: "info",
          text: data.message || "Slots were just checked recently. Please wait 2 minutes.",
        });
        return;
      }

      await loadData();
      const sent = data.summary?.alertsSent ?? 0;
      const checked = data.summary?.recordsChecked ?? 0;
      const attempts = data.summary?.reservationsAttempted?.length ?? 0;
      setBanner({
        kind: "success",
        text: `Checked ${checked} slot entries. ${sent} email alert(s) sent, ${attempts} reservation attempt(s) run.`,
      });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Check failed. Please try again.",
      });
    } finally {
      setCheckingNow(false);
    }
  }

  async function handleSaveRule(e: React.FormEvent) {
    e.preventDefault();
    setSavingRule(true);
    setBanner(null);

    try {
      const selectedType = franchiseTypes.find((ft) => ft.code === ruleFranchiseCode);
      const selectedRegion = ruleRegionOptions.find((r) => r.code === ruleRegionCode);
      const selectedProvince = ruleProvinceOptions.find((p) => p.code === ruleProvinceCode);

      const fallbackLabel = `${selectedType?.name ?? ruleFranchiseCode} — ${
        ruleScope === "province"
          ? selectedProvince?.name ?? "All Provinces"
          : selectedRegion?.name ?? "All Regions"
      }`;

      const res = await fetch("/api/watch-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: ruleLabel.trim() || fallbackLabel,
          scope: ruleScope,
          franchise_type_code: ruleFranchiseCode,
          franchise_type_name:
            ruleFranchiseCode === "ALL"
              ? "All Franchise Types"
              : selectedType?.name ?? ruleFranchiseCode,
          region_code: ruleScope === "region" && ruleRegionCode !== "ALL" ? ruleRegionCode : null,
          region_name:
            ruleScope === "region" && ruleRegionCode !== "ALL"
              ? selectedRegion?.name ?? null
              : null,
          province_code:
            ruleScope === "province" && ruleProvinceCode !== "ALL" ? ruleProvinceCode : null,
          province_name:
            ruleScope === "province" && ruleProvinceCode !== "ALL"
              ? selectedProvince?.name ?? null
              : null,
          notify_email: ruleEmail.trim(),
          cooldown_minutes: Number(ruleCooldown) || 60,
          notify_when_available: notifyWhenAvailable,
          notify_when_increased: notifyWhenIncreased,
          notify_when_decreased: notifyWhenDecreased,
          min_remaining: 1,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not save alert rule.");
      }

      setRuleLabel("");
      await loadData();
      setBanner({
        kind: "success",
        text: "Your email alert is saved. We will email you as soon as a slot opens.",
      });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not save your alert.",
      });
    } finally {
      setSavingRule(false);
    }
  }

  async function handleToggleRule(rule: WatchRule) {
    setBanner(null);
    const res = await fetch("/api/watch-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rule.id, is_active: !rule.is_active }),
    });
    if (res.ok) {
      await loadData();
    } else {
      setBanner({ kind: "error", text: "Could not update that alert. Please try again." });
    }
  }

  async function handleDeleteRule(id: string) {
    setBanner(null);
    const res = await fetch(`/api/watch-rules?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadData();
      setBanner({ kind: "info", text: "Alert removed." });
    } else {
      setBanner({ kind: "error", text: "Could not remove that alert." });
    }
  }

  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    setSavingAccount(true);
    setBanner(null);

    try {
      const res = await fetch("/api/ltfrb/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: ltfrbAccountType,
          email: ltfrbEmail.trim(),
          password: ltfrbPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not sign in to LTFRB.");
      }

      setLtfrbPassword("");
      await loadData();
      setBanner({
        kind: "success",
        text: data.message || "Your LTFRB account is verified and saved securely.",
      });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Sign in failed. Please check your password.",
      });
    } finally {
      setSavingAccount(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F5F1] text-[#17191C]">
      {/* Simple, Calm Header */}
      <header className="bg-white">
        <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-[#17191C] sm:text-4xl">
                LTFRB Slot Helper
              </h1>
              <p className="mt-2 text-lg leading-relaxed text-[#374151]">
                Checks LTFRB franchise slots every 15 minutes, emails you, and reserves your spot.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/"
                className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#EEF1F4] px-5 py-3.5 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                Home
              </Link>

              <button
                type="button"
                onClick={handleCheckNow}
                disabled={checkingNow}
                className="min-h-12 shrink-0 rounded-xl bg-[#1447E6] px-6 py-3.5 text-lg font-bold text-white transition-colors hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
              >
                {checkingNow ? "Checking LTFRB..." : "Check Slots Now"}
              </button>

              {user ? (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="min-h-12 shrink-0 rounded-xl bg-[#EEF1F4] px-5 py-3.5 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                >
                  Sign Out
                </button>
              ) : (
                <Link
                  href="/login"
                  className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#17191C] px-6 py-3.5 text-lg font-bold text-white hover:bg-[#2C3036] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                >
                  Sign In
                </Link>
              )}
            </div>
          </div>

          {/* Plain-English Status Summary */}
          <div className="mt-6 rounded-xl bg-[#EEF1F4] px-5 py-4 text-base sm:text-lg">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
              <span>
                <strong>Last Checked:</strong>{" "}
                {formatManilaTime(lastRun?.finished_at ?? lastRun?.started_at ?? fetchedAt)}
              </span>
              <span>
                <strong>Open Now:</strong> {openSlotsCount} of {activeSlots.length}{" "}
                {viewScope === "region" ? "regional" : "provincial"} entries
              </span>
              <span>
                <strong>Your Status:</strong>{" "}
                {user ? `Signed in as ${user.email}` : "Viewing Public Slots (Not Signed In)"}
              </span>
            </div>
          </div>

          {/* Simple 4-Button Navigation */}
          <nav
            aria-label="Main Sections"
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <button
              type="button"
              onClick={() => setActiveTab("slots")}
              className={`min-h-12 rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                activeTab === "slots"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              1. Check Open Slots
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("alerts")}
              className={`min-h-12 rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                activeTab === "alerts"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              2. My Email Alerts {user ? `(${watchRules.length})` : "(Sign In)"}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("account")}
              className={`min-h-12 rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                activeTab === "account"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              3. My LTFRB Account {savedAccount ? "(Saved)" : user ? "" : "(Sign In)"}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("reserve")}
              className={`min-h-12 rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                activeTab === "reserve"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              4. Auto-Reserve Slot {user ? `(${reservationProfiles.length})` : "(Sign In)"}
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        {user && (
          <FranchisePickerCard
            franchiseTypes={franchiseTypes}
            savedCodes={monitoredFranchiseCodes}
            onSaved={async (codes) => {
              setMonitoredFranchiseCodes(codes);
              if (codes.length > 0 && !codes.includes(ruleFranchiseCode)) {
                setRuleFranchiseCode(codes[0]);
              }
              setSelectedFranchiseCode("ALL");
              await loadData();
            }}
            onBanner={setBanner}
          />
        )}

        {banner && (
          <div
            role="status"
            className={`mb-8 rounded-2xl p-6 text-lg leading-relaxed ${
              banner.kind === "success"
                ? "bg-[#DCFCE7] text-[#14532D]"
                : banner.kind === "error"
                ? "bg-[#FEE2E2] text-[#7F1D1D]"
                : "bg-[#DBEAFE] text-[#1E3A8A]"
            }`}
          >
            <p className="font-bold">{banner.text}</p>
          </div>
        )}

        {/* TAB 1: LIVE SLOTS */}
        {activeTab === "slots" && (
          <section aria-labelledby="slots-heading" className="space-y-8">
            <div className="rounded-2xl bg-white p-6 sm:p-8">
              <h2 id="slots-heading" className="text-2xl font-bold text-[#17191C]">
                Filter Available Slots
              </h2>
              <p className="mt-1 text-lg text-[#4B5563]">
                Pick whether to check by Region or by Province, then narrow down by franchise type.
              </p>

              <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setViewScope("region");
                    setSelectedAreaName("ALL");
                  }}
                  className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                    viewScope === "region"
                      ? "bg-[#1D4ED8] text-white"
                      : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
                  }`}
                >
                  Show By Region
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewScope("province");
                    setSelectedAreaName("ALL");
                  }}
                  className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                    viewScope === "province"
                      ? "bg-[#1D4ED8] text-white"
                      : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
                  }`}
                >
                  Show By Province
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="filter-franchise"
                    className="block text-lg font-bold text-[#17191C]"
                  >
                    Franchise Type
                  </label>
                  <select
                    id="filter-franchise"
                    value={selectedFranchiseCode}
                    onChange={(e) => setSelectedFranchiseCode(e.target.value)}
                    className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                  >
                    <option value="ALL">
                      {hasAccountFranchiseFilter
                        ? "All My Selected Franchises"
                        : "All Franchise Types"}
                    </option>
                    {(hasAccountFranchiseFilter ? visibleFranchiseTypes : franchiseTypes).map(
                      (ft) => (
                        <option key={ft.code} value={ft.code}>
                          {ft.name} ({ft.code})
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div>
                  <label htmlFor="filter-area" className="block text-lg font-bold text-[#17191C]">
                    {viewScope === "region" ? "Region" : "Province"}
                  </label>
                  <select
                    id="filter-area"
                    value={selectedAreaName}
                    onChange={(e) => setSelectedAreaName(e.target.value)}
                    className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                  >
                    <option value="ALL">
                      All {viewScope === "region" ? "Regions" : "Provinces"}
                    </option>
                    {areaOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={onlyOpenSlots}
                  onClick={() => setOnlyOpenSlots((prev) => !prev)}
                  className={`min-h-12 w-full rounded-xl px-5 py-3 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:w-auto ${
                    onlyOpenSlots
                      ? "bg-[#DCFCE7] text-[#14532D]"
                      : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
                  }`}
                >
                  {onlyOpenSlots
                    ? "Showing Open Slots Only (Tap to Show All)"
                    : "Show Only Open Slots (Hide Full Entries)"}
                </button>

                {user && monitoredFranchiseCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllPublicSlots((prev) => !prev);
                      setSelectedFranchiseCode("ALL");
                    }}
                    className="min-h-12 w-full rounded-xl bg-[#EEF1F4] px-5 py-3 text-left text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:w-auto"
                  >
                    {showAllPublicSlots
                      ? "Back to My Selected Franchises Only"
                      : "Peek at All LTFRB Franchises"}
                  </button>
                )}
              </div>
            </div>

            {loading || (refreshingLiveSlots && regionSlots.length === 0) ? (
              <div className="rounded-2xl bg-white p-8 text-center text-xl font-bold text-[#374151]">
                Loading live slot counts from LTFRB...
              </div>
            ) : filteredSlots.length === 0 ? (
              <div className="rounded-2xl bg-white p-8 text-center">
                <p className="text-xl font-bold text-[#17191C]">No matching slots found</p>
                <p className="mt-2 text-lg text-[#4B5563]">
                  Try choosing &ldquo;All Franchise Types&rdquo; or turning off &ldquo;Show Only
                  Open Slots&rdquo;.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-lg font-bold text-[#374151]">
                  Showing {filteredSlots.length} {viewScope === "region" ? "regional" : "provincial"}{" "}
                  entries
                </p>

                {filteredSlots.map((slot) => {
                  const isOpen = slot.remaining > 0;
                  const areaTitle =
                    slot.scope === "province" && slot.provinceName
                      ? `${slot.provinceName} — ${slot.regionName}`
                      : slot.regionName;

                  return (
                    <article key={slot.slotKey} className="rounded-2xl bg-white p-6 sm:p-7">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-xl font-bold text-[#17191C]">
                            {slot.franchiseTypeName}
                          </h3>
                          <p className="mt-1 text-lg text-[#374151]">{areaTitle}</p>
                          <p className="mt-2 text-base text-[#4B5563]">
                            {slot.filedApplication.toLocaleString()} applied out of{" "}
                            {slot.totalSlots.toLocaleString()} total slots (
                            {slot.percentage.toFixed(1)}% full)
                          </p>
                        </div>

                        <div className="flex flex-col items-start gap-3 sm:items-end">
                          <span
                            className={`inline-block rounded-xl px-5 py-2.5 text-lg font-bold ${
                              isOpen
                                ? "bg-[#DCFCE7] text-[#14532D]"
                                : "bg-[#E7E5E4] text-[#292524]"
                            }`}
                          >
                            {isOpen
                              ? `${slot.remaining.toLocaleString()} Slots Open`
                              : "Full (0 Slots Left)"}
                          </span>

                          {isOpen && (
                            <a
                              href="https://ltfrb-foa.ph/login"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#1D4ED8] px-5 py-3 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                            >
                              Apply on LTFRB Website
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 2: EMAIL ALERTS (Requires Sign In) */}
        {activeTab === "alerts" &&
          (!user ? (
            <SignInRequiredCard
              title="Sign In to Set Email Alerts"
              description="Please sign in to your account so you can save which franchise types to watch and receive automatic email notifications every 15 minutes."
            />
          ) : (
            <section aria-labelledby="alerts-heading" className="space-y-8">
              <form onSubmit={handleSaveRule} className="rounded-2xl bg-white p-6 sm:p-8">
                <h2 id="alerts-heading" className="text-2xl font-bold text-[#17191C]">
                  Send Me an Email When Slots Open
                </h2>
                <p className="mt-1 text-lg text-[#4B5563]">
                  Pick the franchise type and area you want to watch. We check automatically every
                  15 minutes.
                </p>

                <div className="mt-6 space-y-6">
                  <div>
                    <label htmlFor="rule-email" className="block text-lg font-bold text-[#17191C]">
                      Your Email Address
                    </label>
                    <input
                      id="rule-email"
                      type="email"
                      required
                      value={ruleEmail}
                      onChange={(e) => setRuleEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                    <p className="mt-1.5 text-base text-[#4B5563]">
                      We will send an email here the moment a slot becomes available.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <label htmlFor="rule-scope" className="block text-lg font-bold text-[#17191C]">
                        Watch By Region or Province
                      </label>
                      <select
                        id="rule-scope"
                        value={ruleScope}
                        onChange={(e) => setRuleScope(e.target.value as SlotScope)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        <option value="region">By Region</option>
                        <option value="province">By Province</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="rule-franchise"
                        className="block text-lg font-bold text-[#17191C]"
                      >
                        Franchise Type
                      </label>
                      <select
                        id="rule-franchise"
                        required
                        value={ruleFranchiseCode}
                        onChange={(e) => setRuleFranchiseCode(e.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        {visibleFranchiseTypes.length === 0 ? (
                          <option value="">Pick 1 or 2 franchises above first</option>
                        ) : (
                          visibleFranchiseTypes.map((ft) => (
                            <option key={ft.code} value={ft.code}>
                              {ft.name} ({ft.code})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>

                  {ruleScope === "region" ? (
                    <div>
                      <label
                        htmlFor="rule-region"
                        className="block text-lg font-bold text-[#17191C]"
                      >
                        Which Region?
                      </label>
                      <select
                        id="rule-region"
                        value={ruleRegionCode}
                        onChange={(e) => setRuleRegionCode(e.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        <option value="ALL">Any Region</option>
                        {ruleRegionOptions.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label
                        htmlFor="rule-province"
                        className="block text-lg font-bold text-[#17191C]"
                      >
                        Which Province?
                      </label>
                      <select
                        id="rule-province"
                        value={ruleProvinceCode}
                        onChange={(e) => setRuleProvinceCode(e.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        <option value="ALL">Any Province</option>
                        {ruleProvinceOptions.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div>
                      <label htmlFor="rule-label" className="block text-lg font-bold text-[#17191C]">
                        Nickname for This Alert (Optional)
                      </label>
                      <input
                        id="rule-label"
                        type="text"
                        value={ruleLabel}
                        onChange={(e) => setRuleLabel(e.target.value)}
                        placeholder="Example: My NCR TNVS Slot"
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="rule-cooldown"
                        className="block text-lg font-bold text-[#17191C]"
                      >
                        How Often to Repeat Emails
                      </label>
                      <select
                        id="rule-cooldown"
                        value={ruleCooldown}
                        onChange={(e) => setRuleCooldown(e.target.value)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        <option value="60">At most once every hour</option>
                        <option value="180">At most once every 3 hours</option>
                        <option value="15">Every 15 minutes while open</option>
                        <option value="0">Only once when slots first open</option>
                      </select>
                    </div>
                  </div>

                  {/* Notification Trigger Choices */}
                  <div className="rounded-xl bg-[#F6F5F1] p-5 sm:p-6">
                    <p className="text-lg font-bold text-[#17191C]">
                      When Should We Send You an Email?
                    </p>
                    <p className="mt-1 text-base text-[#4B5563]">
                      Pick one or more choices below.
                    </p>

                    <div className="mt-4 space-y-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={notifyWhenAvailable}
                        onClick={() => setNotifyWhenAvailable((prev) => !prev)}
                        className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                          notifyWhenAvailable
                            ? "bg-[#DCFCE7] text-[#14532D]"
                            : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                        }`}
                      >
                        {notifyWhenAvailable ? "ON: " : "OFF: "}When a slot is available (even if 0
                        open right now)
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={notifyWhenIncreased}
                        onClick={() => setNotifyWhenIncreased((prev) => !prev)}
                        className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                          notifyWhenIncreased
                            ? "bg-[#DCFCE7] text-[#14532D]"
                            : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                        }`}
                      >
                        {notifyWhenIncreased ? "ON: " : "OFF: "}When open slots INCREASE — New slot
                        is open and ready to apply (Recommended)
                      </button>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={notifyWhenDecreased}
                        onClick={() => setNotifyWhenDecreased((prev) => !prev)}
                        className={`min-h-12 w-full rounded-xl px-5 py-3.5 text-left text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                          notifyWhenDecreased
                            ? "bg-[#DCFCE7] text-[#14532D]"
                            : "bg-white text-[#17191C] hover:bg-[#E2E6EB]"
                        }`}
                      >
                        {notifyWhenDecreased ? "ON: " : "OFF: "}When open slots DECREASE (slots are
                        getting taken)
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={
                      savingRule ||
                      !supabaseConfigured ||
                      visibleFranchiseTypes.length === 0 ||
                      (!notifyWhenAvailable && !notifyWhenIncreased && !notifyWhenDecreased)
                    }
                    className="min-h-12 w-full rounded-xl bg-[#1D4ED8] px-6 py-4 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60 sm:w-auto"
                  >
                    {savingRule ? "Saving Alert..." : "Save Email Alert"}
                  </button>
                </div>
              </form>

              {/* Saved Watch Rules */}
              <div className="rounded-2xl bg-white p-6 sm:p-8">
                <h3 className="text-2xl font-bold text-[#17191C]">Your Saved Alerts</h3>
                {watchRules.length === 0 ? (
                  <p className="mt-3 text-lg text-[#4B5563]">
                    You do not have any saved alerts yet. Use the form above to add one.
                  </p>
                ) : (
                  <div className="mt-5 space-y-4">
                    {watchRules.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex flex-col gap-4 rounded-xl bg-[#EEF1F4] p-5 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xl font-bold text-[#17191C]">{rule.label}</p>
                          <p className="mt-1 text-lg text-[#374151]">
                            Emails: <strong>{rule.notify_email}</strong>
                          </p>
                          <p className="mt-1 text-base text-[#4B5563]">
                            Status:{" "}
                            <strong>{rule.is_active ? "Watching every 15 mins" : "Paused"}</strong>
                          </p>
                          <p className="mt-1 text-base text-[#4B5563]">
                            Emails when:{" "}
                            {[
                              (rule.notify_when_available ?? true) && "Slot is open",
                              (rule.notify_when_increased ?? true) && "Slots increase (new slot)",
                              rule.notify_when_decreased && "Slots decrease",
                            ]
                              .filter(Boolean)
                              .join(" • ")}
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => handleToggleRule(rule)}
                            className="min-h-12 rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#17191C] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                          >
                            {rule.is_active ? "Pause Alert" : "Turn On Alert"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(rule.id)}
                            className="min-h-12 rounded-xl bg-[#FEE2E2] px-5 py-3 text-lg font-bold text-[#7F1D1D] hover:bg-[#FECACA] focus:outline-none focus:ring-4 focus:ring-red-700/30"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Email History */}
              <div className="rounded-2xl bg-white p-6 sm:p-8">
                <h3 className="text-2xl font-bold text-[#17191C]">Recent Emails Sent</h3>
                {recentNotifications.length === 0 ? (
                  <p className="mt-3 text-lg text-[#4B5563]">No alert emails have been sent yet.</p>
                ) : (
                  <div className="mt-5 space-y-3">
                    {recentNotifications.map((log) => (
                      <div key={log.id} className="rounded-xl bg-[#EEF1F4] p-4">
                        <p className="text-lg font-bold text-[#17191C]">{log.subject}</p>
                        <p className="mt-1 text-base text-[#374151]">
                          Sent to {log.recipient} • {log.remaining_at_alert} open slot(s) •{" "}
                          {formatManilaTime(log.sent_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}

        {/* TAB 3: LTFRB ACCOUNT (Requires Sign In) */}
        {activeTab === "account" &&
          (!user ? (
            <SignInRequiredCard
              title="Sign In to Save Your LTFRB Account"
              description="For your privacy, please sign in first before viewing or saving your LTFRB login credentials."
            />
          ) : (
            <section aria-labelledby="account-heading" className="space-y-8">
              <form onSubmit={handleSaveAccount} className="rounded-2xl bg-white p-6 sm:p-8">
                <h2 id="account-heading" className="text-2xl font-bold text-[#17191C]">
                  Save Your LTFRB Login
                </h2>
                <p className="mt-2 text-lg leading-relaxed text-[#374151]">
                  Sign in with your existing <strong>ltfrb-foa.ph</strong> email and password. We
                  test your login directly with LTFRB and store it encrypted so automatic slot
                  reservation can submit for you.
                </p>

                {savedAccount && (
                  <div className="mt-5 rounded-xl bg-[#DCFCE7] p-5 text-[#14532D]">
                    <p className="text-lg font-bold">
                      Connected Account: {savedAccount.ltfrb_email} ({savedAccount.account_type})
                    </p>
                    <p className="mt-1 text-base">
                      Last verified: {formatManilaTime(savedAccount.last_verified_at)}
                    </p>
                  </div>
                )}

                <div className="mt-6 space-y-6">
                  <div>
                    <label htmlFor="ltfrb-type" className="block text-lg font-bold text-[#17191C]">
                      Account Type
                    </label>
                    <select
                      id="ltfrb-type"
                      value={ltfrbAccountType}
                      onChange={(e) => setLtfrbAccountType(e.target.value as "operator" | "tnc")}
                      className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    >
                      <option value="operator">Operator Account</option>
                      <option value="tnc">TNC Account</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ltfrb-email" className="block text-lg font-bold text-[#17191C]">
                      LTFRB Login Email
                    </label>
                    <input
                      id="ltfrb-email"
                      type="email"
                      required
                      value={ltfrbEmail}
                      onChange={(e) => setLtfrbEmail(e.target.value)}
                      placeholder="your-ltfrb-email@example.com"
                      className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="ltfrb-password"
                      className="block text-lg font-bold text-[#17191C]"
                    >
                      LTFRB Password
                    </label>
                    <input
                      id="ltfrb-password"
                      type="password"
                      required
                      value={ltfrbPassword}
                      onChange={(e) => setLtfrbPassword(e.target.value)}
                      placeholder="Enter your LTFRB password"
                      className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                    />
                    <p className="mt-1.5 text-base text-[#4B5563]">
                      Your password is encrypted on the server and is never shown again on screen.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={savingAccount || !supabaseConfigured}
                    className="min-h-12 w-full rounded-xl bg-[#1D4ED8] px-6 py-4 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60 sm:w-auto"
                  >
                    {savingAccount ? "Testing Login..." : "Test & Save LTFRB Login"}
                  </button>
                </div>
              </form>
            </section>
          ))}

        {/* TAB 4: AUTOMATIC SLOT RESERVATION (Requires Sign In) */}
        {activeTab === "reserve" &&
          (!user ? (
            <SignInRequiredCard
              title="Sign In to Use Automatic Slot Reservation"
              description="Please sign in first to save your vehicle details, turn on automatic slot reservation, and view submission results."
            />
          ) : (
            <AutoReserveTab
              franchiseTypes={franchiseTypes}
              monitoredFranchiseCodes={monitoredFranchiseCodes}
              hasSavedLtfrbAccount={Boolean(savedAccount)}
              userEmail={user.email}
              profiles={reservationProfiles}
              submissionLogs={submissionLogs}
              onGoToAccountTab={() => setActiveTab("account")}
              onRefresh={loadData}
              onBanner={setBanner}
            />
          ))}
      </main>
    </div>
  );
}
