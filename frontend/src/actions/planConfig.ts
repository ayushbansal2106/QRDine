"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage, apiErrorStatus } from "@/lib/errorMessage";

/**
 * The plan-wise feature configuration for the control plane.
 *
 * ── Why a Server Action ───────────────────────────────────────────────────
 * `PUT /api/superadmin/plan-config` is guarded by `validateCsrfToken`, the
 * double-submit check: the `x-csrf-token` header must equal the `csrf_token`
 * cookie. The cookie belongs to the Next.js origin, the API lives on another
 * one, and browsers refuse to let JavaScript set the `Cookie` header — so a
 * client-side `apiClient.put` arrives with the header and no cookie, and the
 * backend answers 403 "CSRF token missing". Running the mutation here, where
 * `apiClient` may set the header, is the pattern the rest of the control plane
 * already uses (see `actions/superadmin.ts`).
 *
 * ── What "plan-wise" means ───────────────────────────────────────────────
 * A *plan* says what its subscribers get. That is a different thing from the
 * global feature catalog (a platform-wide availability override) and a
 * different thing again from a per-tenant exception. They are three separate
 * layers, and this module owns only the first — which is why the global
 * catalog has its own actions at the bottom of this file rather than being
 * folded into the matrix.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface PlanFeature {
  key: string;
  label: string;
  group: string;
  description: string;
  /** A capability the counter cannot work without. */
  core: boolean;
}

export interface PlanLimitRow {
  key: string;
  label: string;
  description: string;
  unit: string;
  period: string;
  /** 'metric' is a metered quota; 'plan' is a plan attribute. */
  kind: "metric" | "plan";
  min: number;
  max: number;
  /** Whether `null` (unlimited) is a legal value for this row. */
  unlimitedAllowed: boolean;
}

export interface PlanMatrixPlan {
  key: string;
  name: string;
  blurb: string;
  order: number;
  isPaid: boolean;
  pricing: {
    currency: string;
    monthly: { paise: number; rupees: number };
    annual: { paise: number; rupees: number };
    cycles: string[];
  };
  /** The effective entitlements — catalogue defaults with the saved changes merged over them. */
  features: Record<string, boolean>;
  /** The catalogue defaults, for showing what a change actually altered. */
  baselineFeatures: Record<string, boolean>;
  limits: Record<string, number | null>;
  baselineLimits: Record<string, number | null>;
  /** Bumped on every save. The server refuses a stale one. */
  version: number;
  /** Whether this plan has ever been saved. */
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string;
  note: string;
}

export interface GlobalAvailability {
  exists: boolean;
  granted: Record<string, boolean>;
  blocked: Record<string, boolean>;
}

export interface PlanMatrix {
  plans: PlanMatrixPlan[];
  features: PlanFeature[];
  groups: string[];
  limitRows: PlanLimitRow[];
  globalAvailability: GlobalAvailability;
}

export interface PlanMatrixResult {
  success: boolean;
  matrix: PlanMatrix | null;
  message?: string;
}

export interface PlanSaveResult {
  success: boolean;
  matrix: PlanMatrix | null;
  changedPlans: string[];
  message?: string;
}

/** One plan's worth of changes. Only the parts that changed are sent. */
export interface PlanChange {
  planKey: string;
  expectedVersion?: number;
  features?: Record<string, boolean>;
  limits?: Record<string, number | null>;
}

// ─── Reads ───────────────────────────────────────────────────────────────

export async function getPlanMatrix(): Promise<PlanMatrixResult> {
  try {
    const response = await apiClient.get("/superadmin/plan-config");
    return { success: true, matrix: response.data as PlanMatrix };
  } catch (error: unknown) {
    console.error("Failed to load plan configuration:", error);
    return {
      success: false,
      matrix: null,
      message: apiErrorMessage(error, "Failed to load the plan configuration."),
    };
  }
}

// ─── Mutations (CSRF-protected; must run server-side) ────────────────────

export async function savePlanMatrix(
  plans: PlanChange[],
  note = ""
): Promise<PlanSaveResult> {
  if (!Array.isArray(plans) || plans.length === 0) {
    return { success: false, matrix: null, changedPlans: [], message: "Nothing to save." };
  }

  try {
    const response = await apiClient.put("/superadmin/plan-config", {
      plans,
      note: note.slice(0, 300),
    });
    return {
      success: true,
      matrix: response.data as PlanMatrix,
      changedPlans: (response.data.changedPlans || []) as string[],
    };
  } catch (error: unknown) {
    console.error("Failed to save plan configuration:", error);
    return {
      success: false,
      matrix: null,
      changedPlans: [],
      // A 409 means somebody else saved this plan in the meantime. That is a
      // different problem from a validation error, and the operator needs to
      // know which one it is before deciding whether to reload.
      message:
        apiErrorStatus(error) === 409
          ? apiErrorMessage(
              error,
              "This plan was changed by another administrator. Reload and apply your change again."
            )
          : apiErrorMessage(error, "Failed to save the plan configuration."),
    };
  }
}

// ─── The global feature catalog (a separate layer) ───────────────────────

export interface FeatureCatalog {
  id: string | null;
  /** Opened for every plan, whatever the catalogue says. */
  features: Record<string, boolean>;
  /** Closed for every plan, whatever the catalogue says. Wins over a plan. */
  blocked: Record<string, boolean>;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FeatureCatalogResult {
  success: boolean;
  exists: boolean;
  catalog: FeatureCatalog | null;
  message?: string;
}

export async function getFeatureCatalog(): Promise<FeatureCatalogResult> {
  try {
    const response = await apiClient.get("/superadmin/feature-catalog");
    return {
      success: true,
      exists: Boolean(response.data.exists),
      catalog: (response.data.catalog || null) as FeatureCatalog | null,
    };
  } catch (error: unknown) {
    console.error("Failed to load feature catalog:", error);
    return {
      success: false,
      exists: false,
      catalog: null,
      message: apiErrorMessage(error, "Failed to load the feature catalog."),
    };
  }
}

export async function saveFeatureCatalog(
  features: Record<string, boolean>,
  blocked: Record<string, boolean>
): Promise<FeatureCatalogResult> {
  try {
    const response = await apiClient.put("/superadmin/feature-catalog", {
      features,
      blocked,
    });
    return {
      success: true,
      exists: true,
      catalog: (response.data.catalog || null) as FeatureCatalog | null,
    };
  } catch (error: unknown) {
    console.error("Failed to save feature catalog:", error);
    return {
      success: false,
      exists: false,
      catalog: null,
      message: apiErrorMessage(error, "Failed to save the feature catalog."),
    };
  }
}
