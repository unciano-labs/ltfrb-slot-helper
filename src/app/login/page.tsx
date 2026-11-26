"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(
    null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);

    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        needsEmailConfirmation?: boolean;
        message?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "Sign in failed. Please check your details.");
      }

      if (data.needsEmailConfirmation) {
        setFeedback({
          kind: "success",
          text:
            data.message ||
            "Account created. Please check your email inbox to confirm, then sign in.",
        });
        setMode("login");
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setFeedback({
        kind: "error",
        text: err instanceof Error ? err.message : "Something went wrong. Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F4F5] px-5 py-10 text-[#0A0A0A] sm:px-8">
      <div className="mx-auto max-w-xl">
        <Link
          href="/"
          className="inline-flex min-h-12 items-center rounded-xl bg-white px-5 py-3 text-lg font-bold text-[#0A0A0A] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
        >
          Back to Home
        </Link>

        <div className="mt-6 rounded-2xl bg-white p-6 sm:p-8">
          <h1 className="text-3xl font-bold text-[#17191C]">
            {mode === "login" ? "Sign In to Your Account" : "Create a New Account"}
          </h1>
          <p className="mt-2 text-lg leading-relaxed text-[#374151]">
            Sign in so you can set email alerts, save your LTFRB login safely, and turn on
            automatic slot reservation.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setFeedback(null);
              }}
              className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                mode === "login"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              I Have an Account
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setFeedback(null);
              }}
              className={`min-h-12 rounded-xl px-5 py-3 text-lg font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
                mode === "register"
                  ? "bg-[#17191C] text-white"
                  : "bg-[#EEF1F4] text-[#17191C] hover:bg-[#E2E6EB]"
              }`}
            >
              Create New Account
            </button>
          </div>

          {feedback && (
            <div
              role="status"
              className={`mt-6 rounded-xl p-5 text-lg font-bold ${
                feedback.kind === "success"
                  ? "bg-[#DCFCE7] text-[#14532D]"
                  : "bg-[#FEE2E2] text-[#7F1D1D]"
              }`}
            >
              {feedback.text}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-6">
            <div>
              <label htmlFor="auth-email" className="block text-lg font-bold text-[#17191C]">
                Your Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-lg font-bold text-[#17191C]">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="mt-2 min-h-12 w-full rounded-xl bg-[#EEF1F4] px-4 py-3 text-lg text-[#17191C] focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              />
              <p className="mt-1.5 text-base text-[#4B5563]">
                Use at least 6 letters or numbers that are easy for you to remember.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="min-h-12 w-full rounded-xl bg-[#1D4ED8] px-6 py-4 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
            >
              {submitting
                ? "Please Wait..."
                : mode === "login"
                ? "Sign In"
                : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
