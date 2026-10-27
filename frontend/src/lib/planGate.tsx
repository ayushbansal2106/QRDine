import React from "react";

import { getMyEntitlements } from "@/actions/subscription";
import { UpgradePrompt } from "@/components/subscription/UpgradePrompt";

/**
 * Server-side gate for a dashboard page that *is* a paid feature.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Server Components that fetch `GET /api/audit` (or coupons, loyalty, …) run
 * before anything renders. Once those endpoints enforce the plan, a Starter cafe
 * that reached the page directly got a 403, which the page's `try/catch` turned
 * into an empty table — a blank screen with a server-console error and no
 * explanation. That is the worst of both worlds: no data, no paywall, and a
 * scary stack trace in the logs.
 *
 * Calling this *before* the fetch means the request never happens, the operator
 * gets a real upgrade message, and there is no 403 to log.
 *
 * Returns `null` when the page may render. Otherwise returns the element the page
 * should render in its place.
 *
 * This is a UX gate, not a security control: the matching backend route carries
 * `requireFeature(...)` and refuses the same request regardless of what the UI
 * decides to paint.
 */
export async function planGate(
  feature: string,
  label: string
): Promise<React.ReactElement | null> {
  const result = await getMyEntitlements();

  if (result.success) {
    const entitlements = result.entitlements;

    if (entitlements?.features?.includes(feature)) return null;

    return (
      <UpgradePrompt
        label={label}
        lapsed={Boolean(entitlements && (entitlements.isDegraded || entitlements.isCancelled))}
        className="m-md"
      />
    );
  }

  // The plan could not be verified. Fail closed — do not attempt the fetch — but
  // say so honestly instead of claiming the feature is not in the plan.
  return <UpgradePrompt label={label} unavailable className="m-md" />;
}
