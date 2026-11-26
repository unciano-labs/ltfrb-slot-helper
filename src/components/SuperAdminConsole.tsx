"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AdminAuditLogRow,
  PaymentProvider,
  PaymentQrCodeRow,
  PaymentRequestRow,
  UserEntitlements,
} from "@/lib/monitor/monetization";
import type { CronRunSummary } from "@/lib/monitor/dashboard-data";

interface AdminUserRow {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  mobile: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  ltfrbAccount: { email: string; type: string } | null;
  monitoredCodes: string[];
  profileStats: { total: number; submitting: number; submitted: number; armed: number };
  entitlements: UserEntitlements;
}

interface OverviewResponse {
  schemaReady: boolean;
  error?: string;
  adminEmail?: string;
  stats?: {
    totalUsers: number;
    activePaidUsers: number;
    pendingPayments: number;
    disabledUsers: number;
    expiringSoonUsers: number;
    totalApprovedRevenuePhp: number;
  };
  users?: AdminUserRow[];
  qrCodes?: PaymentQrCodeRow[];
  paymentRequests?: PaymentRequestRow[];
  cronRuns?: CronRunSummary[];
  auditLogs?: AdminAuditLogRow[];
}

type AdminTab = "overview" | "payments" | "qrcodes" | "users" | "system";

