"use client";

import { useEffect, useMemo, useState } from "react";
import ModalDialog from "@/components/ModalDialog";
import type { ApplicationProfile, SubmissionLogRow, WatchRule } from "@/lib/ltfrb/types";
import type { CronRunSummary, NotificationLogSummary } from "@/lib/monitor/dashboard-data";
import type { PaymentRequestRow } from "@/lib/monitor/monetization";
import {
  analyzeSlotTiming,
  filterEventsForUserSelection,
  type SlotMovementEvent,
} from "@/lib/monitor/slot-analytics";
import { formatSubmissionTriggerDisplay } from "@/lib/monitor/submission-trigger";

interface ActivityLogsTabProps {
  recentRuns: CronRunSummary[];
  slotEvents: SlotMovementEvent[];
  monitoredFranchiseCodes: string[];
  watchRules: WatchRule[];
  submissionLogs: SubmissionLogRow[];
  recentNotifications: NotificationLogSummary[];
  paymentRequests: PaymentRequestRow[];
  reservationProfiles: ApplicationProfile[];
  onRefresh: () => Promise<void>;
}

type LogCategory = "all" | "movements" | "submissions" | "emails" | "checks" | "payments";
type ServerLogCategory = "movements" | "submissions" | "emails" | "checks";

const PAGE_SIZE = 10;
const SERVER_FETCH_BATCH = 40;

function formatCompactHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12–1 AM";
  if (normalized === 11) return "11 AM–12 PM";
  if (normalized === 12) return "12–1 PM";
  if (normalized === 23) return "11 PM–12 AM";
  const period = normalized >= 12 ? "PM" : "AM";
  const h12 = normalized > 12 ? normalized - 12 : normalized;
  return `${h12}–${h12 + 1} ${period}`;
}

