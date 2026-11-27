"use client";

import { useState } from "react";
import Link from "next/link";

interface SuperAdminPasswordModalProps {
  adminEmail: string;
  inlineMode?: boolean;
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function SuperAdminPasswordModal({
  adminEmail,
  inlineMode = false,
  onSuccess,
  onCancel,
}: SuperAdminPasswordModalProps) {
  const [password, setPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    setError(null);

    try {
      const res = await fetch("/api/superadmin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Password verification failed.");
      }

      setPassword("");
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not verify password. Please try again."
      );
    } finally {
      setVerifying(false);
    }
  }

  const card = (
    <div
      role={inlineMode ? undefined : "dialog"}
      aria-modal={inlineMode ? undefined : "true"}
      aria-labelledby="superadmin-verify-title"
      className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 sm:p-9"
    >
      <span className="inline-block rounded-xl bg-[#102E7A] px-4 py-1.5 text-base font-bold text-white">
        Restricted SuperAdmin Access
      </span>

      <h2 id="superadmin-verify-title" className="mt-4 text-3xl font-bold text-[#0A0A0A]">
        Verify SuperAdmin Password
      </h2>

      <p className="mt-2 text-lg leading-relaxed text-[#3F3F46]">
        Signed in as <strong>{adminEmail}</strong>. Enter your account password to unlock the
        SuperAdmin Control Center.
      </p>

      {error && (
        <div role="alert" className="mt-5 rounded-xl bg-[#FEE2E2] p-4 text-lg font-bold text-[#7F1D1D]">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div>
          <label htmlFor="superadmin-password" className="block text-lg font-bold text-[#0A0A0A]">
            SuperAdmin Password
          </label>
          <input
            id="superadmin-password"
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#0A0A0A] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={verifying || !password}
            className="min-h-12 flex-1 rounded-xl bg-[#1447E6] px-6 py-3.5 text-lg font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
          >
            {verifying ? "Verifying..." : "Unlock SuperAdmin"}
          </button>

          {inlineMode ? (
            <Link
              href="/dashboard"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#EEF1F4] px-6 py-3.5 text-lg font-bold text-[#18181B] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              Back to Dashboard
            </Link>
          ) : (
            onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="min-h-12 rounded-xl bg-[#EEF1F4] px-6 py-3.5 text-lg font-bold text-[#18181B] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                Cancel
              </button>
            )
          )}
        </div>
      </form>
    </div>
  );

  if (inlineMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F4F5] px-4 py-12">
        {card}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0A0A0A]/60 p-4 pt-10 sm:items-center sm:p-6">
      {card}
    </div>
  );
}
