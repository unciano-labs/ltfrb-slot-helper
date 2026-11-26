"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ScrollReveal from "@/components/ScrollReveal";
import type { SlotEntry } from "@/lib/ltfrb/types";

interface LiveSummary {
  loading: boolean;
  totalTracked: number;
  openCount: number;
  highlighted: SlotEntry[];
  userEmail: string | null;
}

export default function LandingPage() {
  const [summary, setSummary] = useState<LiveSummary>({
    loading: true,
    totalTracked: 0,
    openCount: 0,
    highlighted: [],
    userEmail: null,
  });

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/slots?mode=cached", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed");
        const data = (await res.json()) as {
          regionSlots?: SlotEntry[];
          isStale?: boolean;
          user?: { email?: string | null } | null;
        };
        const regions = data.regionSlots ?? [];
        const open = regions.filter((s) => s.remaining > 0);
        const sorted = [...regions].sort((a, b) => b.remaining - a.remaining).slice(0, 4);

        if (active) {
          setSummary({
            loading: regions.length === 0,
            totalTracked: regions.length,
            openCount: open.length,
            highlighted: sorted,
            userEmail: data.user?.email ?? null,
          });
        }

        if (active && (regions.length === 0 || data.isStale)) {
          const liveRes = await fetch("/api/slots?mode=live", { cache: "no-store" });
          if (liveRes.ok && active) {
            const liveData = (await liveRes.json()) as {
              regionSlots?: SlotEntry[];
              user?: { email?: string | null } | null;
            };
            const liveRegions = liveData.regionSlots ?? [];
            const liveOpen = liveRegions.filter((s) => s.remaining > 0);
            const liveSorted = [...liveRegions]
              .sort((a, b) => b.remaining - a.remaining)
              .slice(0, 4);
            setSummary({
              loading: false,
              totalTracked: liveRegions.length,
              openCount: liveOpen.length,
              highlighted: liveSorted,
              userEmail: liveData.user?.email ?? data.user?.email ?? null,
            });
          } else if (active) {
            setSummary((prev) => ({ ...prev, loading: false }));
          }
        }
      } catch {
        if (active) {
          setSummary((prev) => ({ ...prev, loading: false }));
        }
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#F4F4F5] text-[#0A0A0A]">
      {/* Top Civic Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link
            href="/"
            className="flex min-h-12 items-center gap-3 text-xl font-bold text-[#0A0A0A] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#1447E6] text-lg font-bold text-white">
              LT
            </span>
            <span>LTFRB Slot Helper</span>
          </Link>

          <nav aria-label="Primary" className="flex flex-wrap items-center gap-2 sm:gap-4">
            <a
              href="#problem-solved"
              className="inline-flex min-h-12 items-center rounded-xl px-4 py-2 text-base font-bold text-[#18181B] hover:bg-[#F4F4F5] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              Why Use This
            </a>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center rounded-xl px-4 py-2 text-base font-bold text-[#18181B] hover:bg-[#F4F4F5] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              How It Works
            </a>
            <a
              href="#faq"
              className="inline-flex min-h-12 items-center rounded-xl px-4 py-2 text-base font-bold text-[#18181B] hover:bg-[#F4F4F5] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              FAQ
            </a>
            <Link
              href={summary.userEmail ? "/dashboard" : "/login"}
              className="inline-flex min-h-12 items-center rounded-xl bg-[#1447E6] px-5 py-2.5 text-base font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
            >
              {summary.userEmail ? "My Dashboard" : "Sign In / Register"}
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section (Official LTFRB Royal Blue Theme — Flat, High Contrast) */}
      <section className="bg-[#102E7A] text-white">
        <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
          <ScrollReveal>
            <span className="inline-block rounded-xl bg-[#1447E6] px-4 py-2 text-base font-bold text-[#EFF6FF]">
              Automatic LTFRB Franchise Slot Assistant
            </span>

            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Never Miss an Open LTFRB Franchise Slot Again
            </h1>

            <p className="mt-6 max-w-3xl text-xl leading-relaxed text-[#EFF6FF]">
              Applying on <strong>ltfrb-foa.ph</strong> is hard when slots fill up in minutes.
              LTFRB Slot Helper checks available slots automatically every 15 minutes, emails you
              when a spot opens, and submits your prepared application for you.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:flex-wrap">
              <Link
                href={summary.userEmail ? "/dashboard" : "/login"}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-7 py-4 text-lg font-bold text-[#102E7A] hover:bg-[#EFF6FF] focus:outline-none focus:ring-4 focus:ring-white/40"
              >
                {summary.userEmail ? "Open My Dashboard" : "Sign In to Open Dashboard"}
              </Link>

              {summary.userEmail && (
                <span className="inline-flex min-h-12 items-center rounded-xl bg-[#1447E6] px-6 py-4 text-lg font-bold text-white">
                  Signed in as {summary.userEmail}
                </span>
              )}
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* Live LTFRB Slot Snapshot Strip */}
      <section aria-labelledby="live-preview-heading" className="mx-auto max-w-5xl px-5 py-14 sm:px-8">
        <ScrollReveal>
          <div className="rounded-2xl bg-white p-6 sm:p-10">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="live-preview-heading" className="text-3xl font-bold text-[#0A0A0A]">
                  Live LTFRB Slot Snapshot
                </h2>
                <p className="mt-2 text-lg text-[#52525B]">
                  {summary.loading
                    ? "Checking live LTFRB regional slot counts..."
                    : `${summary.openCount} of ${summary.totalTracked} regional franchise listings currently have open slots.`}
                </p>
              </div>

              <Link
                href={summary.userEmail ? "/dashboard" : "/login"}
                className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-[#1447E6] px-6 py-3.5 text-lg font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
              >
                {summary.userEmail
                  ? "View All Regions & Provinces"
                  : "Sign In to View All Regions"}
              </Link>
            </div>

            {!summary.loading && summary.highlighted.length > 0 && (
              <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
                {summary.highlighted.map((slot) => {
                  const isOpen = slot.remaining > 0;
                  return (
                    <div key={slot.slotKey} className="rounded-xl bg-[#F4F4F5] p-5">
                      <p className="text-xl font-bold text-[#0A0A0A]">{slot.franchiseTypeName}</p>
                      <p className="mt-1 text-lg text-[#52525B]">{slot.regionName}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <span
                          className={`inline-block rounded-xl px-4 py-2 text-base font-bold ${
                            isOpen
                              ? "bg-[#DCFCE7] text-[#14532D]"
                              : "bg-[#E4E4E7] text-[#27272A]"
                          }`}
                        >
                          {isOpen
                            ? `${slot.remaining.toLocaleString()} Slots Open`
                            : "Full (0 Left)"}
                        </span>
                        <span className="text-base text-[#52525B]">
                          {slot.filedApplication.toLocaleString()} /{" "}
                          {slot.totalSlots.toLocaleString()} filled
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollReveal>
      </section>

      {/* Problem Solved Section */}
      <section id="problem-solved" className="bg-white py-16">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <ScrollReveal>
            <h2 className="text-3xl font-bold text-[#0A0A0A] sm:text-4xl">
              The Problem This App Solves
            </h2>
            <p className="mt-3 max-w-3xl text-lg leading-relaxed text-[#52525B]">
              Instead of refreshing LTFRB all day and losing out to &ldquo;full slot&rdquo;
              errors, everything runs safely in the background for you.
            </p>
          </ScrollReveal>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            <ScrollReveal delayMs={80}>
              <div className="h-full rounded-2xl bg-[#F4F4F5] p-7 sm:p-8">
                <span className="inline-block rounded-xl bg-[#FEE2E2] px-4 py-2 text-base font-bold text-[#7F1D1D]">
                  Before: Manual Checking
                </span>
                <h3 className="mt-5 text-2xl font-bold text-[#0A0A0A]">
                  Hard to Catch Open Slots in Time
                </h3>
                <ul className="mt-4 space-y-3 text-lg leading-relaxed text-[#3F3F46]">
                  <li>• Having to open and refresh ltfrb-foa.ph many times a day.</li>
                  <li>• Slots open unexpectedly and disappear before you finish typing.</li>
                  <li>• Repeatedly hitting &ldquo;All available slots are taken&rdquo; errors.</li>
                </ul>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={160}>
              <div className="h-full rounded-2xl bg-[#EFF6FF] p-7 sm:p-8">
                <span className="inline-block rounded-xl bg-[#1447E6] px-4 py-2 text-base font-bold text-white">
                  Solved: Automatic Checking &amp; Submission
                </span>
                <h3 className="mt-5 text-2xl font-bold text-[#0A0A0A]">
                  Automatic 15-Minute Watch &amp; Instant Filing
                </h3>
                <ul className="mt-4 space-y-3 text-lg leading-relaxed text-[#1E3A8A]">
                  <li>
                    • <strong>Auto-Check Every 15 Minutes:</strong> Watches up to 2 chosen
                    franchises for your account and emails you when slots open or increase.
                  </li>
                  <li>
                    • <strong>Auto-Submission:</strong> Submits your saved vehicle details &amp;
                    Sales Invoice PDF automatically when slots increase or at 12 MN, 7 AM &amp; 8
                    AM.
                  </li>
                  <li>
                    • <strong>Built-In Safety:</strong> Stops immediately once your application
                    succeeds and pauses if LTFRB returns 403/409/429.
                  </li>
                </ul>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Core Features Grid */}
      <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <ScrollReveal>
          <h2 className="text-3xl font-bold text-[#0A0A0A] sm:text-4xl">
            Designed to Be Calm, Safe, and Easy to Use
          </h2>
          <p className="mt-3 max-w-3xl text-lg leading-relaxed text-[#52525B]">
            Large readable text, plain words, and no confusing clutter.
          </p>
        </ScrollReveal>

        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          <ScrollReveal delayMs={60}>
            <div className="h-full rounded-2xl bg-white p-7">
              <span className="inline-block rounded-xl bg-[#EFF6FF] px-4 py-2 text-base font-bold text-[#1447E6]">
                15-Min Auto Check
              </span>
              <h3 className="mt-4 text-2xl font-bold text-[#0A0A0A]">
                Pick Up to 2 Franchises
              </h3>
              <p className="mt-2 text-lg leading-relaxed text-[#52525B]">
                Choose the exact 1 or 2 franchise types you care about (such as TNVS or E-TNVS).
                Your account only monitors and emails you about those choices.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={120}>
            <div className="h-full rounded-2xl bg-white p-7">
              <span className="inline-block rounded-xl bg-[#DCFCE7] px-4 py-2 text-base font-bold text-[#14532D]">
                Smart Gmail Alerts
              </span>
              <h3 className="mt-4 text-2xl font-bold text-[#0A0A0A]">
                Know the Moment Slots Move
              </h3>
              <p className="mt-2 text-lg leading-relaxed text-[#52525B]">
                Choose whether to receive emails when slots are open, when open slots increase (a
                brand new slot ready to submit), or when slots decrease.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={180}>
            <div className="h-full rounded-2xl bg-white p-7">
              <span className="inline-block rounded-xl bg-[#EFF6FF] px-4 py-2 text-base font-bold text-[#1447E6]">
                Sales Invoice Ready
              </span>
              <h3 className="mt-4 text-2xl font-bold text-[#0A0A0A]">
                Start Without OR/CR Yet
              </h3>
              <p className="mt-2 text-lg leading-relaxed text-[#52525B]">
                Upload your Sales Invoice PDF now to reserve your slot, then attach your Official
                Receipt (OR) and CR later once LTO releases them.
              </p>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={240}>
            <div className="h-full rounded-2xl bg-white p-7">
              <span className="inline-block rounded-xl bg-[#EFF6FF] px-4 py-2 text-base font-bold text-[#1447E6]">
                Encrypted Vault
              </span>
              <h3 className="mt-4 text-2xl font-bold text-[#0A0A0A]">
                Auto-Refreshes Expired Tokens
              </h3>
              <p className="mt-2 text-lg leading-relaxed text-[#52525B]">
                Your LTFRB login is stored encrypted on the server and automatically refreshes if
                your LTFRB session expires so you never miss an open slot.
              </p>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-white py-16">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <ScrollReveal>
            <h2 className="text-3xl font-bold text-[#0A0A0A] sm:text-4xl">How It Works</h2>
            <p className="mt-3 text-lg text-[#52525B]">
              Set up once in 3 simple steps, then let the helper watch for you.
            </p>
          </ScrollReveal>

          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <ScrollReveal delayMs={60}>
              <div className="h-full rounded-2xl bg-[#F4F4F5] p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#1447E6] text-xl font-bold text-white">
                  1
                </span>
                <h3 className="mt-5 text-2xl font-bold text-[#0A0A0A]">
                  Sign In &amp; Pick Franchises
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-[#52525B]">
                  Create your private account, pick up to 2 franchise types, and set your Gmail
                  alert rules.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={140}>
              <div className="h-full rounded-2xl bg-[#F4F4F5] p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#1447E6] text-xl font-bold text-white">
                  2
                </span>
                <h3 className="mt-5 text-2xl font-bold text-[#0A0A0A]">
                  Save Vehicle &amp; PDF
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-[#52525B]">
                  Connect your ltfrb-foa.ph account, enter your vehicle details, and upload your
                  Sales Invoice PDF.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={220}>
              <div className="h-full rounded-2xl bg-[#F4F4F5] p-7">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[#1447E6] text-xl font-bold text-white">
                  3
                </span>
                <h3 className="mt-5 text-2xl font-bold text-[#0A0A0A]">
                  Get Alerts &amp; Reserve
                </h3>
                <p className="mt-3 text-lg leading-relaxed text-[#52525B]">
                  Every 15 minutes we check slots, email you updates, and submit automatically when
                  your trigger fires — then stop as soon as you get your Case Number.
                </p>
              </div>
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="mx-auto max-w-5xl px-5 py-16 sm:px-8">
        <ScrollReveal>
          <h2 className="text-3xl font-bold text-[#0A0A0A] sm:text-4xl">
            Frequently Asked Questions
          </h2>
        </ScrollReveal>

        <div className="mt-8 space-y-4">
          {[
            {
              q: "Do I need to keep my phone or computer open?",
              a: "No. Once you save your alert and reservation details, checks run automatically on the server every 15 minutes even when your browser is closed.",
            },
            {
              q: "What if I only have my Sales Invoice and no OR/CR yet?",
              a: "That is fine. You can upload your Sales Invoice PDF now so your application is ready to reserve a slot, and add your OR and CR later.",
            },
            {
              q: "Will it keep submitting after my application succeeds?",
              a: "No. The moment LTFRB accepts your application and issues a Case Number, automatic submission stops permanently and sends you an email confirmation.",
            },
            {
              q: "What happens after a slot is reserved?",
              a: "You log in to ltfrb-foa.ph to finish the final compliance steps for your Case Number: uploading OR/CR (if pending), PMVIC/insurance checks, and checkout payment.",
            },
          ].map((item, idx) => (
            <ScrollReveal key={item.q} delayMs={idx * 60}>
              <div className="rounded-2xl bg-white p-6 sm:p-7">
                <h3 className="text-xl font-bold text-[#0A0A0A]">{item.q}</h3>
                <p className="mt-2 text-lg leading-relaxed text-[#52525B]">{item.a}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="bg-[#1447E6] text-white">
        <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-8">
          <ScrollReveal>
            <h2 className="text-3xl font-bold sm:text-4xl">Ready to Watch Your LTFRB Slots?</h2>
            <p className="mx-auto mt-3 max-w-2xl text-xl leading-relaxed text-[#EFF6FF]">
              {summary.userEmail
                ? "Go to your dashboard to manage your 15-minute email alerts and automatic reservation."
                : "Sign in or create a free account first to access your dashboard, 15-minute email alerts, and automatic reservation."}
            </p>
            <div className="mt-8 flex flex-col justify-center gap-4 sm:flex-row">
              <Link
                href={summary.userEmail ? "/dashboard" : "/login"}
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-white px-7 py-4 text-lg font-bold text-[#102E7A] hover:bg-[#EFF6FF] focus:outline-none focus:ring-4 focus:ring-white/40"
              >
                {summary.userEmail ? "Open My Dashboard" : "Sign In / Create Account"}
              </Link>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <footer className="bg-[#0A0A0A] px-5 py-8 text-center text-base text-[#E4E4E7] sm:px-8">
        LTFRB Slot Helper — Independent Monitoring &amp; Application Assistant for ltfrb-foa.ph
      </footer>
    </div>
  );
}
