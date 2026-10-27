import { apiClient } from "@/lib/apiClient";
import { apiErrorStatus } from "@/lib/errorMessage";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { canAccessPath } from "@/lib/permissions";

export interface CurrentOperator {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

/**
 * Effective permissions for the signed-in operator.
 *
 * `/auth/me` is the one endpoint every authenticated role may call, and it
 * returns the *effective* set (custom overrides, or role defaults), so this is
 * the single source of truth for gating the UI. Returns null when there is no
 * valid session.
 */
export type OperatorState =
  | { status: "authenticated"; operator: CurrentOperator }
  | { status: "suspended" }
  | { status: "unauthenticated" };

/**
 * The signed-in operator, or *why* there isn't one.
 *
 * "No session" and "tenant suspended" must not be collapsed into the same
 * `null`. A suspended café still holds a valid `admin_token`, so treating the
 * 410 as "logged out" bounced it to a login form that can never succeed (login
 * itself is refused for a terminated tenant) — a loop with no way out, and the
 * dashboard rendered far enough to fire dozens of failing API calls.
 */
export async function getOperatorState(): Promise<OperatorState> {
  const cookieStore = await cookies();
  if (!cookieStore.get("admin_token")?.value) return { status: "unauthenticated" };

  try {
    const response = await apiClient.get("/auth/me");
    return { status: "authenticated", operator: response.data.user as CurrentOperator };
  } catch (error: unknown) {
    // 410 Gone — the backend refused because the tenant is terminated.
    if (apiErrorStatus(error) === 410) return { status: "suspended" };
    // Expired or revoked token — treat as no session.
    return { status: "unauthenticated" };
  }
}

export async function getCurrentOperator(): Promise<CurrentOperator | null> {
  const state = await getOperatorState();
  return state.status === "authenticated" ? state.operator : null;
}

/**
 * Server Component guard for admin pages.
 *
 * The backend already rejects an unauthorised operator with 403; this converts
 * that from a crashed page into a clean redirect, so a cashier following a stale
 * bookmark lands on a real screen instead of a stack trace.
 */
export async function requirePathAccess(pathname: string): Promise<CurrentOperator> {
  const operator = await getCurrentOperator();

  if (!operator) {
    redirect("/cafe/login?clear=1");
  }

  if (!canAccessPath(pathname, operator.permissions)) {
    redirect("/cafe/orders?denied=1");
  }

  return operator;
}