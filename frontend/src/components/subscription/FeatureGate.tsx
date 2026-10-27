"use client";

import React from "react";
import { useEntitlements } from "./EntitlementsProvider";
import { UpgradePrompt } from "./UpgradePrompt";

/**
 * Render `children` only when the tenant's plan includes `feature`.
 *
 * While entitlements are unknown (a failed load, or a page rendered outside the
 * dashboard shell) the gate closes. Opening it optimistically would flash the
 * premium surface and then 403 the first request the user makes — the one
 * experience worse than a paywall.
 *
 * This is convenience only. The matching backend route carries
 * `requireFeature(...)`; hiding a button has never protected anything.
 */
export function FeatureGate({
  feature,
  label,
  children,
  fallback,
}: {
  feature: string;
  /** Human name used in the upgrade prompt. */
  label: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { entitlements, hasFeature } = useEntitlements();

  if (hasFeature(feature)) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <UpgradePrompt
      label={label}
      lapsed={Boolean(entitlements && (entitlements.isDegraded || entitlements.isCancelled))}
      className="m-md"
    />
  );
}
