"use client";

import React from "react";
import Link from "next/link";

/**
 * The "this is not in your plan" surface.
 *
 * Deliberately says what happened and what to do, in that order. A paywall that
 * only says "upgrade" reads as a bug to a cafe owner whose card actually failed;
 * `lapsed` is a different message from `not included`, because the fix is
 * different (renew vs buy up).
 */
export function UpgradePrompt({
  label,
  lapsed = false,
  unavailable = false,
  className = "",
}: {
  label: string;
  /** True when the subscription has lapsed (grace/degraded) rather than never included. */
  lapsed?: boolean;
  /**
   * True when the plan could not be verified at all (the entitlement call
   * failed). Saying "not included in your plan" then would be a lie — and
   * rendering the page anyway would just fire requests the backend refuses.
   */
  unavailable?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-surface-container bg-surface-container-lowest p-lg text-center ${className}`}
    >
      <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <span className="material-symbols-outlined text-[26px] select-none">
          {unavailable ? "cloud_off" : lapsed ? "schedule" : "lock"}
        </span>
      </div>

      <h2 className="font-inter font-semibold text-title-md text-on-surface mt-md">
        {unavailable
          ? "Couldn't check your plan"
          : lapsed
            ? "Your subscription has lapsed"
            : "Not included in your plan"}
      </h2>

      <p className="font-inter text-body-md text-on-surface-variant mt-xs max-w-[420px] mx-auto">
        {unavailable
          ? `We couldn't load your subscription details, so ${label.toLowerCase()} is hidden rather than risk showing something your plan does not cover. Reload the page to try again.`
          : lapsed
            ? `${label} is unavailable until your plan is renewed. Ordering, the kitchen display and billing at the counter keep working.`
            : `${label} is part of a higher plan. Upgrade to unlock it for this cafe.`}
      </p>

      <Link
        href="/cafe/settings"
        className="inline-flex items-center gap-xs mt-md px-lg py-sm rounded-lg bg-primary text-on-primary font-inter font-semibold hover:opacity-90 transition-opacity"
      >
        <span className="material-symbols-outlined text-[18px] select-none">
          {unavailable ? "settings" : "workspace_premium"}
        </span>
        {unavailable ? "Open settings" : lapsed ? "Renew plan" : "View plans"}
      </Link>
    </div>
  );
}
