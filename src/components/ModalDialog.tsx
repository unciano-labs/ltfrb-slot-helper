"use client";

import { useEffect, type ReactNode } from "react";

interface ModalDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  titleId: string;
  maxWidthClass?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function ModalDialog({
  open,
  title,
  subtitle,
  titleId,
  maxWidthClass = "max-w-3xl",
  onClose,
  children,
}: ModalDialogProps) {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0A0A0A]/60 pt-10 sm:items-center sm:p-6"
    >
      <div
        className={`flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:max-h-[90dvh] sm:rounded-2xl sm:pb-0 ${maxWidthClass}`}
      >
        <div className="shrink-0 bg-[#F4F4F5] px-5 pt-2.5 pb-4 sm:px-8 sm:py-5">
          <div className="mx-auto mb-2.5 h-1.5 w-12 rounded-full bg-[#D4D4D8] sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 pr-2">
              <h2 id={titleId} className="text-xl font-bold leading-snug text-[#0A0A0A] sm:text-2xl">
                {title}
              </h2>
              {subtitle && (
                <p className="mt-1 text-base leading-snug text-[#3F3F46]">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="min-h-12 min-w-12 shrink-0 rounded-xl bg-[#18181B] px-4 py-2.5 text-base font-bold text-white hover:bg-[#3F3F46] focus:outline-none focus:ring-4 focus:ring-blue-700/30 sm:bg-white sm:px-5 sm:text-[#0A0A0A] sm:hover:bg-[#E4E4E7]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overscroll-contain overflow-y-auto p-5 sm:p-8">
          {children}
        </div>
      </div>
    </div>
  );
}
