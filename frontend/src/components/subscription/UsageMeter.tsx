"use client";

import React from "react";
import type { UsageSummary } from "@/types";

/**
 * "412 of 500 orders this month" — with the bar.
 *
 * An unlimited metric renders as a plain figure with no bar: a progress bar at
 * 0% of infinity is a lie the eye still reads as "almost out".
 *
 * `remaining` comes from the server and already subtracts in-flight
 * reservations, so two requests racing for the last unit cannot both be told
 * "1 left".
 */
export function UsageMeter({
  usage,
  className = "",
}: {
  usage: UsageSummary | null;
  className?: string;
}) {
  if (!usage) return null;

  const { label, used, limit, unlimited, remaining, period } = usage;
  const pct = unlimited || !limit ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const exhausted = !unlimited && remaining === 0;
  const near = !unlimited && !exhausted && pct >= 80;

  return (
    <div
      className={`rounded-lg border border-surface-container bg-surface-container-lowest p-md ${className}`}
    >
      <div className="flex items-baseline justify-between gap-sm">
        <p className="font-inter text-body-sm font-semibold text-on-surface">
          {label}
          {period === "month" && (
            <span className="font-normal text-on-surface-variant"> this month</span>
          )}
        </p>

        <p
          className={`font-inter text-body-sm font-semibold ${
            exhausted ? "text-error" : near ? "text-amber-600" : "text-on-surface"
          }`}
        >
          {unlimited ? `${used} used` : `${used} / ${limit}`}
        </p>
      </div>

      {!unlimited && (
        <div
          className="mt-sm h-2 w-full rounded-full bg-surface-container overflow-hidden"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit ?? 0}
          aria-label={`${label} used`}
        >
          <div
            className={`h-full rounded-full transition-[width] ${
              exhausted ? "bg-error" : near ? "bg-amber-500" : "bg-primary"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {exhausted && (
        <p className="mt-xs font-inter text-body-sm text-error">
          Allowance reached. New {usage.unit}s are blocked until the next period or a
          plan upgrade.
        </p>
      )}
    </div>
  );
}
