"use client";

import { useState } from "react";
import type { ApplicationProfile, SubmissionLogRow } from "@/lib/ltfrb/types";
import type { CronRunSummary, NotificationLogSummary } from "@/lib/monitor/dashboard-data";
import type { PaymentRequestRow } from "@/lib/monitor/monetization";

interface ActivityLogsTabProps {
  recentRuns: CronRunSummary[];
  submissionLogs: SubmissionLogRow[];
  recentNotifications: NotificationLogSummary[];
  paymentRequests: PaymentRequestRow[];
  reservationProfiles: ApplicationProfile[];
  onRefresh: () => Promise<void>;
}

type LogCategory = "all" | "submissions" | "emails" | "checks" | "payments";

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
  submissionLogs,
  recentNotifications,
  paymentRequests,
  reservationProfiles,
  onRefresh,
}: ActivityLogsTabProps) {
  const [category, setCategory] = useState<LogCategory>("all");
  const [refreshing, setRefreshing] = useState(false);

  const profileNameById = new Map<string, string>();
  for (const p of reservationProfiles) {
    profileNameById.set(p.id, p.profile_name);
  }

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
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="logs-heading" className="text-2xl font-bold text-[#0A0A0A]">
              Your Activity &amp; System Logs
            </h2>
            <p className="mt-1 text-lg text-[#52525B]">
              Review automatic slot checks, email alerts sent, reservation attempts, and payment
              updates in one place.
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
                      <span className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold ${badgeStyle}`}>
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
