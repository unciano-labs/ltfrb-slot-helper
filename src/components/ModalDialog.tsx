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
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[#0A0A0A]/60 p-0 sm:items-center sm:p-6"
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:max-h-[90vh] sm:rounded-2xl sm:pb-0 ${maxWidthClass}`}
      >
        <div className="flex items-start justify-between gap-4 bg-[#F4F4F5] px-5 py-4 sm:px-8 sm:py-5">
          <div className="min-w-0 flex-1 pr-2">
            <h2 id={titleId} className="text-xl font-bold text-[#0A0A0A] sm:text-2xl">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-1 text-base leading-relaxed text-[#3F3F46]">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 shrink-0 rounded-xl bg-white px-5 py-2.5 text-base font-bold text-[#0A0A0A] hover:bg-[#E4E4E7] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
          >
            Close
          </button>
        </div>

        <div className="overscroll-contain overflow-y-auto p-5 sm:p-8">{children}</div>
      </div>
    </div>
  );
}