function formatManilaTime(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function mergeById<T extends { id: string }>(primary: T[], older: T[]): T[] {
  if (older.length === 0) return primary;
  const seen = new Set(primary.map((item) => item.id));
  const merged = [...primary];
  for (const item of older) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

function movementBadge(ev: SlotMovementEvent): { style: string; text: string; areaLabel: string } {
  const areaLabel =
    ev.scope === "province" && ev.province_name
      ? `${ev.province_name} (${ev.region_name ?? ""})`
      : ev.region_name ?? ev.slot_key;

  if (ev.event_type === "refilled") {
    return {
      style: "bg-[#DCFCE7] text-[#14532D]",
      text: `New Open Refill (+${ev.delta})`,
      areaLabel,
    };
  }
  if (ev.event_type === "increased") {
    return {
      style: "bg-[#DBEAFE] text-[#1E3A8A]",
      text: `Increased (+${ev.delta})`,
      areaLabel,
    };
  }
  return {
    style: "bg-[#E4E4E7] text-[#27272A]",
    text: `Decreased (${ev.delta})`,
    areaLabel,
  };
}

interface PaginationBarProps {
  page: number;
  totalItems: number;
  pageSize: number;
  hasMoreOnServer?: boolean;
  loadingMore?: boolean;
  onPrev: () => void;
  onNext: () => void;
}

function PaginationBar({
  page,
  totalItems,
  pageSize,
  hasMoreOnServer = false,
  loadingMore = false,
  onPrev,
  onNext,
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize && !hasMoreOnServer) return null;

  const startIdx = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIdx = Math.min(totalItems, page * pageSize);
  const canGoNext = page < totalPages || hasMoreOnServer;

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-[#F4F4F5] px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-base font-bold text-[#3F3F46]">
        {startIdx}–{endIdx} of {totalItems}
        {hasMoreOnServer ? "+" : ""} (Page {page}/{totalPages})
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={page <= 1 || loadingMore}
          onClick={onPrev}
          className="min-h-12 rounded-xl bg-white px-4 py-2 text-base font-bold text-[#0A0A0A] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-50"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!canGoNext || loadingMore}
          onClick={onNext}
          className="min-h-12 rounded-xl bg-[#1447E6] px-4 py-2 text-base font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-50"
        >
          {loadingMore
            ? "Loading Older..."
            : page >= totalPages && hasMoreOnServer
            ? "Load Older Logs →"
            : "Next"}
        </button>
      </div>
    </div>
  );
}

export default function ActivityLogsTab({
  recentRuns,
  slotEvents,
  monitoredFranchiseCodes,
  watchRules,
  submissionLogs,
  recentNotifications,
  paymentRequests,
  reservationProfiles,
  onRefresh,
}: ActivityLogsTabProps) {
  const hasUserFilter =
    watchRules.some((r) => r.is_active) ||
    reservationProfiles.length > 0 ||
    monitoredFranchiseCodes.length > 0;

  const [category, setCategory] = useState<LogCategory>("all");
  const [onlyMyFranchises, setOnlyMyFranchises] = useState(hasUserFilter);
  const [refreshing, setRefreshing] = useState(false);

  // Selected hour for Hourly Slot Activity modal
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [hourModalPage, setHourModalPage] = useState(1);

  // Client pagination + server-loaded older history per section
  const [pages, setPages] = useState<Record<Exclude<LogCategory, "all">, number>>({
    movements: 1,
    submissions: 1,
    emails: 1,
    checks: 1,
    payments: 1,
  });
  const [extraMovements, setExtraMovements] = useState<SlotMovementEvent[]>([]);
  const [extraSubmissions, setExtraSubmissions] = useState<SubmissionLogRow[]>([]);
  const [extraEmails, setExtraEmails] = useState<NotificationLogSummary[]>([]);
  const [extraRuns, setExtraRuns] = useState<CronRunSummary[]>([]);
  const [serverHasMore, setServerHasMore] = useState<Record<ServerLogCategory, boolean>>({
    movements: slotEvents.length >= 1000,
    submissions: submissionLogs.length >= 40,
    emails: recentNotifications.length >= 40,
    checks: recentRuns.length >= 60,
  });
  const [loadingCategory, setLoadingCategory] = useState<ServerLogCategory | null>(null);

  useEffect(() => {
    setServerHasMore((prev) => ({
      movements: prev.movements || slotEvents.length >= 1000,
      submissions: prev.submissions || submissionLogs.length >= 40,
      emails: prev.emails || recentNotifications.length >= 40,
      checks: prev.checks || recentRuns.length >= 60,
    }));
  }, [
    recentNotifications.length,
    recentRuns.length,
    slotEvents.length,
    submissionLogs.length,
  ]);

  const allMovements = useMemo(
    () => mergeById(slotEvents, extraMovements),
    [extraMovements, slotEvents]
  );
  const allSubmissions = useMemo(
    () => mergeById(submissionLogs, extraSubmissions),
    [extraSubmissions, submissionLogs]
  );
  const allNotifications = useMemo(
    () => mergeById(recentNotifications, extraEmails),
    [extraEmails, recentNotifications]
  );
  const allRuns = useMemo(
    () => mergeById(recentRuns, extraRuns),
    [extraRuns, recentRuns]
  );

  const profileNameById = new Map<string, string>();
  for (const p of reservationProfiles) {
    profileNameById.set(p.id, p.profile_name);
  }

  const userSelection = useMemo(
    () =>
      filterEventsForUserSelection({
        events: allMovements,
        watchRules,
        reservationProfiles,
        monitoredFranchiseCodes,
      }),
    [allMovements, monitoredFranchiseCodes, reservationProfiles, watchRules]
  );

  const filteredEvents = useMemo(
    () => (onlyMyFranchises && hasUserFilter ? userSelection.events : allMovements),
    [allMovements, hasUserFilter, onlyMyFranchises, userSelection.events]
  );

  const analysis = useMemo(() => analyzeSlotTiming(filteredEvents), [filteredEvents]);

  const eventsByHour = useMemo(() => {
    const map = new Map<number, SlotMovementEvent[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.manila_hour) ?? [];
      list.push(ev);
      map.set(ev.manila_hour, list);
    }
    return map;
  }, [filteredEvents]);

  const maxHourCount = useMemo(
    () => Math.max(1, ...analysis.activeHours.map((h) => h.openings + h.decreases)),
    [analysis.activeHours]
  );

  const selectedHourStat = useMemo(
    () =>
      selectedHour === null
        ? null
        : analysis.activeHours.find((h) => h.hour === selectedHour) ?? null,
    [analysis.activeHours, selectedHour]
  );

  const selectedHourEvents = useMemo(
    () => (selectedHour === null ? [] : eventsByHour.get(selectedHour) ?? []),
    [eventsByHour, selectedHour]
  );

  function openHourModal(hour: number) {
    setSelectedHour(hour);
    setHourModalPage(1);
  }

  function closeHourModal() {
    setSelectedHour(null);
    setHourModalPage(1);
  }

  async function loadMoreFromServer(target: ServerLogCategory): Promise<number> {
    if (loadingCategory) return 0;
    const offset =
      target === "movements"
        ? allMovements.length
        : target === "submissions"
        ? allSubmissions.length
        : target === "emails"
        ? allNotifications.length
        : allRuns.length;

    setLoadingCategory(target);
    try {
      const res = await fetch(
        `/api/logs?category=${target}&offset=${offset}&limit=${SERVER_FETCH_BATCH}`,
        { cache: "no-store" }
      );
      if (!res.ok) return 0;
      const json = (await res.json()) as { items?: unknown[]; hasMore?: boolean };
      const items = json.items ?? [];
      setServerHasMore((prev) => ({ ...prev, [target]: Boolean(json.hasMore) }));

      if (target === "movements") {
        setExtraMovements((prev) => mergeById(prev, items as SlotMovementEvent[]));
      } else if (target === "submissions") {
        setExtraSubmissions((prev) => mergeById(prev, items as SubmissionLogRow[]));
      } else if (target === "emails") {
        setExtraEmails((prev) => mergeById(prev, items as NotificationLogSummary[]));
      } else {
        setExtraRuns((prev) => mergeById(prev, items as CronRunSummary[]));
      }
      return items.length;
    } finally {
      setLoadingCategory(null);
    }
  }

  async function handleNextPage(
    section: Exclude<LogCategory, "all">,
    loadedCount: number
  ) {
    const current = pages[section];
    const totalPages = Math.max(1, Math.ceil(loadedCount / PAGE_SIZE));
    if (current < totalPages) {
      setPages((prev) => ({ ...prev, [section]: current + 1 }));
      return;
    }
    if (section !== "payments" && serverHasMore[section]) {
      const added = await loadMoreFromServer(section);
      if (added > 0) {
        setPages((prev) => ({ ...prev, [section]: current + 1 }));
      }
    }
  }

  function handlePrevPage(section: Exclude<LogCategory, "all">) {
    setPages((prev) => ({ ...prev, [section]: Math.max(1, prev[section] - 1) }));
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  const safeMovementsPage = Math.min(
    pages.movements,
    Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE))
  );
  const pagedMovements = filteredEvents.slice(
    (safeMovementsPage - 1) * PAGE_SIZE,
    safeMovementsPage * PAGE_SIZE
  );
  const pagedSubmissions = allSubmissions.slice(
    (pages.submissions - 1) * PAGE_SIZE,
    pages.submissions * PAGE_SIZE
  );
  const pagedNotifications = allNotifications.slice(
    (pages.emails - 1) * PAGE_SIZE,
    pages.emails * PAGE_SIZE
  );
  const pagedRuns = allRuns.slice(
    (pages.checks - 1) * PAGE_SIZE,
    pages.checks * PAGE_SIZE
  );
  const pagedPayments = paymentRequests.slice(
    (pages.payments - 1) * PAGE_SIZE,
    pages.payments * PAGE_SIZE
  );

  return (
    <section aria-labelledby="logs-heading" className="space-y-6">
      {/* Header & Category Tabs */}
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="logs-heading" className="text-2xl font-bold text-[#0A0A0A]">
              Best Time to Submit &amp; Activity Logs
            </h2>
            <p className="mt-1 text-lg text-[#52525B]">
              Analyze when LTFRB slots refill, increase, or get taken, and browse paginated history
              across all checks, emails, reservations, and payments.
            </p>
          </div>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            className="min-h-12 shrink-0 rounded-xl bg-[#EEF1F4] px-5 py-3 text-lg font-bold text-[#0A0A0A] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
          >
            {refreshing ? "Refreshing..." : "Refresh Logs"}
          </button>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {[
            { id: "all" as const, label: "All Logs" },
            { id: "movements" as const, label: `Slot Movements (${filteredEvents.length})` },
            { id: "submissions" as const, label: `Auto-Reserve (${allSubmissions.length})` },
            { id: "emails" as const, label: `Email Alerts (${allNotifications.length})` },
            { id: "checks" as const, label: `Slot Checks (${allRuns.length})` },
            { id: "payments" as const, label: `Payments (${paymentRequests.length})` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCategory(item.id)}
              className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                category === item.id
                  ? "bg-[#1447E6] text-white"
                  : "bg-[#F4F4F5] text-[#18181B] hover:bg-[#E4E4E7]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Best Time to Submit Analysis */}
      {(category === "all" || category === "movements") && (
        <div className="space-y-6 rounded-2xl bg-white p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-2xl font-bold text-[#0A0A0A]">
                When Do Slots Open? (Best Time Analysis)
              </h3>
              <p className="mt-1 text-base text-[#52525B]">
                {onlyMyFranchises && userSelection.targetLabels.length > 0
                  ? `Tracking your chosen slot(s): ${userSelection.targetLabels.join(" • ")}`
                  : "Tracks exact timestamps (Manila Time) whenever LTFRB slots refill from 0, increase, or decrease."}
              </p>
            </div>

            {hasUserFilter && (
              <button
                type="button"
                onClick={() => {
                  setOnlyMyFranchises((prev) => !prev);
                  setPages((prev) => ({ ...prev, movements: 1 }));
                }}
                className={`min-h-12 shrink-0 rounded-xl px-5 py-3 text-base font-bold transition-colors ${
                  onlyMyFranchises
                    ? "bg-[#EFF6FF] text-[#102E7A]"
                    : "bg-[#F4F4F5] text-[#18181B]"
                }`}
              >
                {onlyMyFranchises
                  ? "Showing Only My Chosen Slots (Tap for All)"
                  : "Showing All LTFRB Franchises (Tap for Mine)"}
              </button>
            )}
          </div>

          {/* Plain-English Timing Recommendation */}
          <div className="rounded-xl bg-[#EFF6FF] p-5 text-[#102E7A]">
            <p className="text-lg font-bold leading-relaxed">{analysis.recommendation}</p>
          </div>

          {/* 4 Summary Metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-[#DCFCE7] p-5 text-[#14532D]">
              <p className="text-base font-bold">New Open Refills (0 → Open)</p>
              <p className="mt-1 text-3xl font-bold">{analysis.refillCount}</p>
            </div>
            <div className="rounded-xl bg-[#DBEAFE] p-5 text-[#1E3A8A]">
              <p className="text-base font-bold">Slot Increases (+Slots)</p>
              <p className="mt-1 text-3xl font-bold">{analysis.increaseCount}</p>
            </div>
            <div className="rounded-xl bg-[#F4F4F5] p-5 text-[#0A0A0A]">
              <p className="text-base font-bold">Slots Taken / Decreased</p>
              <p className="mt-1 text-3xl font-bold">{analysis.decreaseCount}</p>
            </div>
            <div className="rounded-xl bg-[#F4F4F5] p-5 text-[#0A0A0A]">
              <p className="text-base font-bold">Avg. Time Until Full</p>
              <p className="mt-1 text-3xl font-bold">
                {analysis.avgMinutesToFill !== null
                  ? `${Math.max(1, analysis.avgMinutesToFill)} min`
                  : "—"}
              </p>
            </div>
          </div>

          {/* Top Hours (Clickable & Expandable) & Best Days */}
          {analysis.activeHours.length > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl bg-[#F4F4F5] p-4 sm:p-5">
                <h4 className="text-xl font-bold text-[#0A0A0A]">
                  Hourly Slot Activity (Manila Time)
                </h4>
                <p className="mt-1 text-base text-[#52525B]">
                  Tap any hour to view detailed changes inside a modal.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {analysis.activeHours.map((h) => {
                    const total = h.openings + h.decreases;
                    const pct = Math.max(8, Math.round((total / maxHourCount) * 100));
                    const hourEventsCount = (eventsByHour.get(h.hour) ?? []).length;
                    const statParts: string[] = [];
                    if (h.refills > 0) statParts.push(`${h.refills} ref`);
                    if (h.increases > 0) statParts.push(`+${h.increases}`);
                    if (h.decreases > 0) statParts.push(`${h.decreases} dec`);

                    return (
                      <button
                        key={h.hour}
                        type="button"
                        title={`View details for ${h.label}`}
                        onClick={() => openHourModal(h.hour)}
                        className="min-h-12 w-full rounded-lg bg-white px-3 py-2 text-left transition-colors hover:bg-[#EFF6FF] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                      >
                        <div className="flex items-center justify-between gap-2 text-base">
                          <span className="font-bold text-[#0A0A0A]">
                            {formatCompactHourLabel(h.hour)}
                          </span>
                          <span
                            className={`shrink-0 rounded-md px-2 py-0.5 text-base font-bold ${
                              h.openings > 0
                                ? "bg-[#EFF6FF] text-[#1447E6]"
                                : "bg-[#F4F4F5] text-[#3F3F46]"
                            }`}
                          >
                            {statParts.join(" · ")} ({hourEventsCount})
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-lg bg-[#F4F4F5]">
                          <div
                            className={`h-1.5 rounded-lg ${
                              h.openings > 0 ? "bg-[#1447E6]" : "bg-[#A1A1AA]"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl bg-[#F4F4F5] p-5">
                <h4 className="text-xl font-bold text-[#0A0A0A]">
                  Most Active Days for New Openings
                </h4>
                {analysis.topDays.length === 0 ? (
                  <p className="mt-3 text-base text-[#52525B]">
                    No refill or slot increase days recorded yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {analysis.topDays.map((day) => (
                      <div
                        key={day.weekday}
                        className="flex items-center justify-between rounded-xl bg-white p-4"
                      >
                        <span className="text-lg font-bold text-[#0A0A0A]">{day.name}</span>
                        <span className="rounded-xl bg-[#DCFCE7] px-3 py-1 text-base font-bold text-[#14532D]">
                          {day.refills} refill(s) • {day.openings} total opening(s)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Timestamped Slot Movement Log (Paginated) */}
          <div>
            <h4 className="text-xl font-bold text-[#0A0A0A]">
              Timestamped Slot Refills, Increases &amp; Decreases
            </h4>
            {filteredEvents.length === 0 ? (
              <p className="mt-2 text-base text-[#52525B]">
                No slot count changes observed yet for this filter. Keep Automatic Check running
                every 3 minutes to log exact movement timestamps.
              </p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {pagedMovements.map((ev) => {
                    const badge = movementBadge(ev);
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#F4F4F5] px-3.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-bold text-[#0A0A0A]">
                            {ev.franchise_type_code} — {badge.areaLabel}
                          </p>
                          <p className="text-base text-[#52525B]">
                            {formatManilaTime(ev.occurred_at)} ·{" "}
                            <strong>
                              {ev.previous_remaining} → {ev.new_remaining}
                            </strong>
                          </p>
                        </div>
                        <span
                          className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold ${badge.style}`}
                        >
                          {badge.text}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <PaginationBar
                  page={safeMovementsPage}
                  totalItems={filteredEvents.length}
                  pageSize={PAGE_SIZE}
                  hasMoreOnServer={serverHasMore.movements}
                  loadingMore={loadingCategory === "movements"}
                  onPrev={() =>
                    setPages((prev) => ({
                      ...prev,
                      movements: Math.max(1, safeMovementsPage - 1),
                    }))
                  }
                  onNext={() => void handleNextPage("movements", filteredEvents.length)}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* 1. Auto-Reserve Submission Logs */}
      {(category === "all" || category === "submissions") && (
        <div className="rounded-2xl bg-white p-5 sm:p-6">
          <h3 className="text-xl font-bold text-[#0A0A0A]">Auto-Reserve Submission History</h3>
          {allSubmissions.length === 0 ? (
            <p className="mt-2 text-base text-[#52525B]">
              No reservation attempts recorded for your account yet.
            </p>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {pagedSubmissions.map((log) => {
                  const profileLabel =
                    profileNameById.get(log.application_profile_id) ?? "Saved Application";
                  const badgeStyle =
                    log.result === "success"
                      ? "bg-[#DCFCE7] text-[#14532D]"
                      : log.result === "full_slot"
                      ? "bg-[#DBEAFE] text-[#1E3A8A]"
                      : "bg-[#FEE2E2] text-[#7F1D1D]";
                  const badgeLabel =
                    log.result === "success"
                      ? "Submitted"
                      : log.result === "full_slot"
                      ? "Slot Full"
                      : log.result === "auth_error"
                      ? "Login Error"
                      : "Needs Attention";
                  const triggerDisplay = formatSubmissionTriggerDisplay(log);

                  return (
                    <div key={log.id} className="rounded-lg bg-[#F4F4F5] px-3.5 py-2.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-base font-bold text-[#0A0A0A]">
                          {profileLabel}
                          {log.reference_number ? ` · Case #${log.reference_number}` : ""} ·{" "}
                          <span className="font-normal text-[#52525B]">
                            {formatManilaTime(log.attempted_at)}
                            {log.http_status ? ` · HTTP ${log.http_status}` : ""}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold ${triggerDisplay.badgeStyle}`}
                          >
                            {triggerDisplay.badgeLabel}
                          </span>
                          <span
                            className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold ${badgeStyle}`}
                          >
                            {badgeLabel}
                          </span>
                        </div>
                      </div>
                      {triggerDisplay.detailText && (
                        <p className="mt-1 rounded-md bg-white px-2.5 py-1 text-base font-bold text-[#18181B]">
                          Trigger: {triggerDisplay.detailText}
                        </p>
                      )}
                      {log.message && (
                        <p className="mt-1 line-clamp-2 text-base leading-snug text-[#3F3F46]">
                          {log.message}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationBar
                page={pages.submissions}
                totalItems={allSubmissions.length}
                pageSize={PAGE_SIZE}
                hasMoreOnServer={serverHasMore.submissions}
                loadingMore={loadingCategory === "submissions"}
                onPrev={() => handlePrevPage("submissions")}
                onNext={() => void handleNextPage("submissions", allSubmissions.length)}
              />
            </>
          )}
        </div>
      )}

      {/* 2. Email Notification Logs */}
      {(category === "all" || category === "emails") && (
        <div className="rounded-2xl bg-white p-5 sm:p-6">
          <h3 className="text-xl font-bold text-[#0A0A0A]">Email Alert History</h3>
          {allNotifications.length === 0 ? (
            <p className="mt-2 text-base text-[#52525B]">No alert emails sent to you yet.</p>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {pagedNotifications.map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col gap-2 rounded-lg bg-[#F4F4F5] px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-[#0A0A0A]">{log.subject}</p>
                      <p className="text-base text-[#52525B]">
                        {log.recipient} · {log.remaining_at_alert} open ·{" "}
                        {formatManilaTime(log.sent_at)}
                      </p>
                    </div>
                    <span
                      className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold uppercase ${
                        log.status === "sent"
                          ? "bg-[#DCFCE7] text-[#14532D]"
                          : log.status === "failed"
                          ? "bg-[#FEE2E2] text-[#7F1D1D]"
                          : "bg-[#E4E4E7] text-[#3F3F46]"
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>
              <PaginationBar
                page={pages.emails}
                totalItems={allNotifications.length}
                pageSize={PAGE_SIZE}
                hasMoreOnServer={serverHasMore.emails}
                loadingMore={loadingCategory === "emails"}
                onPrev={() => handlePrevPage("emails")}
                onNext={() => void handleNextPage("emails", allNotifications.length)}
              />
            </>
          )}
        </div>
      )}

      {/* 3. Automatic Slot Checks */}
      {(category === "all" || category === "checks") && (
        <div className="rounded-2xl bg-white p-5 sm:p-6">
          <h3 className="text-xl font-bold text-[#0A0A0A]">Automatic Slot Check History</h3>
          {allRuns.length === 0 ? (
            <p className="mt-2 text-base text-[#52525B]">No slot check runs recorded yet.</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {pagedRuns.map((run) => (
                  <div key={run.id} className="rounded-lg bg-[#F4F4F5] px-3.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-bold text-[#0A0A0A]">
                          {run.trigger_source === "manual" ? "Manual Check" : "Auto Check (3m)"} ·{" "}
                          <span className="font-normal text-[#52525B]">
                            {formatManilaTime(run.finished_at ?? run.started_at)}
                          </span>
                        </p>
                        <p className="text-base text-[#52525B]">
                          {run.records_checked} entries · {run.alerts_sent} alert(s)
                        </p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold uppercase ${
                          run.status === "success"
                            ? "bg-[#DCFCE7] text-[#14532D]"
                            : run.status === "error"
                            ? "bg-[#FEE2E2] text-[#7F1D1D]"
                            : "bg-[#DBEAFE] text-[#1E3A8A]"
                        }`}
                      >
                        {run.status === "success" ? "Done" : run.status}
                      </span>
                    </div>
                    {run.error_message && (
                      <p className="mt-1 text-base font-bold text-[#7F1D1D]">
                        {run.error_message}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <PaginationBar
                page={pages.checks}
                totalItems={allRuns.length}
                pageSize={PAGE_SIZE}
                hasMoreOnServer={serverHasMore.checks}
                loadingMore={loadingCategory === "checks"}
                onPrev={() => handlePrevPage("checks")}
                onNext={() => void handleNextPage("checks", allRuns.length)}
              />
            </>
          )}
        </div>
      )}

      {/* 4. Payment & Plan Logs */}
      {(category === "all" || category === "payments") && (
        <div className="rounded-2xl bg-white p-5 sm:p-6">
          <h3 className="text-xl font-bold text-[#0A0A0A]">Plan &amp; Payment History</h3>
          {paymentRequests.length === 0 ? (
            <p className="mt-2 text-base text-[#52525B]">
              No GCash or Maya payment requests submitted yet.
            </p>
          ) : (
            <>
              <div className="mt-3 space-y-2">
                {pagedPayments.map((req) => {
                  const items: string[] = [];
                  if (req.includes_annual_plan) items.push("1-Year Plan");
                  if (req.requested_extra_profiles > 0) {
                    items.push(`+${req.requested_extra_profiles} Auto-Reserve Profile(s)`);
                  }
                  if (req.requested_extra_alerts > 0) {
                    items.push(`+${req.requested_extra_alerts} Alert Slot(s)`);
                  }
                  return (
                    <div key={req.id} className="rounded-lg bg-[#F4F4F5] px-3.5 py-2.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-base font-bold text-[#0A0A0A]">
                            ₱{req.expected_amount_php.toLocaleString("en-PH")} —{" "}
                            {items.join(" + ")}
                          </p>
                          <p className="text-base text-[#52525B]">
                            Ref: <strong>{req.reference_number}</strong> ·{" "}
                            {formatManilaTime(req.created_at)}
                          </p>
                        </div>
                        <span
                          className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold uppercase ${
                            req.status === "approved"
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : req.status === "rejected"
                              ? "bg-[#FEE2E2] text-[#7F1D1D]"
                              : "bg-[#DBEAFE] text-[#1E3A8A]"
                          }`}
                        >
                          {req.status}
                        </span>
                      </div>
                      {req.rejection_reason && (
                        <p className="mt-1 rounded-md bg-[#FEE2E2] px-2.5 py-1 text-base font-bold text-[#7F1D1D]">
                          Note: {req.rejection_reason}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <PaginationBar
                page={pages.payments}
                totalItems={paymentRequests.length}
                pageSize={PAGE_SIZE}
                onPrev={() => handlePrevPage("payments")}
                onNext={() => void handleNextPage("payments", paymentRequests.length)}
              />
            </>
          )}
        </div>
      )}

      {/* Hourly Slot Activity Details Modal */}
      <ModalDialog
        open={selectedHourStat !== null}
        title={
          selectedHourStat
            ? `${selectedHourStat.label} (Manila Time)`
            : "Hourly Slot Activity Details"
        }
        subtitle={
          selectedHourStat
            ? `${selectedHourStat.refills} new open refill(s) • ${selectedHourStat.increases} increase(s) • ${selectedHourStat.decreases} decrease(s) • ${selectedHourEvents.length} event(s) recorded`
            : undefined
        }
        titleId="hour-activity-modal-title"
        maxWidthClass="max-w-3xl"
        onClose={closeHourModal}
      >
        {selectedHourEvents.length === 0 ? (
          <p className="text-base text-[#52525B]">No detailed events recorded for this hour.</p>
        ) : (
          <>
            <div className="space-y-2">
              {selectedHourEvents
                .slice((hourModalPage - 1) * PAGE_SIZE, hourModalPage * PAGE_SIZE)
                .map((ev) => {
                  const badge = movementBadge(ev);
                  return (
                    <div
                      key={ev.id}
                      className="flex flex-col gap-2 rounded-lg bg-[#F4F4F5] px-3.5 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-bold text-[#0A0A0A]">
                          {ev.franchise_type_code} — {badge.areaLabel}
                        </p>
                        <p className="text-base text-[#52525B]">
                          {formatManilaTime(ev.occurred_at)} ·{" "}
                          <strong>
                            {ev.previous_remaining} → {ev.new_remaining}
                          </strong>
                        </p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-lg px-2.5 py-1 text-base font-bold ${badge.style}`}
                      >
                        {badge.text}
                      </span>
                    </div>
                  );
                })}
            </div>
            <PaginationBar
              page={hourModalPage}
              totalItems={selectedHourEvents.length}
              pageSize={PAGE_SIZE}
              onPrev={() => setHourModalPage((p) => Math.max(1, p - 1))}
              onNext={() =>
                setHourModalPage((p) =>
                  Math.min(Math.ceil(selectedHourEvents.length / PAGE_SIZE), p + 1)
                )
              }
            />
          </>
        )}
      </ModalDialog>
    </section>
  );
}
