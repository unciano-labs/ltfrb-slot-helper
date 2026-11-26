"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ADDON_ALERT_PRICE_PHP,
  ADDON_PROFILE_PRICE_PHP,
  ANNUAL_PLAN_PRICE_PHP,
  calculatePaymentOrder,
  type PaymentQrCodeRow,
  type PaymentRequestRow,
  type UserEntitlements,
} from "@/lib/monitor/monetization";

interface BillingTabProps {
  entitlements: UserEntitlements;
  qrCodes: PaymentQrCodeRow[];
  paymentRequests: PaymentRequestRow[];
  billingSchemaReady: boolean;
  onRefresh: () => Promise<void>;
  onBanner: (banner: { kind: "success" | "error" | "info"; text: string }) => void;
}

function formatManilaDate(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "Not set";
  return parsed.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatCurrency(amount: number): string {
  return `₱${amount.toLocaleString("en-PH")}`;
}

export default function BillingTab({
  entitlements,
  qrCodes,
  paymentRequests,
  billingSchemaReady,
  onRefresh,
  onBanner,
}: BillingTabProps) {
  const [includesAnnualPlan, setIncludesAnnualPlan] = useState(!entitlements.isActivePlan);
  const [extraProfiles, setExtraProfiles] = useState(0);
  const [extraAlerts, setExtraAlerts] = useState(0);
  const [selectedQrCodeId, setSelectedQrCodeId] = useState<string>(qrCodes[0]?.id ?? "");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [senderName, setSenderName] = useState("");
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  const effectiveIncludeAnnual = entitlements.isActivePlan ? includesAnnualPlan : true;
  const order = calculatePaymentOrder({
    includesAnnualPlan: effectiveIncludeAnnual,
    extraProfiles,
    extraAlerts,
  });

  const activeQrId =
    selectedQrCodeId && qrCodes.some((q) => q.id === selectedQrCodeId)
      ? selectedQrCodeId
      : qrCodes[0]?.id ?? "";

  async function handleReceiptFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingReceipt(true);
    onBanner({ kind: "info", text: "Uploading your receipt screenshot..." });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/billing/receipt-upload", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { url?: string; path?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not upload receipt image.");
      }

      setReceiptUrl(data.url);
      setReceiptPath(data.path ?? null);
      onBanner({
        kind: "success",
        text: "Receipt screenshot uploaded! Now enter your reference number and click Submit Payment Proof.",
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not upload receipt screenshot.",
      });
    } finally {
      setUploadingReceipt(false);
    }
  }

  async function handleSubmitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!order.valid) {
      onBanner({ kind: "error", text: order.error || "Please select an item to pay for." });
      return;
    }

    setSubmittingPayment(true);
    try {
      const res = await fetch("/api/billing/payment-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrCodeId: activeQrId || null,
          includesAnnualPlan: effectiveIncludeAnnual,
          extraProfiles,
          extraAlerts,
          referenceNumber: referenceNumber.trim(),
          senderName: senderName.trim() || null,
          receiptImageUrl: receiptUrl,
          receiptStoragePath: receiptPath,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not submit payment proof.");
      }

      setReferenceNumber("");
      setSenderName("");
      setReceiptUrl(null);
      setReceiptPath(null);
      setExtraProfiles(0);
      setExtraAlerts(0);
      await onRefresh();

      onBanner({
        kind: "success",
        text:
          data.message ||
          "Payment proof submitted! SuperAdmin will review and approve your plan shortly.",
      });
    } catch (err) {
      onBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not submit payment proof.",
      });
    } finally {
      setSubmittingPayment(false);
    }
  }

  const planBadgeColor = entitlements.isActivePlan
    ? "bg-[#DCFCE7] text-[#14532D]"
    : entitlements.status === "pending"
    ? "bg-[#DBEAFE] text-[#1E3A8A]"
    : "bg-[#FEE2E2] text-[#7F1D1D]";

  const planStatusText = entitlements.isSuperAdmin
    ? "SuperAdmin Unlimited Access"
    : entitlements.isActivePlan
    ? `Active 1-Year Plan (${entitlements.daysRemaining} days left)`
    : entitlements.status === "pending"
    ? "Payment Pending Approval"
    : entitlements.status === "expired"
    ? "Plan Expired — Renew Now"
    : "Plan Required (₱1,699 / Year)";

  return (
    <section aria-labelledby="billing-heading" className="space-y-8">
      {!billingSchemaReady && (
        <div className="rounded-2xl bg-[#FEF3C7] p-6 text-lg text-[#78350F]">
          <p className="font-bold">Database migration needed</p>
          <p className="mt-1">
            The billing tables (`supabase/migrations/004_monetization_superadmin.sql`) have not
            been applied to Supabase yet.
          </p>
        </div>
      )}

      {/* Current Plan & Quota Overview */}
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="billing-heading" className="text-2xl font-bold text-[#0A0A0A]">
              Your Plan &amp; Allowances
            </h2>
            <p className="mt-1 text-lg text-[#52525B]">
              {entitlements.expiresAt
                ? `Valid until ${formatManilaDate(entitlements.expiresAt)}`
                : entitlements.isActivePlan
                ? "Your plan is active with email notifications included."
                : "Activate the ₱1,699 1-Year Plan via GCash or Maya to unlock email alerts and auto-reserve."}
            </p>
          </div>
          <span className={`inline-block shrink-0 rounded-xl px-5 py-2.5 text-lg font-bold ${planBadgeColor}`}>
            {planStatusText}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-[#F4F4F5] p-5">
            <p className="text-base font-bold text-[#52525B]">Auto-Reserve Vehicle Profiles</p>
            <p className="mt-1 text-2xl font-bold text-[#0A0A0A]">
              {entitlements.usedProfiles} of {entitlements.maxAutoReserveProfiles} used
            </p>
            <p className="mt-1 text-base text-[#52525B]">
              1 included in Annual Plan + {entitlements.extraAutoReserveSlots} add-on(s)
            </p>
          </div>

          <div className="rounded-xl bg-[#F4F4F5] p-5">
            <p className="text-base font-bold text-[#52525B]">Alert Slots &amp; Franchises</p>
            <p className="mt-1 text-2xl font-bold text-[#0A0A0A]">
              {entitlements.usedAlerts} alerts • {entitlements.monitoredCodesCount} of{" "}
              {entitlements.maxAlertSlots} slots max
            </p>
            <p className="mt-1 text-base text-[#52525B]">
              1 included in Annual Plan + {entitlements.extraAlertSlots} add-on(s)
            </p>
          </div>
        </div>
      </div>

      {/* Pricing Calculator + GCash/Maya QR + Payment Form */}
      <form onSubmit={handleSubmitPayment} className="space-y-8 rounded-2xl bg-white p-6 sm:p-8">
        <div>
          <h3 className="text-2xl font-bold text-[#0A0A0A]">
            {entitlements.isActivePlan ? "Buy Add-Ons or Extend Your Plan" : "Activate Your 1-Year Plan"}
          </h3>
          <p className="mt-1 text-lg text-[#52525B]">
            Select what you want to pay for, scan a GCash or Maya QR code below, and upload your
            receipt proof.
          </p>
        </div>

        {/* Item Selector */}
        <div className="space-y-4">
          <button
            type="button"
            role="switch"
            aria-checked={effectiveIncludeAnnual}
            onClick={() => {
              if (!entitlements.isActivePlan) return;
              setIncludesAnnualPlan((prev) => !prev);
            }}
            className={`flex min-h-12 w-full flex-col items-start justify-between gap-3 rounded-xl px-5 py-4 text-left transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:flex-row sm:items-center ${
              effectiveIncludeAnnual
                ? "bg-[#EFF6FF] text-[#102E7A]"
                : "bg-[#F4F4F5] text-[#18181B] hover:bg-[#E4E4E7]"
            }`}
          >
            <div>
              <p className="text-xl font-bold">
                {effectiveIncludeAnnual ? "INCLUDED: " : "ADD: "}1-Year All-Features Plan (365 Days)
              </p>
              <p className="mt-1 text-base">
                Includes all monitoring features, Gmail alerts, 1 Auto-Reserve profile, and 1 Alert
                slot.
                {!entitlements.isActivePlan && " (Required to start)"}
              </p>
            </div>
            <span className="shrink-0 rounded-xl bg-white px-4 py-2 text-xl font-bold text-[#0A0A0A]">
              {formatCurrency(ANNUAL_PLAN_PRICE_PHP)}
            </span>
          </button>

          {/* Extra Auto-Reserve Stepper */}
          <div className="flex flex-col justify-between gap-4 rounded-xl bg-[#F4F4F5] p-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-xl font-bold text-[#0A0A0A]">
                Additional Auto-Reserve Profiles ({formatCurrency(ADDON_PROFILE_PRICE_PHP)} each)
              </p>
              <p className="mt-1 text-base text-[#52525B]">
                Monitor and auto-submit additional vehicles at the same time.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExtraProfiles((prev) => Math.max(0, prev - 1))}
                className="min-h-12 min-w-12 rounded-xl bg-white px-4 py-2 text-xl font-bold text-[#0A0A0A] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                -
              </button>
              <span className="min-w-12 text-center text-2xl font-bold text-[#0A0A0A]">
                {extraProfiles}
              </span>
              <button
                type="button"
                onClick={() => setExtraProfiles((prev) => Math.min(50, prev + 1))}
                className="min-h-12 min-w-12 rounded-xl bg-[#1447E6] px-4 py-2 text-xl font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                +
              </button>
            </div>
          </div>

          {/* Extra Alert Slots Stepper */}
          <div className="flex flex-col justify-between gap-4 rounded-xl bg-[#F4F4F5] p-5 sm:flex-row sm:items-center">
            <div>
              <p className="text-xl font-bold text-[#0A0A0A]">
                Additional Alert Slots ({formatCurrency(ADDON_ALERT_PRICE_PHP)} each)
              </p>
              <p className="mt-1 text-base text-[#52525B]">
                Watch more franchise types and create more email alert rules.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExtraAlerts((prev) => Math.max(0, prev - 1))}
                className="min-h-12 min-w-12 rounded-xl bg-white px-4 py-2 text-xl font-bold text-[#0A0A0A] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                -
              </button>
              <span className="min-w-12 text-center text-2xl font-bold text-[#0A0A0A]">
                {extraAlerts}
              </span>
              <button
                type="button"
                onClick={() => setExtraAlerts((prev) => Math.min(50, prev + 1))}
                className="min-h-12 min-w-12 rounded-xl bg-[#1447E6] px-4 py-2 text-xl font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                +
              </button>
            </div>
          </div>

          {/* Total Banner */}
          <div className="flex flex-col items-start justify-between gap-2 rounded-xl bg-[#102E7A] p-6 text-white sm:flex-row sm:items-center">
            <span className="text-xl font-bold">Total Amount to Send via GCash or Maya:</span>
            <span className="text-3xl font-bold">{formatCurrency(order.expectedAmountPhp)}</span>
          </div>
        </div>

        {/* Active GCash / Maya QR Codes */}
        <div>
          <h4 className="text-xl font-bold text-[#0A0A0A]">
            Step 1: Scan &amp; Pay Using Any QR Code Below
          </h4>

          {qrCodes.length === 0 ? (
            <div className="mt-4 rounded-xl bg-[#F4F4F5] p-6 text-lg text-[#52525B]">
              No payment QR codes have been uploaded yet. Please ask the administrator (`webcareer1@gmail.com`) to upload GCash or Maya QR codes in SuperAdmin.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
              {qrCodes.map((qr) => {
                const isSelected = activeQrId === qr.id;
                return (
                  <button
                    key={qr.id}
                    type="button"
                    onClick={() => setSelectedQrCodeId(qr.id)}
                    className={`flex flex-col items-center rounded-2xl p-6 text-center transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                      isSelected ? "bg-[#EFF6FF]" : "bg-[#F4F4F5] hover:bg-[#E4E4E7]"
                    }`}
                  >
                    <span
                      className={`inline-block rounded-xl px-4 py-1.5 text-base font-bold uppercase ${
                        qr.provider === "gcash"
                          ? "bg-[#1447E6] text-white"
                          : qr.provider === "maya"
                          ? "bg-[#14532D] text-white"
                          : "bg-[#27272A] text-white"
                      }`}
                    >
                      {qr.provider} {isSelected ? "• Selected" : ""}
                    </span>
                    <p className="mt-3 text-xl font-bold text-[#0A0A0A]">{qr.title}</p>
                    <div className="mt-4 overflow-hidden rounded-xl bg-white p-3">
                      <Image
                        src={qr.image_url}
                        alt={qr.title}
                        width={240}
                        height={240}
                        unoptimized
                        className="h-60 w-60 object-contain"
                      />
                    </div>
                    {qr.description && (
                      <p className="mt-4 whitespace-pre-line text-base leading-relaxed text-[#3F3F46]">
                        {qr.description}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Receipt Upload & Reference Form */}
        <div className="space-y-5 rounded-2xl bg-[#F4F4F5] p-6">
          <h4 className="text-xl font-bold text-[#0A0A0A]">
            Step 2: Enter Your Payment Receipt Details
          </h4>

          <div>
            <label htmlFor="receipt-upload" className="block text-lg font-bold text-[#0A0A0A]">
              Upload GCash / Maya Receipt Screenshot
            </label>
            <input
              id="receipt-upload"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleReceiptFileChange}
              disabled={uploadingReceipt}
              className="mt-2 block min-h-12 w-full rounded-xl bg-white px-4 py-3 text-base text-[#0A0A0A] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            />
            <p className="mt-1.5 text-base text-[#52525B]">
              {uploadingReceipt
                ? "Uploading screenshot..."
                : receiptUrl
                ? "Receipt screenshot uploaded cleanly."
                : "Upload a clear screenshot showing the reference number and amount sent."}
            </p>
            {receiptUrl && (
              <div className="mt-3 inline-block rounded-xl bg-white p-3">
                <Image
                  src={receiptUrl}
                  alt="Uploaded payment receipt"
                  width={180}
                  height={220}
                  unoptimized
                  className="max-h-56 w-auto rounded-lg object-contain"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="payment-ref" className="block text-lg font-bold text-[#0A0A0A]">
                GCash / Maya Reference Number
              </label>
              <input
                id="payment-ref"
                type="text"
                required
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="Example: 0012 3456 7890"
                className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#0A0A0A] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              />
            </div>

            <div>
              <label htmlFor="payment-sender" className="block text-lg font-bold text-[#0A0A0A]">
                Sender Account Name (Optional)
              </label>
              <input
                id="payment-sender"
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="Example: Juan Dela Cruz"
                className="mt-2 min-h-12 w-full rounded-xl bg-white px-4 py-3 text-lg text-[#0A0A0A] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submittingPayment || uploadingReceipt || !order.valid || !billingSchemaReady}
            className="min-h-12 w-full rounded-xl bg-[#1447E6] px-7 py-4 text-lg font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60 sm:w-auto"
          >
            {submittingPayment
              ? "Submitting Payment Proof..."
              : `Submit Payment Proof (${formatCurrency(order.expectedAmountPhp)})`}
          </button>
        </div>
      </form>

      {/* Payment Request History */}
      <div className="rounded-2xl bg-white p-6 sm:p-8">
        <h3 className="text-2xl font-bold text-[#0A0A0A]">Your Submitted Payments</h3>
        {paymentRequests.length === 0 ? (
          <p className="mt-3 text-lg text-[#52525B]">You have not submitted any payment proofs yet.</p>
        ) : (
          <div className="mt-5 space-y-4">
            {paymentRequests.map((req) => {
              const items: string[] = [];
              if (req.includes_annual_plan) items.push("1-Year Plan");
              if (req.requested_extra_profiles > 0) {
                items.push(`+${req.requested_extra_profiles} Auto-Reserve`);
              }
              if (req.requested_extra_alerts > 0) {
                items.push(`+${req.requested_extra_alerts} Alert Slot`);
              }

              const badgeStyle =
                req.status === "approved"
                  ? "bg-[#DCFCE7] text-[#14532D]"
                  : req.status === "rejected"
                  ? "bg-[#FEE2E2] text-[#7F1D1D]"
                  : "bg-[#DBEAFE] text-[#1E3A8A]";

              return (
                <div
                  key={req.id}
                  className="flex flex-col gap-4 rounded-xl bg-[#F4F4F5] p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-xl font-bold text-[#0A0A0A]">
                      {formatCurrency(req.expected_amount_php)} — {items.join(" + ")}
                    </p>
                    <p className="mt-1 text-base text-[#3F3F46]">
                      Ref: <strong>{req.reference_number}</strong> • Submitted{" "}
                      {formatManilaDate(req.created_at)}
                    </p>
                    {req.rejection_reason && (
                      <p className="mt-2 rounded-lg bg-[#FEE2E2] px-3 py-2 text-base font-bold text-[#7F1D1D]">
                        Note: {req.rejection_reason}
                      </p>
                    )}
                  </div>

                  <span className={`inline-block shrink-0 rounded-xl px-4 py-2 text-base font-bold uppercase ${badgeStyle}`}>
                    {req.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
