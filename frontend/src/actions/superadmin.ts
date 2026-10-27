"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

/**
 * Server actions for the Super Admin control plane.
 *
 * ── Why these are Server Actions and not client-side `apiClient` calls ──────
 * Every mutating superadmin route (`/plan`, `/extend-trial`, `/terminate`,
 * `/reinstate`) is guarded by `validateCsrfToken`, which is a *double-submit*
 * check: the `x-csrf-token` header must equal the `csrf_token` **cookie**.
 *
 * The Next.js origin (localhost:3000) owns that cookie, but the API lives on a
 * different origin (127.0.0.1:5001). When a browser makes the call it will not
 * attach the frontend-origin cookie to the backend request, and browsers
 * *forbid* JavaScript from setting the `Cookie` header at all — so the backend
 * sees the header but no cookie and answers "CSRF token missing".
 *
 * On the server this works: `apiClient` reads `csrf_token` via `next/headers`
 * and sets the `Cookie` header explicitly, which is permitted outside the
 * browser. Running the mutations here — rather than in a client component — is
 * also the convention the rest of the app already follows (`src/actions/*`).
 */

export interface ActionResult {
  success: boolean;
  message: string;
}

const toResult = (error: unknown, fallback: string): ActionResult => ({
  success: false,
  message: apiErrorMessage(error, fallback),
});

// ─── Reads ───────────────────────────────────────────────────────────────

export interface SuperAdminCafe {
  cafeId: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  outletGroup: string;
  outlets: number;
  planKey: string | null;
  status: string;
  paidUntil: string | null;
  createdAt: string;
}

export async function listCafes(params?: {
  q?: string;
  status?: string;
}): Promise<{ success: boolean; cafes: SuperAdminCafe[]; message?: string }> {
  try {
    const response = await apiClient.get("/superadmin/cafes", { params });
    return { success: true, cafes: (response.data.cafes || []) as SuperAdminCafe[] };
  } catch (error: unknown) {
    console.error("Failed to load cafes:", error);
    return {
      success: false,
      cafes: [],
      message: apiErrorMessage(error, "Failed to load tenants."),
    };
  }
}

export interface PlatformOverview {
  cafes: number;
  subscriptions: number;
  trialing: number;
  active: number;
  grace: number;
  degraded: number;
  cancelled: number;
  terminated: number;
  mrrRupees: number;
  payingTenants: number;
}

export async function getOverview(): Promise<{
  success: boolean;
  overview: PlatformOverview | null;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/superadmin/overview");
    const totals = response.data.totals || {};
    const revenue = response.data.revenue || {};
    return {
      success: true,
      overview: {
        cafes: totals.cafes || 0,
        subscriptions: totals.subscriptions || 0,
        trialing: totals.trialing || 0,
        active: totals.active || 0,
        grace: totals.grace || 0,
        degraded: totals.degraded || 0,
        cancelled: totals.cancelled || 0,
        terminated: totals.terminated || 0,
        mrrRupees: revenue.mrrRupees || 0,
        payingTenants: revenue.payingTenants || 0,
      },
    };
  } catch (error: unknown) {
    console.error("Failed to load overview:", error);
    return {
      success: false,
      overview: null,
      message: apiErrorMessage(error, "Failed to load platform overview."),
    };
  }
}

export interface ExpiringTenant {
  cafeId: string;
  name: string;
  email: string;
  phone: string;
  planKey: string | null;
  status: string;
  paidUntil: string | null;
  daysRemaining: number | null;
}

export async function listExpiring(days = 14): Promise<{
  success: boolean;
  tenants: ExpiringTenant[];
  message?: string;
}> {
  try {
    const response = await apiClient.get("/superadmin/expiring", { params: { days } });
    return { success: true, tenants: (response.data.tenants || []) as ExpiringTenant[] };
  } catch (error: unknown) {
    console.error("Failed to load expiring tenants:", error);
    return {
      success: false,
      tenants: [],
      message: apiErrorMessage(error, "Failed to load renewals."),
    };
  }
}

export interface PlanCatalogueEntry {
  key: string;
  name: string;
  blurb: string;
  isPaid: boolean;
  includedOutlets: number;
  monthly: { rupees: number; withGstRupees: number };
  annual: { rupees: number; withGstRupees: number };
}

/** Public pricing catalogue — used to populate the plan picker. */
export async function getPlanCatalogue(): Promise<{
  success: boolean;
  plans: PlanCatalogueEntry[];
  message?: string;
}> {
  try {
    const response = await apiClient.get("/subscription/plans");
    const payload = response.data;
    const plans = Array.isArray(payload) ? payload : payload.plans || [];
    return { success: true, plans: plans as PlanCatalogueEntry[] };
  } catch (error: unknown) {
    console.error("Failed to load plan catalogue:", error);
    return {
      success: false,
      plans: [],
      message: apiErrorMessage(error, "Failed to load plans."),
    };
  }
}

// ─── Mutations (CSRF-protected; must run server-side) ────────────────────

export async function terminateCafe(
  cafeId: string,
  reason: string
): Promise<ActionResult> {
  if (!cafeId) return { success: false, message: "Missing tenant id." };
  if (!reason || reason.trim().length < 5) {
    return { success: false, message: "Termination requires a reason of at least 5 characters." };
  }

  try {
    const response = await apiClient.post(`/superadmin/cafes/${cafeId}/terminate`, {
      reason: reason.trim(),
    });
    return { success: true, message: response.data.message || "Tenant terminated." };
  } catch (error: unknown) {
    console.error("Failed to terminate cafe:", error);
    return toResult(error, "Failed to terminate tenant.");
  }
}

export async function reinstateCafe(cafeId: string): Promise<ActionResult> {
  if (!cafeId) return { success: false, message: "Missing tenant id." };

  try {
    const response = await apiClient.post(`/superadmin/cafes/${cafeId}/reinstate`);
    return { success: true, message: response.data.message || "Tenant reinstated." };
  } catch (error: unknown) {
    console.error("Failed to reinstate cafe:", error);
    return toResult(error, "Failed to reinstate tenant.");
  }
}

export async function setCafePlan(
  cafeId: string,
  planKey: string,
  cycle: "monthly" | "annual" = "monthly",
  outlets = 1
): Promise<ActionResult> {
  if (!cafeId) return { success: false, message: "Missing tenant id." };

  try {
    const response = await apiClient.post(`/superadmin/cafes/${cafeId}/plan`, {
      planKey,
      cycle,
      outlets,
    });
    return { success: true, message: response.data.message || "Plan updated." };
  } catch (error: unknown) {
    console.error("Failed to set plan:", error);
    return toResult(error, "Failed to update plan.");
  }
}

export async function extendCafeTrial(cafeId: string, days: number): Promise<ActionResult> {
  if (!cafeId) return { success: false, message: "Missing tenant id." };
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { success: false, message: "Days must be a whole number between 1 and 365." };
  }

  try {
    const response = await apiClient.post(`/superadmin/cafes/${cafeId}/extend-trial`, { days });
    return { success: true, message: response.data.message || `Trial extended by ${days} day(s).` };
  } catch (error: unknown) {
    console.error("Failed to extend trial:", error);
    return toResult(error, "Failed to extend trial.");
  }
}
