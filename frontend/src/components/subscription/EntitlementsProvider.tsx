"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { getMyEntitlements } from "@/actions/subscription";
import type { TenantEntitlements, UsageSummary } from "@/types";

/**
 * Entitlement state for the admin shell.
 *
 * ── What this is, and is not ─────────────────────────────────────────────
 * This is a *rendering* aid. It decides which actions to show and when to say
 * "upgrade", nothing more. Every protected endpoint independently re-resolves
 * the same entitlements on the server (`entitlementService.requireFeature`), so a
 * user who edits this provider's state — or calls the API directly with curl —
 * gets the same 402/403/410 as the UI would have predicted.
 *
 * ── Why a provider ───────────────────────────────────────────────────────
 * The initial value is resolved in the dashboard layout (a Server Component) and
 * passed down, so the first paint already knows the plan. Fetching on mount
 * would flash premium navigation for a Starter cafe on every navigation.
 *
 * A missing entitlement resolves to "not allowed": if the state could not be
 * loaded, the UI shows the upgrade path rather than optimistically revealing a
 * feature the backend will refuse.
 */
interface EntitlementsContextValue {
  entitlements: TenantEntitlements | null;
  usage: UsageSummary[];
  /** False when entitlements are unknown — fail closed in the UI too. */
  hasFeature: (feature: string) => boolean;
  usageFor: (metric: string) => UsageSummary | null;
  /** Re-fetch after a plan change, so gates and meters reflect it immediately. */
  refresh: () => Promise<void>;
  isRefreshing: boolean;
  error: string | null;
}

const EntitlementsContext = createContext<EntitlementsContextValue>({
  entitlements: null,
  usage: [],
  hasFeature: () => false,
  usageFor: () => null,
  refresh: async () => {},
  isRefreshing: false,
  error: null,
});

export function EntitlementsProvider({
  initialEntitlements,
  initialUsage,
  children,
}: {
  initialEntitlements: TenantEntitlements | null;
  initialUsage?: UsageSummary[];
  children: React.ReactNode;
}) {
  const [entitlements, setEntitlements] = useState<TenantEntitlements | null>(
    initialEntitlements
  );
  const [usage, setUsage] = useState<UsageSummary[]>(initialUsage ?? []);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const result = await getMyEntitlements();

    if (!result.success) {
      // Keep the last known state rather than locking the whole shell because one
      // request failed; the backend still refuses anything not entitled.
      setError(result.message);
      return;
    }

    setError(null);
    startTransition(() => {
      setEntitlements(result.entitlements);
      setUsage(result.usage ?? []);
    });
  }, []);

  const value = useMemo<EntitlementsContextValue>(() => {
    const features = new Set(entitlements?.features ?? []);

    return {
      entitlements,
      usage,
      hasFeature: (feature: string) => features.has(feature),
      usageFor: (metric: string) => usage.find((u) => u.metric === metric) ?? null,
      refresh,
      isRefreshing,
      error,
    };
  }, [entitlements, usage, refresh, isRefreshing, error]);

  return (
    <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>
  );
}

/** Read the tenant's plan entitlements. Equivalent of `useEntitlements()`. */
export function useEntitlements() {
  return useContext(EntitlementsContext);
}
