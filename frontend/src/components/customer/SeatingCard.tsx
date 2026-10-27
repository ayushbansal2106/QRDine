"use client";

import React from "react";

interface SeatingCardProps {
  tableNumber: number;
  /** True while this guest has an active dining session. */
  isLive: boolean;
  /** e.g. "bill_requested" — changes what the guest can still do. */
  sessionStatus?: string | null;
}

/**
 * "Open now · Dine-in" plus the table card.
 *
 * The Live badge reflects *this guest's* session, not a global kitchen state —
 * it is the only honest signal available client-side without an extra request,
 * and it matches what the guest has actually done (scan → session created).
 */
export const SeatingCard: React.FC<SeatingCardProps> = ({
  tableNumber,
  isLive,
  sessionStatus,
}) => {
  const locked = sessionStatus === "bill_requested" || sessionStatus === "awaiting_payment";

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center gap-xs text-body-sm text-on-surface-variant">
        <span className="material-symbols-outlined text-[16px]">schedule</span>
        <span>Open now</span>
        <span className="mx-0.5">·</span>
        <span className="text-on-surface font-medium">Dine-in</span>
      </div>

      <div className="flex items-center gap-sm rounded-xl bg-surface-container-lowest border border-surface-container px-md py-sm">
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[22px] text-primary"
        >
          chair
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-on-surface-variant">You&apos;re seated at</p>
          <p className="text-body-lg font-semibold text-on-surface leading-tight">
            T-{tableNumber}
          </p>
        </div>

        <span
          className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            isLive
              ? "bg-success-container text-on-success-container"
              : "bg-surface-container text-on-surface-variant"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-success" : "bg-on-surface-variant"}`}
          />
          {locked ? "Bill raised" : isLive ? "Live" : "Scanning"}
        </span>
      </div>
    </div>
  );
};