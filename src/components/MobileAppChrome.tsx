"use client";

import { useState } from "react";
import Link from "next/link";
import ModalDialog from "@/components/ModalDialog";

export type AppTabId = "slots" | "alerts" | "account" | "reserve" | "billing" | "logs";

interface MobileAppChromeProps {
  activeTab: AppTabId;
  screenTitle: string;
  userEmail: string | null;
  supabaseConfigured: boolean;
  checkingNow: boolean;
  openSlotsCount: number;
  alertsCount: number;
  armedProfilesCount: number;
  hasSavedAccount: boolean;
  planBadgeText: string;
  planBadgeStyle: string;
  canUseSuperAdmin: boolean;
  onSelectTab: (tab: AppTabId) => void;
  onCheckNow: () => void;
  onOpenSuperAdmin: () => void;
  onSignOut: () => void;
}

export default function MobileAppChrome({
  activeTab,
  screenTitle,
  userEmail,
  supabaseConfigured,
  checkingNow,
  openSlotsCount,
  alertsCount,
  armedProfilesCount,
  hasSavedAccount,
  planBadgeText,
  planBadgeStyle,
  canUseSuperAdmin,
  onSelectTab,
  onCheckNow,
  onOpenSuperAdmin,
  onSignOut,
}: MobileAppChromeProps) {
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);

  const isMoreActive = activeTab === "account" || activeTab === "billing" || moreSheetOpen;

  function chooseTabFromSheet(tab: AppTabId) {
    setMoreSheetOpen(false);
    onSelectTab(tab);
  }

  return (
    <>
      {/* Sticky Native Mobile/Tablet App Bar */}
      <div className="sticky top-0 z-30 bg-white px-4 py-3 shadow-[0_2px_12px_rgba(10,10,10,0.06)] lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#102E7A] text-base font-bold text-white">
              LT
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight text-[#0A0A0A]">
                {screenTitle}
              </p>
              <p className="truncate text-base leading-tight text-[#52525B]">
                {supabaseConfigured ? "Live Sync ON (15s)" : "LTFRB Slot Helper"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCheckNow}
            disabled={checkingNow}
            className="min-h-12 shrink-0 rounded-xl bg-[#1447E6] px-4 py-2.5 text-base font-bold text-white hover:bg-[#1039B8] focus:outline-none focus:ring-4 focus:ring-blue-700/30 disabled:opacity-60"
          >
            {checkingNow ? "Checking..." : "Check Now"}
          </button>
        </div>
      </div>

      {/* Fixed Native Bottom Tab Bar (Mobile & Tablet) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed inset-x-0 bottom-0 z-40 bg-white px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(10,10,10,0.08)] lg:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around gap-1">
          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false);
              onSelectTab("slots");
            }}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-base font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
              activeTab === "slots" && !moreSheetOpen
                ? "bg-[#EFF6FF] text-[#1447E6]"
                : "text-[#3F3F46] hover:bg-[#F4F4F5]"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span className="whitespace-nowrap">Slots</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false);
              onSelectTab("alerts");
            }}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-base font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
              activeTab === "alerts" && !moreSheetOpen
                ? "bg-[#EFF6FF] text-[#1447E6]"
                : "text-[#3F3F46] hover:bg-[#F4F4F5]"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="whitespace-nowrap">Alerts</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false);
              onSelectTab("reserve");
            }}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-base font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
              activeTab === "reserve" && !moreSheetOpen
                ? "bg-[#EFF6FF] text-[#1447E6]"
                : "text-[#3F3F46] hover:bg-[#F4F4F5]"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            <span className="whitespace-nowrap">Reserve</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false);
              onSelectTab("logs");
            }}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-base font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
              activeTab === "logs" && !moreSheetOpen
                ? "bg-[#EFF6FF] text-[#1447E6]"
                : "text-[#3F3F46] hover:bg-[#F4F4F5]"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="whitespace-nowrap">Logs</span>
          </button>

          <button
            type="button"
            onClick={() => setMoreSheetOpen(true)}
            className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-base font-bold transition-colors focus:outline-none focus:ring-4 focus:ring-blue-700/30 ${
              isMoreActive
                ? "bg-[#EFF6FF] text-[#1447E6]"
                : "text-[#3F3F46] hover:bg-[#F4F4F5]"
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="h-6 w-6"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
            </svg>
            <span className="whitespace-nowrap">More</span>
          </button>
        </div>
      </nav>

      {/* Native-Style More & Account Bottom Sheet Modal */}
      <ModalDialog
        open={moreSheetOpen}
        title="Account & Settings"
        subtitle={userEmail ?? "Operator Dashboard"}
        titleId="mobile-more-sheet-title"
        maxWidthClass="max-w-lg"
        onClose={() => setMoreSheetOpen(false)}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-[#F4F4F5] p-3.5">
              <p className="text-base font-bold text-[#52525B]">Open Slots</p>
              <p className="mt-0.5 text-xl font-bold text-[#0A0A0A]">{openSlotsCount}</p>
            </div>
            <div className="rounded-xl bg-[#F4F4F5] p-3.5">
              <p className="text-base font-bold text-[#52525B]">Alerts</p>
              <p className="mt-0.5 text-xl font-bold text-[#0A0A0A]">{alertsCount}</p>
            </div>
            <div className="rounded-xl bg-[#F4F4F5] p-3.5">
              <p className="text-base font-bold text-[#52525B]">Armed</p>
              <p className="mt-0.5 text-xl font-bold text-[#0A0A0A]">{armedProfilesCount}</p>
            </div>
          </div>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => chooseTabFromSheet("account")}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left text-lg font-bold transition-colors ${
                activeTab === "account"
                  ? "bg-[#1447E6] text-white"
                  : "bg-[#F4F4F5] text-[#0A0A0A] hover:bg-[#E4E4E7]"
              }`}
            >
              <span>LTFRB Account Login</span>
              <span
                className={`rounded-lg px-3 py-1 text-base font-bold ${
                  activeTab === "account"
                    ? "bg-[#102E7A] text-white"
                    : hasSavedAccount
                    ? "bg-[#DCFCE7] text-[#14532D]"
                    : "bg-white text-[#52525B]"
                }`}
              >
                {hasSavedAccount ? "Saved" : "Setup"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => chooseTabFromSheet("billing")}
              className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-4 py-3.5 text-left text-lg font-bold transition-colors ${
                activeTab === "billing"
                  ? "bg-[#1447E6] text-white"
                  : "bg-[#F4F4F5] text-[#0A0A0A] hover:bg-[#E4E4E7]"
              }`}
            >
              <span>Plan &amp; Billing</span>
              <span
                className={`rounded-lg px-3 py-1 text-base font-bold ${
                  activeTab === "billing" ? "bg-[#102E7A] text-white" : planBadgeStyle
                }`}
              >
                {planBadgeText}
              </span>
            </button>

            {canUseSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setMoreSheetOpen(false);
                  onOpenSuperAdmin();
                }}
                className="min-h-12 w-full rounded-xl bg-[#102E7A] px-4 py-3.5 text-left text-lg font-bold text-white hover:bg-[#0B225C]"
              >
                SuperAdmin Panel
              </button>
            )}

            <Link
              href="/"
              onClick={() => setMoreSheetOpen(false)}
              className="flex min-h-12 w-full items-center justify-between rounded-xl bg-[#F4F4F5] px-4 py-3.5 text-lg font-bold text-[#0A0A0A] hover:bg-[#E4E4E7]"
            >
              <span>Public Landing Page</span>
            </Link>

            {userEmail ? (
              <button
                type="button"
                onClick={() => {
                  setMoreSheetOpen(false);
                  onSignOut();
                }}
                className="min-h-12 w-full rounded-xl bg-[#FEE2E2] px-4 py-3.5 text-left text-lg font-bold text-[#7F1D1D] hover:bg-[#FECACA]"
              >
                Sign Out
              </button>
            ) : (
              <Link
                href="/login"
                onClick={() => setMoreSheetOpen(false)}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-[#1447E6] px-4 py-3.5 text-lg font-bold text-white hover:bg-[#1039B8]"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </ModalDialog>
    </>
  );
}
