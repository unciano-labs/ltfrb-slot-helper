"use client";

import { useMemo, useState } from "react";
import type { ApplicationProfile, SubmissionLogRow } from "@/lib/ltfrb/types";
import type { CronRunSummary, NotificationLogSummary } from "@/lib/monitor/dashboard-data";
import type { PaymentRequestRow } from "@/lib/monitor/monetization";
import { analyzeSlotTiming, type SlotMovementEvent } from "@/lib/monitor/slot-analytics";

interface ActivityLogsTabProps {
  recentRuns: CronRunSummary[];
  slotEvents: SlotMovementEvent[];
  monitoredFranchiseCodes: string[];
  submissionLogs: SubmissionLogRow[];
  recentNotifications: NotificationLogSummary[];
  paymentRequests: PaymentRequestRow[];
  reservationProfiles: ApplicationProfile[];
  onRefresh: () => Promise<void>;
}

type LogCategory = "all" | "movements" | "submissions" | "emails" | "checks" | "payments";

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

export default function ActivityLogsTab({
  recentRuns,
  slotEvents,
  monitoredFranchiseCodes,
  submissionLogs,
  recentNotifications,
  paymentRequests,
  reservationProfiles,
  onRefresh,
}: ActivityLogsTabProps) {
  const [category, setCategory] = useState<LogCategory>("all");
  const [onlyMyFranchises, setOnlyMyFranchises] = useState(
    monitoredFranchiseCodes.length > 0
  );
  const [refreshing, setRefreshing] = useState(false);

  const profileNameById = new Map<string, string>();
  for (const p of reservationProfiles) {
    profileNameById.set(p.id, p.profile_name);
  }

  const activeFilterCodes =
    onlyMyFranchises && monitoredFranchiseCodes.length > 0
      ? monitoredFranchiseCodes
      : undefined;

  const filteredEvents = useMemo(() => {
    if (!activeFilterCodes) return slotEvents;
    const set = new Set(activeFilterCodes);
    return slotEvents.filter((e) => set.has(e.franchise_type_code));
  }, [activeFilterCodes, slotEvents]);

  const analysis = useMemo(
    () => analyzeSlotTiming(slotEvents, activeFilterCodes),
    [activeFilterCodes, slotEvents]
  );

  const maxHourCount = useMemo(
    () => Math.max(1, ...analysis.activeHours.map((h) => h.openings + h.decreases)),
    [analysis.activeHours]
  );

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

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
              Analyze when LTFRB slots refill, increase, or get taken, and review all email
              alerts, auto-reservations, and payments.
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
            { id: "submissions" as const, label: `Auto-Reserve (${submissionLogs.length})` },
            { id: "emails" as const, label: `Email Alerts (${recentNotifications.length})` },
            { id: "checks" as const, label: `Slot Checks (${recentRuns.length})` },
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
                Tracks exact timestamps (Manila Time) whenever LTFRB slots refill from 0, increase,
                or decrease.
              </p>
            </div>

            {monitoredFranchiseCodes.length > 0 && (
              <button
                type="button"
                onClick={() => setOnlyMyFranchises((prev) => !prev)}
                className={`min-h-12 shrink-0 rounded-xl px-5 py-3 text-base font-bold transition-colors ${
                  onlyMyFranchises
                    ? "bg-[#EFF6FF] text-[#102E7A]"
                    : "bg-[#F4F4F5] text-[#18181B]"
                }`}
              >
                {onlyMyFranchises
                  ? `Showing: ${monitoredFranchiseCodes.join(", ")} (Tap for All)`
                  : "Showing All Franchises (Tap for Mine)"}
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

          {/* Top Hours & Best Days */}
          {analysis.activeHours.length > 0 && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl bg-[#F4F4F5] p-5">
                <h4 className="text-xl font-bold text-[#0A0A0A]">
                  Hourly Slot Activity (Manila Time)
                </h4>
                <div className="mt-4 space-y-3">
                  {analysis.activeHours.map((h) => {
                    const total = h.openings + h.decreases;
                    const pct = Math.max(8, Math.round((total / maxHourCount) * 100));
                    return (
                      <div key={h.hour} className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
                          <span className="font-bold text-[#0A0A0A]">{h.label}</span>
                          <span className="text-[#3F3F46]">
                            {h.refills > 0 ? `${h.refills} refill(s)` : ""}{" "}
                            {h.increases > 0 ? `+${h.increases} inc` : ""}{" "}
                            {h.decreases > 0 ? `${h.decreases} dec` : ""}
                          </span>
                        </div>
                        <div className="h-3 w-full overflow-hidden rounded-lg bg-white">
                          <div
                            className={`h-3 rounded-lg ${
                              h.openings > 0 ? "bg-[#1447E6]" : "bg-[#A1A1AA]"
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
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

          {/* Timestamped Slot Movement Log */}
          <div>
            <h4 className="text-xl font-bold text-[#0A0A0A]">
              Timestamped Slot Refills, Increases &amp; Decreases
            </h4>
            {filteredEvents.length === 0 ? (
              <p className="mt-3 text-lg text-[#52525B]">
                No slot count changes observed yet for this filter. Keep Automatic Check running
                every 15 minutes to log exact movement timestamps.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {filteredEvents.slice(0, 40).map((ev) => {
                  const areaLabel =
                    ev.scope === "province" && ev.province_name
                      ? `${ev.province_name} (${ev.region_name ?? ""})`
                      : ev.region_name ?? ev.slot_key;

                  const badgeStyle =
                    ev.event_type === "refilled"
                      ? "bg-[#DCFCE7] text-[#14532D]"
                      : ev.event_type === "increased"
                      ? "bg-[#DBEAFE] text-[#1E3A8A]"
                      : "bg-[#E4E4E7] text-[#27272A]";

                  const badgeText =
                    ev.event_type === "refilled"
                      ? `New Open Refill (+${ev.delta})`
                      : ev.event_type === "increased"
                      ? `Increased (+${ev.delta})`
                      : `Decreased (${ev.delta})`;

                  return (
                    <div
                      key={ev.id}
                      className="flex flex-col gap-3 rounded-xl bg-[#F4F4F5] p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-lg font-bold text-[#0A0A0A]">
                          {ev.franchise_type_name} — {areaLabel}
                        </p>
                        <p className="mt-1 text-base text-[#52525B]">
                          {formatManilaTime(ev.occurred_at)} • Slots changed:{" "}
                          <strong>
                            {ev.previous_remaining} → {ev.new_remaining}
                          </strong>
                        </p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold ${badgeStyle}`}
                      >
                        {badgeText}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 1. Auto-Reserve Submission Logs */}
      {(category === "all" || category === "submissions") && (
        <div className="rounded-2xl bg-white p-6 sm:p-8">
          <h3 className="text-2xl font-bold text-[#0A0A0A]">Auto-Reserve Submission History</h3>
          {submissionLogs.length === 0 ? (
            <p className="mt-3 text-lg text-[#52525B]">
              No reservation attempts recorded for your account yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {submissionLogs.map((log) => {
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
                    ? "Submitted Successfully"
                    : log.result === "full_slot"
                    ? "Slot Was Full"
                    : log.result === "auth_error"
                    ? "LTFRB Login Error"
                    : "Needs Attention";

                return (
                  <div key={log.id} className="rounded-xl bg-[#F4F4F5] p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xl font-bold text-[#0A0A0A]">
                          {profileLabel}
                          {log.reference_number ? ` • Case #${log.reference_number}` : ""}
                        </p>
                        <p className="mt-1 text-base text-[#52525B]">
                          {formatManilaTime(log.attempted_at)}
                          {log.http_status ? ` • LTFRB HTTP ${log.http_status}` : ""}
                        </p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold ${badgeStyle}`}
                      >
                        {badgeLabel}
                      </span>
                    </div>
                    {log.message && (
                      <p className="mt-2 text-lg leading-relaxed text-[#3F3F46]">{log.message}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. Email Notification Logs */}
      {(category === "all" || category === "emails") && (
        <div className="rounded-2xl bg-white p-6 sm:p-8">
          <h3 className="text-2xl font-bold text-[#0A0A0A]">Email Alert History</h3>
          {recentNotifications.length === 0 ? (
            <p className="mt-3 text-lg text-[#52525B]">No alert emails sent to you yet.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {recentNotifications.map((log) => (
                <div key={log.id} className="rounded-xl bg-[#F4F4F5] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xl font-bold text-[#0A0A0A]">{log.subject}</p>
                      <p className="mt-1 text-base text-[#52525B]">
                        Sent to <strong>{log.recipient}</strong> • {log.remaining_at_alert} open
                        slot(s) • {formatManilaTime(log.sent_at)}
                      </p>
                    </div>
                    <span
                      className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold uppercase ${
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Automatic 15-Minute Slot Checks */}
      {(category === "all" || category === "checks") && (
        <div className="rounded-2xl bg-white p-6 sm:p-8">
          <h3 className="text-2xl font-bold text-[#0A0A0A]">Automatic Slot Check History</h3>
          {recentRuns.length === 0 ? (
            <p className="mt-3 text-lg text-[#52525B]">No slot check runs recorded yet.</p>
          ) : (
            <div className="mt-5 space-y-3">
              {recentRuns.map((run) => (
                <div key={run.id} className="rounded-xl bg-[#F4F4F5] p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xl font-bold text-[#0A0A0A]">
                        {run.trigger_source === "manual"
                          ? "Manual Slot Check"
                          : "Automatic Check (Every 15 Minutes)"}
                      </p>
                      <p className="mt-1 text-base text-[#52525B]">
                        {formatManilaTime(run.finished_at ?? run.started_at)} •{" "}
                        {run.records_checked} slot entries checked • {run.alerts_sent} alert(s)
                        sent
                      </p>
                    </div>
                    <span
                      className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold uppercase ${
                        run.status === "success"
                          ? "bg-[#DCFCE7] text-[#14532D]"
                          : run.status === "error"
                          ? "bg-[#FEE2E2] text-[#7F1D1D]"
                          : "bg-[#DBEAFE] text-[#1E3A8A]"
                      }`}
                    >
                      {run.status === "success" ? "Completed" : run.status}
                    </span>
                  </div>
                  {run.error_message && (
                    <p className="mt-2 text-base font-bold text-[#7F1D1D]">{run.error_message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. Payment & Plan Logs */}
      {(category === "all" || category === "payments") && (
        <div className="rounded-2xl bg-white p-6 sm:p-8">
          <h3 className="text-2xl font-bold text-[#0A0A0A]">Plan &amp; Payment History</h3>
          {paymentRequests.length === 0 ? (
            <p className="mt-3 text-lg text-[#52525B]">
              No GCash or Maya payment requests submitted yet.
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {paymentRequests.map((req) => {
                const items: string[] = [];
                if (req.includes_annual_plan) items.push("1-Year Plan");
                if (req.requested_extra_profiles > 0) {
                  items.push(`+${req.requested_extra_profiles} Auto-Reserve Profile(s)`);
                }
                if (req.requested_extra_alerts > 0) {
                  items.push(`+${req.requested_extra_alerts} Alert Slot(s)`);
                }
                return (
                  <div key={req.id} className="rounded-xl bg-[#F4F4F5] p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xl font-bold text-[#0A0A0A]">
                          ₱{req.expected_amount_php.toLocaleString("en-PH")} — {items.join(" + ")}
                        </p>
                        <p className="mt-1 text-base text-[#52525B]">
                          Ref: <strong>{req.reference_number}</strong> • Submitted{" "}
                          {formatManilaTime(req.created_at)}
                        </p>
                      </div>
                      <span
                        className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold uppercase ${
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
                      <p className="mt-2 rounded-lg bg-[#FEE2E2] px-3 py-2 text-base font-bold text-[#7F1D1D]">
                        Note: {req.rejection_reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
