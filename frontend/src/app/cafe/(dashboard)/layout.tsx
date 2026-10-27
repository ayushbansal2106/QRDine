import React from "react";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { getOperatorState } from "@/lib/session";
import { logoutAdmin } from "@/actions/auth";
import { getMyEntitlements } from "@/actions/subscription";
import { EntitlementsProvider } from "@/components/subscription/EntitlementsProvider";
import type { TenantEntitlements, UsageSummary } from "@/types";

// The sidebar must reflect the signed-in operator's role on every navigation.
export const dynamic = "force-dynamic";

/**
 * The dashboard shell.
 *
 * A suspended (terminated) tenant is handled *here* rather than in each page,
 * for the same reason the backend enforces it in `tenantMiddleware`: every
 * `/cafe/(dashboard)` page renders through this layout, so no page can forget
 * the check.
 *
 * Without it, a terminated café still loads the shell and its client components
 * keep firing API calls that now (correctly) return 410 — which surfaced as an
 * unhandled server error from a Server Action rather than an explanation.
 * Returning early means those children never render, so the calls never happen.
 */
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getOperatorState();

  if (state.status === "suspended") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile font-inter">
        <div className="bg-surface-container-lowest w-full max-w-[440px] rounded-xl p-lg shadow-[0px_12px_32px_rgba(0,0,0,0.08)] flex flex-col items-center text-center gap-sm">
          <div className="w-12 h-12 rounded-full bg-error/10 text-error flex items-center justify-center">
            <span className="material-symbols-outlined text-[28px] select-none">block</span>
          </div>
          <h1 className="font-semibold text-headline-md text-on-surface mt-sm">
            Account suspended
          </h1>
          <p className="text-body-md text-on-surface-variant">
            This café&apos;s access to QRDine has been suspended, so the dashboard is
            unavailable. If you believe this is a mistake, contact QRDine support to
            have the account reinstated.
          </p>

          <form action={logoutAdmin} className="mt-md">
            <button
              type="submit"
              className="px-lg py-sm rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    );
  }

  const operator = state.status === "authenticated" ? state.operator : null;

  // Plan/feature entitlement for this tenant, resolved on the server.
  //
  // Fetched here rather than in a client hook so the first paint already knows
  // the plan: a client-side fetch would flash premium navigation on every
  // navigation for a Starter cafe. It is still only a *rendering* aid — every
  // protected endpoint re-checks the same rules.
  let entitlements: TenantEntitlements | null = null;
  let usage: UsageSummary[] = [];

  if (operator) {
    const result = await getMyEntitlements();
    if (result.success) {
      entitlements = result.entitlements;
      usage = result.usage ?? [];
    }
  }

  return (
    <EntitlementsProvider initialEntitlements={entitlements} initialUsage={usage}>
      <div className="flex min-h-screen bg-background text-on-surface">
        {/* Sidebar Navigation — role-aware, so operators only see what they can open */}
        <AdminSidebar
          permissions={operator?.permissions ?? null}
          featureAccess={entitlements ? entitlements.features : null}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto h-screen">
          {children}
        </div>
      </div>
    </EntitlementsProvider>
  );
}