function formatManila(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SuperAdminConsole({ adminEmail }: { adminEmail: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [banner, setBanner] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(
    null
  );

  // Payment filters & modal
  const [paymentFilter, setPaymentFilter] = useState<"pending" | "approved" | "rejected" | "all">(
    "pending"
  );
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [processingPaymentId, setProcessingPaymentId] = useState<string | null>(null);

  // QR Upload state
  const [qrProvider, setQrProvider] = useState<PaymentProvider>("gcash");
  const [qrTitle, setQrTitle] = useState("");
  const [qrDescription, setQrDescription] = useState("");
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [uploadingQr, setUploadingQr] = useState(false);

  // Users directory state
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState<
    "all" | "active" | "pending" | "unpaid" | "expired" | "disabled"
  >("all");
  const [quotaEdits, setQuotaEdits] = useState<
    Record<string, { extraProfiles: number; extraAlerts: number }>
  >({});
  const [disableReasons, setDisableReasons] = useState<Record<string, string>>({});
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [runningCron, setRunningCron] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/superadmin/overview", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        router.refresh();
        return;
      }
      const json = (await res.json()) as OverviewResponse;
      setData(json);
    } catch {
      setBanner({ kind: "error", text: "Could not load SuperAdmin overview." });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function handleLockAdmin() {
    await fetch("/api/superadmin/lock", { method: "POST" });
    router.push("/dashboard");
    router.refresh();
  }

  async function handlePaymentDecision(requestId: string, action: "approve" | "reject") {
    setProcessingPaymentId(requestId);
    setBanner(null);
    try {
      const res = await fetch("/api/superadmin/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action,
          rejectionReason: action === "reject" ? rejectionReasons[requestId] ?? "" : undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not update payment.");

      await loadOverview();
      setBanner({
        kind: "success",
        text:
          action === "approve"
            ? "Payment approved! User plan and quotas have been updated and emailed."
            : "Payment rejected and user has been notified by email.",
      });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Payment decision failed.",
      });
    } finally {
      setProcessingPaymentId(null);
    }
  }

  async function handleUploadQr(e: React.FormEvent) {
    e.preventDefault();
    if (!qrFile) {
      setBanner({ kind: "error", text: "Please select a QR code image file first." });
      return;
    }

    setUploadingQr(true);
    setBanner(null);
    try {
      const fd = new FormData();
      fd.append("provider", qrProvider);
      fd.append("title", qrTitle.trim());
      fd.append("description", qrDescription.trim());
      fd.append("file", qrFile);

      const res = await fetch("/api/superadmin/qr-codes", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Could not upload QR code.");

      setQrTitle("");
      setQrDescription("");
      setQrFile(null);
      await loadOverview();
      setBanner({ kind: "success", text: "Payment QR code uploaded and active for users." });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "QR upload failed.",
      });
    } finally {
      setUploadingQr(false);
    }
  }

  async function handleToggleQrActive(qr: PaymentQrCodeRow) {
    const res = await fetch("/api/superadmin/qr-codes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: qr.id, is_active: !qr.is_active }),
    });
    if (res.ok) {
      await loadOverview();
    } else {
      setBanner({ kind: "error", text: "Could not update QR code status." });
    }
  }

  async function handleDeleteQr(id: string) {
    const res = await fetch(`/api/superadmin/qr-codes?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await loadOverview();
      setBanner({ kind: "info", text: "QR code removed." });
    } else {
      setBanner({ kind: "error", text: "Could not delete QR code." });
    }
  }

  async function handleUserAction(
    user: AdminUserRow,
    action: "disable" | "enable" | "grant_year" | "update_quotas" | "reset_profile_locks"
  ) {
    setBusyUserId(user.userId);
    setBanner(null);
    const edit = quotaEdits[user.userId];
    try {
      const res = await fetch("/api/superadmin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          userEmail: user.email,
          action,
          reason: disableReasons[user.userId] ?? "",
          extraAutoReserveSlots: edit?.extraProfiles ?? user.entitlements.extraAutoReserveSlots,
          extraAlertSlots: edit?.extraAlerts ?? user.entitlements.extraAlertSlots,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "User action failed.");

      await loadOverview();
      setBanner({ kind: "success", text: `Updated ${user.email} (${action}).` });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not update user.",
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleTriggerCron() {
    setRunningCron(true);
    setBanner(null);
    try {
      const res = await fetch("/api/superadmin/cron-trigger", { method: "POST" });
      const json = (await res.json()) as {
        error?: string;
        summary?: { recordsChecked: number; alertsSent: number };
      };
      if (!res.ok) throw new Error(json.error || "Manual cron failed.");
      await loadOverview();
      setBanner({
        kind: "success",
        text: `Manual sync complete: ${json.summary?.recordsChecked ?? 0} slot entries checked, ${
          json.summary?.alertsSent ?? 0
        } email alert(s) sent.`,
      });
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Manual cron failed.",
      });
    } finally {
      setRunningCron(false);
    }
  }

  const filteredPayments = useMemo(() => {
    const list = data?.paymentRequests ?? [];
    if (paymentFilter === "all") return list;
    return list.filter((p) => p.status === paymentFilter);
  }, [data?.paymentRequests, paymentFilter]);

  const filteredUsers = useMemo(() => {
    const list = data?.users ?? [];
    const q = userSearch.trim().toLowerCase();
    return list.filter((u) => {
      if (q) {
        const haystack = [u.email, u.fullName ?? "", u.firstName ?? "", u.lastName ?? "", u.mobile ?? ""]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (userFilter === "disabled") return u.entitlements.isDisabled;
      if (userFilter === "active") return u.entitlements.isActivePlan && !u.entitlements.isDisabled;
      if (userFilter === "pending") return u.entitlements.status === "pending";
      if (userFilter === "unpaid") return u.entitlements.status === "unpaid" && !u.entitlements.isDisabled;
      if (userFilter === "expired") return u.entitlements.status === "expired";
      return true;
    });
  }, [data?.users, userFilter, userSearch]);

  const stats = data?.stats;

  return (
    <div className="min-h-screen bg-[#F4F4F5] text-[#0A0A0A]">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        {/* Top SuperAdmin Header */}
        <header className="rounded-2xl bg-white p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="inline-block rounded-xl bg-[#102E7A] px-4 py-1.5 text-base font-bold text-white">
                SuperAdmin Control Center
              </span>
              <h1 className="mt-3 text-3xl font-bold text-[#0A0A0A]">
                Payments, QR Codes &amp; User Access
              </h1>
              <p className="mt-1 text-lg text-[#52525B]">
                Verified administrator: <strong>{adminEmail}</strong>
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadOverview()}
                className="min-h-12 rounded-xl bg-[#EEF1F4] px-5 py-3 text-lg font-bold text-[#0A0A0A] hover:bg-[#E2E6EB] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                Refresh Data
              </button>
              <Link
                href="/dashboard"
                className="inline-flex min-h-12 items-center rounded-xl bg-[#1447E6] px-5 py-3 text-lg font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                Back to Dashboard
              </Link>
              <button
                type="button"
                onClick={handleLockAdmin}
                className="min-h-12 rounded-xl bg-[#FEE2E2] px-5 py-3 text-lg font-bold text-[#7F1D1D] hover:bg-[#FECACA] focus:outline-none focus:ring-4 focus:ring-red-700/30"
              >
                Lock SuperAdmin
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav aria-label="SuperAdmin sections" className="mt-7 flex flex-wrap gap-3">
            {[
              { id: "overview", label: "Overview" },
              {
                id: "payments",
                label: `Payments (${stats?.pendingPayments ?? 0} Pending)`,
              },
              { id: "qrcodes", label: `QR Codes (${data?.qrCodes?.length ?? 0})` },
              { id: "users", label: `All Users (${stats?.totalUsers ?? 0})` },
              { id: "system", label: "Cron & Audit Logs" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id as AdminTab)}
                className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                  tab === item.id
                    ? "bg-[#1447E6] text-white"
                    : "bg-[#F4F4F5] text-[#18181B] hover:bg-[#E4E4E7]"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        {banner && (
          <div
            role="status"
            className={`rounded-2xl p-6 text-lg font-bold ${
              banner.kind === "success"
                ? "bg-[#DCFCE7] text-[#14532D]"
                : banner.kind === "error"
                ? "bg-[#FEE2E2] text-[#7F1D1D]"
                : "bg-[#DBEAFE] text-[#1E3A8A]"
            }`}
          >
            {banner.text}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl bg-white p-8 text-center text-xl font-bold text-[#52525B]">
            Loading SuperAdmin data...
          </div>
        ) : data && !data.schemaReady ? (
          <div className="rounded-2xl bg-[#FEF3C7] p-8 text-lg text-[#78350F]">
            <p className="text-2xl font-bold">Run Database Migration 004 First</p>
            <p className="mt-2">{data.error}</p>
          </div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {tab === "overview" && stats && (
              <section className="space-y-6">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Approved Revenue</p>
                    <p className="mt-2 text-3xl font-bold text-[#14532D]">
                      ₱{stats.totalApprovedRevenuePhp.toLocaleString("en-PH")}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Pending Approvals</p>
                    <p className="mt-2 text-3xl font-bold text-[#1447E6]">{stats.pendingPayments}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Total Registered Users</p>
                    <p className="mt-2 text-3xl font-bold text-[#0A0A0A]">{stats.totalUsers}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Active Paid Plans</p>
                    <p className="mt-2 text-3xl font-bold text-[#14532D]">{stats.activePaidUsers}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Expiring Within 30 Days</p>
                    <p className="mt-2 text-3xl font-bold text-[#78350F]">
                      {stats.expiringSoonUsers}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-6">
                    <p className="text-base font-bold text-[#52525B]">Disabled Accounts</p>
                    <p className="mt-2 text-3xl font-bold text-[#7F1D1D]">{stats.disabledUsers}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-4 rounded-2xl bg-white p-6">
                  <button
                    type="button"
                    onClick={() => setTab("payments")}
                    className="min-h-12 rounded-xl bg-[#1447E6] px-6 py-3 text-lg font-bold text-white hover:bg-[#1039B8]"
                  >
                    Review Pending Payments ({stats.pendingPayments})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("qrcodes")}
                    className="min-h-12 rounded-xl bg-[#EEF1F4] px-6 py-3 text-lg font-bold text-[#0A0A0A] hover:bg-[#E2E6EB]"
                  >
                    Manage GCash / Maya QR Codes
                  </button>
                  <button
                    type="button"
                    onClick={handleTriggerCron}
                    disabled={runningCron}
                    className="min-h-12 rounded-xl bg-[#DCFCE7] px-6 py-3 text-lg font-bold text-[#14532D] hover:bg-[#BBF7D0] disabled:opacity-60"
                  >
                    {runningCron ? "Running Sync..." : "Run Slot Sync Now"}
                  </button>
                </div>
              </section>
            )}

            {/* PAYMENTS APPROVAL QUEUE TAB */}
            {tab === "payments" && (
              <section className="space-y-6">
                <div className="flex flex-wrap gap-3 rounded-2xl bg-white p-6">
                  {(["pending", "approved", "rejected", "all"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setPaymentFilter(st)}
                      className={`min-h-12 rounded-xl px-5 py-2.5 text-lg font-bold capitalize ${
                        paymentFilter === st
                          ? "bg-[#1447E6] text-white"
                          : "bg-[#F4F4F5] text-[#18181B] hover:bg-[#E4E4E7]"
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>

                {filteredPayments.length === 0 ? (
                  <div className="rounded-2xl bg-white p-8 text-center text-xl text-[#52525B]">
                    No {paymentFilter === "all" ? "" : paymentFilter} payment requests found.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredPayments.map((req) => {
                      const items: string[] = [];
                      if (req.includes_annual_plan) items.push("1-Year Plan (₱1,699)");
                      if (req.requested_extra_profiles > 0) {
                        items.push(`+${req.requested_extra_profiles} Auto-Reserve Profile(s)`);
                      }
                      if (req.requested_extra_alerts > 0) {
                        items.push(`+${req.requested_extra_alerts} Alert Slot(s)`);
                      }

                      return (
                        <article key={req.id} className="rounded-2xl bg-white p-6 sm:p-8">
                          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-2">
                              <span
                                className={`inline-block rounded-xl px-4 py-1.5 text-base font-bold uppercase ${
                                  req.status === "approved"
                                    ? "bg-[#DCFCE7] text-[#14532D]"
                                    : req.status === "rejected"
                                    ? "bg-[#FEE2E2] text-[#7F1D1D]"
                                    : "bg-[#DBEAFE] text-[#1E3A8A]"
                                }`}
                              >
                                {req.status}
                              </span>
                              <h3 className="text-2xl font-bold text-[#0A0A0A]">{req.user_email}</h3>
                              <p className="text-xl font-bold text-[#1447E6]">
                                ₱{req.expected_amount_php.toLocaleString("en-PH")} —{" "}
                                {items.join(" + ")}
                              </p>
                              <p className="text-lg text-[#3F3F46]">
                                Reference No: <strong>{req.reference_number}</strong>
                                {req.sender_name ? ` • Sender: ${req.sender_name}` : ""}
                              </p>
                              <p className="text-base text-[#52525B]">
                                Submitted: {formatManila(req.created_at)}
                              </p>
                            </div>

                            {req.receipt_image_url && (
                              <button
                                type="button"
                                onClick={() => setReceiptPreviewUrl(req.receipt_image_url)}
                                className="shrink-0 rounded-xl bg-[#F4F4F5] p-3 text-center hover:bg-[#E4E4E7]"
                              >
                                <Image
                                  src={req.receipt_image_url}
                                  alt={`Receipt for ${req.user_email}`}
                                  width={150}
                                  height={180}
                                  unoptimized
                                  className="h-44 w-36 rounded-lg object-contain"
                                />
                                <span className="mt-2 block text-base font-bold text-[#1447E6]">
                                  View Full Receipt
                                </span>
                              </button>
                            )}
                          </div>

                          {req.status === "pending" && (
                            <div className="mt-6 space-y-4 rounded-xl bg-[#F4F4F5] p-5">
                              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <input
                                  type="text"
                                  value={rejectionReasons[req.id] ?? ""}
                                  onChange={(e) =>
                                    setRejectionReasons((prev) => ({
                                      ...prev,
                                      [req.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Optional note / reason if rejecting"
                                  className="min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#0A0A0A] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
                                />

                                <div className="flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    disabled={processingPaymentId === req.id}
                                    onClick={() => handlePaymentDecision(req.id, "approve")}
                                    className="min-h-12 flex-1 rounded-xl bg-[#14532D] px-6 py-3 text-lg font-bold text-white hover:bg-[#166534] disabled:opacity-60"
                                  >
                                    Approve &amp; Activate
                                  </button>
                                  <button
                                    type="button"
                                    disabled={processingPaymentId === req.id}
                                    onClick={() => handlePaymentDecision(req.id, "reject")}
                                    className="min-h-12 flex-1 rounded-xl bg-[#FEE2E2] px-6 py-3 text-lg font-bold text-[#7F1D1D] hover:bg-[#FECACA] disabled:opacity-60"
                                  >
                                    Reject
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* QR CODE MANAGER TAB */}
            {tab === "qrcodes" && (
              <section className="space-y-6">
                <form onSubmit={handleUploadQr} className="space-y-5 rounded-2xl bg-white p-6 sm:p-8">
                  <h2 className="text-2xl font-bold text-[#0A0A0A]">
                    Upload New GCash / Maya QR Code
                  </h2>

                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    <div>
                      <label htmlFor="qr-provider" className="block text-lg font-bold text-[#0A0A0A]">
                        Payment Provider
                      </label>
                      <select
                        id="qr-provider"
                        value={qrProvider}
                        onChange={(e) => setQrProvider(e.target.value as PaymentProvider)}
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A]"
                      >
                        <option value="gcash">GCash</option>
                        <option value="maya">Maya</option>
                        <option value="other">Other Bank / Wallet</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="qr-title" className="block text-lg font-bold text-[#0A0A0A]">
                        QR Display Title
                      </label>
                      <input
                        id="qr-title"
                        type="text"
                        required
                        value={qrTitle}
                        onChange={(e) => setQrTitle(e.target.value)}
                        placeholder="Example: GCash — Main Business Account"
                        className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A]"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="qr-desc" className="block text-lg font-bold text-[#0A0A0A]">
                      Description &amp; Instructions for Payers
                    </label>
                    <textarea
                      id="qr-desc"
                      rows={3}
                      value={qrDescription}
                      onChange={(e) => setQrDescription(e.target.value)}
                      placeholder="Account Name: ... | Number: 09XX-XXX-XXXX | Please send exact amount and screenshot your receipt."
                      className="mt-2 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A]"
                    />
                  </div>

                  <div>
                    <label htmlFor="qr-file" className="block text-lg font-bold text-[#0A0A0A]">
                      QR Code Image (PNG / JPG / WEBP)
                    </label>
                    <input
                      id="qr-file"
                      type="file"
                      required
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setQrFile(e.target.files?.[0] ?? null)}
                      className="mt-2 block min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-base text-[#0A0A0A]"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={uploadingQr}
                    className="min-h-12 rounded-xl bg-[#1447E6] px-7 py-3.5 text-lg font-bold text-white hover:bg-[#1039B8] disabled:opacity-60"
                  >
                    {uploadingQr ? "Uploading QR Code..." : "Upload QR Code"}
                  </button>
                </form>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {(data?.qrCodes ?? []).map((qr) => (
                    <div key={qr.id} className="rounded-2xl bg-white p-6">
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-xl bg-[#102E7A] px-3 py-1 text-base font-bold uppercase text-white">
                          {qr.provider}
                        </span>
                        <span
                          className={`rounded-xl px-3 py-1 text-base font-bold ${
                            qr.is_active
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : "bg-[#E4E4E7] text-[#52525B]"
                          }`}
                        >
                          {qr.is_active ? "Visible to Users" : "Hidden"}
                        </span>
                      </div>

                      <h3 className="mt-3 text-xl font-bold text-[#0A0A0A]">{qr.title}</h3>
                      {qr.description && (
                        <p className="mt-1 whitespace-pre-line text-base text-[#52525B]">
                          {qr.description}
                        </p>
                      )}

                      <div className="mt-4 flex justify-center rounded-xl bg-[#F4F4F5] p-4">
                        <Image
                          src={qr.image_url}
                          alt={qr.title}
                          width={220}
                          height={220}
                          unoptimized
                          className="h-56 w-56 object-contain"
                        />
                      </div>

                      <div className="mt-5 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggleQrActive(qr)}
                          className="min-h-12 flex-1 rounded-xl bg-[#EEF1F4] px-4 py-3 text-base font-bold text-[#0A0A0A] hover:bg-[#E2E6EB]"
                        >
                          {qr.is_active ? "Hide QR Code" : "Show QR Code"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteQr(qr.id)}
                          className="min-h-12 rounded-xl bg-[#FEE2E2] px-5 py-3 text-base font-bold text-[#7F1D1D] hover:bg-[#FECACA]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ALL REGISTERED USERS TAB */}
            {tab === "users" && (
              <section className="space-y-6">
                <div className="grid grid-cols-1 gap-4 rounded-2xl bg-white p-6 md:grid-cols-2">
                  <input
                    type="search"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search registered users by name, email, or mobile..."
                    className="min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A]"
                  />

                  <select
                    value={userFilter}
                    onChange={(e) =>
                      setUserFilter(
                        e.target.value as
                          | "all"
                          | "active"
                          | "pending"
                          | "unpaid"
                          | "expired"
                          | "disabled"
                      )
                    }
                    className="min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A]"
                  >
                    <option value="all">All Users</option>
                    <option value="active">Active Paid</option>
                    <option value="pending">Pending Payment</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="expired">Expired</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="space-y-4">
                  {filteredUsers.map((u) => {
                    const currentEdit = quotaEdits[u.userId] ?? {
                      extraProfiles: u.entitlements.extraAutoReserveSlots,
                      extraAlerts: u.entitlements.extraAlertSlots,
                    };

                    return (
                      <article key={u.userId} className="rounded-2xl bg-white p-6 sm:p-8">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-2xl font-bold text-[#0A0A0A]">
                                {u.fullName ? `${u.fullName} (${u.email})` : u.email}
                              </h3>
                              {u.entitlements.isSuperAdmin && (
                                <span className="rounded-xl bg-[#102E7A] px-3 py-1 text-base font-bold text-white">
                                  SuperAdmin
                                </span>
                              )}
                              {u.entitlements.isDisabled ? (
                                <span className="rounded-xl bg-[#FEE2E2] px-3 py-1 text-base font-bold text-[#7F1D1D]">
                                  DISABLED
                                </span>
                              ) : (
                                <span
                                  className={`rounded-xl px-3 py-1 text-base font-bold uppercase ${
                                    u.entitlements.isActivePlan
                                      ? "bg-[#DCFCE7] text-[#14532D]"
                                      : "bg-[#F4F4F5] text-[#52525B]"
                                  }`}
                                >
                                  {u.entitlements.status}
                                </span>
                              )}
                            </div>

                            {(u.mobile || u.fullName) && (
                              <p className="mt-2 text-lg text-[#0A0A0A]">
                                {u.fullName ? <span>Name: <strong>{u.fullName}</strong></span> : null}
                                {u.fullName && u.mobile ? " • " : null}
                                {u.mobile ? <span>Mobile: <strong>{u.mobile}</strong></span> : null}
                              </p>
                            )}
                            <p className="mt-2 text-base text-[#52525B]">
                              Joined: {formatManila(u.createdAt)} • Last Sign-In:{" "}
                              {formatManila(u.lastSignInAt)}
                            </p>
                            <p className="mt-1 text-base text-[#3F3F46]">
                              Expires: <strong>{formatManila(u.entitlements.expiresAt)}</strong> •
                              Profiles:{" "}
                              <strong>
                                {u.entitlements.usedProfiles}/{u.entitlements.maxAutoReserveProfiles}
                              </strong>{" "}
                              • Alerts:{" "}
                              <strong>
                                {u.entitlements.usedAlerts}/{u.entitlements.maxAlertSlots}
                              </strong>
                            </p>
                            {u.ltfrbAccount && (
                              <p className="mt-1 text-base text-[#52525B]">
                                LTFRB Portal: {u.ltfrbAccount.email} ({u.ltfrbAccount.type}) •
                                Monitored: {u.monitoredCodes.join(", ") || "None"}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              disabled={busyUserId === u.userId}
                              onClick={() => handleUserAction(u, "grant_year")}
                              className="min-h-12 rounded-xl bg-[#1447E6] px-5 py-3 text-base font-bold text-white hover:bg-[#1039B8] disabled:opacity-60"
                            >
                              Grant +1 Year Plan
                            </button>

                            {u.profileStats.submitting > 0 && (
                              <button
                                type="button"
                                disabled={busyUserId === u.userId}
                                onClick={() => handleUserAction(u, "reset_profile_locks")}
                                className="min-h-12 rounded-xl bg-[#FEF3C7] px-5 py-3 text-base font-bold text-[#78350F]"
                              >
                                Reset Stuck Lock ({u.profileStats.submitting})
                              </button>
                            )}

                            {!u.entitlements.isSuperAdmin &&
                              (u.entitlements.isDisabled ? (
                                <button
                                  type="button"
                                  disabled={busyUserId === u.userId}
                                  onClick={() => handleUserAction(u, "enable")}
                                  className="min-h-12 rounded-xl bg-[#DCFCE7] px-5 py-3 text-base font-bold text-[#14532D]"
                                >
                                  Re-Enable User
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyUserId === u.userId}
                                  onClick={() => handleUserAction(u, "disable")}
                                  className="min-h-12 rounded-xl bg-[#FEE2E2] px-5 py-3 text-base font-bold text-[#7F1D1D]"
                                >
                                  Disable User
                                </button>
                              ))}
                          </div>
                        </div>

                        {/* Manual Add-On Quotas & Disable Reason Row */}
                        <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl bg-[#F4F4F5] p-4 md:grid-cols-4">
                          <div>
                            <label className="block text-base font-bold text-[#0A0A0A]">
                              Extra Auto-Reserve (+100)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={currentEdit.extraProfiles}
                              onChange={(e) =>
                                setQuotaEdits((prev) => ({
                                  ...prev,
                                  [u.userId]: {
                                    ...currentEdit,
                                    extraProfiles: Number(e.target.value) || 0,
                                  },
                                }))
                              }
                              className="mt-1 min-h-12 w-full rounded-xl bg-white px-3 py-2 text-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-base font-bold text-[#0A0A0A]">
                              Extra Alert Slots (+100)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={currentEdit.extraAlerts}
                              onChange={(e) =>
                                setQuotaEdits((prev) => ({
                                  ...prev,
                                  [u.userId]: {
                                    ...currentEdit,
                                    extraAlerts: Number(e.target.value) || 0,
                                  },
                                }))
                              }
                              className="mt-1 min-h-12 w-full rounded-xl bg-white px-3 py-2 text-lg"
                            />
                          </div>

                          <div>
                            <label className="block text-base font-bold text-[#0A0A0A]">
                              Disable Reason (Optional)
                            </label>
                            <input
                              type="text"
                              value={disableReasons[u.userId] ?? ""}
                              onChange={(e) =>
                                setDisableReasons((prev) => ({
                                  ...prev,
                                  [u.userId]: e.target.value,
                                }))
                              }
                              placeholder="Reason if disabling"
                              className="mt-1 min-h-12 w-full rounded-xl bg-white px-3 py-2 text-base"
                            />
                          </div>

                          <div className="flex items-end">
                            <button
                              type="button"
                              disabled={busyUserId === u.userId}
                              onClick={() => handleUserAction(u, "update_quotas")}
                              className="min-h-12 w-full rounded-xl bg-[#0A0A0A] px-4 py-2 text-base font-bold text-white hover:bg-[#27272A]"
                            >
                              Save Quotas
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {/* CRON & AUDIT LOGS TAB */}
            {tab === "system" && (
              <section className="space-y-6">
                <div className="rounded-2xl bg-white p-6 sm:p-8">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h2 className="text-2xl font-bold text-[#0A0A0A]">
                      Recent 15-Minute Sync History
                    </h2>
                    <button
                      type="button"
                      onClick={handleTriggerCron}
                      disabled={runningCron}
                      className="min-h-12 rounded-xl bg-[#1447E6] px-6 py-3 text-lg font-bold text-white hover:bg-[#1039B8] disabled:opacity-60"
                    >
                      {runningCron ? "Running Sync..." : "Run Slot Sync Now"}
                    </button>
                  </div>

                  <div className="mt-5 space-y-3">
                    {(data?.cronRuns ?? []).map((run) => (
                      <div key={run.id} className="rounded-xl bg-[#F4F4F5] p-4">
                        <p className="text-lg font-bold text-[#0A0A0A]">
                          {run.trigger_source.toUpperCase()} • {run.status} • Checked{" "}
                          {run.records_checked} • Alerts {run.alerts_sent}
                        </p>
                        <p className="mt-1 text-base text-[#52525B]">
                          {formatManila(run.started_at)}
                        </p>
                        {run.error_message && (
                          <p className="mt-1 text-base font-bold text-[#7F1D1D]">
                            Error: {run.error_message}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-white p-6 sm:p-8">
                  <h2 className="text-2xl font-bold text-[#0A0A0A]">SuperAdmin Audit Logs</h2>
                  <div className="mt-5 space-y-3">
                    {(data?.auditLogs ?? []).map((log) => (
                      <div key={log.id} className="rounded-xl bg-[#F4F4F5] p-4">
                        <p className="text-lg font-bold text-[#0A0A0A]">
                          {log.action} {log.target_user_email ? `→ ${log.target_user_email}` : ""}
                        </p>
                        <p className="mt-1 text-base text-[#52525B]">
                          {formatManila(log.created_at)} • {JSON.stringify(log.details)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Receipt Lightbox */}
      {receiptPreviewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0A0A0A]/80 p-4"
          onClick={() => setReceiptPreviewUrl(null)}
        >
          <div
            className="max-h-screen max-w-2xl overflow-auto rounded-2xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={receiptPreviewUrl}
              alt="Full receipt preview"
              width={640}
              height={900}
              unoptimized
              className="h-auto max-h-[75vh] w-auto object-contain"
            />
            <button
              type="button"
              onClick={() => setReceiptPreviewUrl(null)}
              className="mt-4 min-h-12 w-full rounded-xl bg-[#1447E6] px-6 py-3 text-lg font-bold text-white"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
