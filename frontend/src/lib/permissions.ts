import { PERMISSIONS } from "./permissionCatalog";

/**
 * Which admin surfaces require which backend permission.
 *
 * The backend enforces this with `authorizeRoles`/`requirePermission`; this map
 * is the frontend mirror so the sidebar can hide links the signed-in operator
 * cannot actually open. Without it a cashier sees the whole admin menu and every
 * click is a 403.
 *
 * `null` means "any authenticated operator may open this".
 */
export const ROUTE_PERMISSIONS: Record<string, string[] | null> = {
  // The dashboard is the landing surface: it aggregates read-only operational
  // and reporting data, so any operator who can view orders may open it.
  "/cafe/dashboard": [PERMISSIONS.ORDER_VIEW],
  "/cafe/pos": [PERMISSIONS.POS_USE],
  "/cafe/orders": [PERMISSIONS.ORDER_VIEW],
  "/cafe/kitchen": [PERMISSIONS.KDS_USE],
  "/cafe/menu": [PERMISSIONS.MENU_MANAGE],
  "/cafe/tables": [PERMISSIONS.TABLE_MANAGE],
  "/cafe/requests": [PERMISSIONS.ORDER_VIEW],
  "/cafe/customers": [PERMISSIONS.CUSTOMER_MANAGE],
  "/cafe/loyalty": [PERMISSIONS.LOYALTY_MANAGE],
  "/cafe/coupons": [PERMISSIONS.COUPON_MANAGE],
  "/cafe/wallets": [PERMISSIONS.WALLET_MANAGE],
  "/cafe/scratch": [PERMISSIONS.SCRATCH_MANAGE],
  // Bills is the counter surface, not a report: a cashier settles tables here
  // all day, so it is gated on `bill.view` rather than `report.view`. Cashier
  // holds BILL_VIEW/BILL_PAY but not BILL_ADJUST, so they can charge a table and
  // cannot discount one.
  "/cafe/bills": [PERMISSIONS.BILL_VIEW],
  "/cafe/sales": [PERMISSIONS.REPORT_VIEW],
  "/cafe/audit": [PERMISSIONS.REPORT_VIEW],
  "/cafe/shift": [PERMISSIONS.DRAWER_OPEN],
  "/cafe/analytics": [PERMISSIONS.REPORT_VIEW],
  "/cafe/reviews": [PERMISSIONS.REVIEW_MANAGE],
  "/cafe/geofence": [PERMISSIONS.GEOFENCE_MANAGE],
  "/cafe/qr": [PERMISSIONS.TABLE_MANAGE],
  "/cafe/nfc": [PERMISSIONS.NFC_MANAGE],
  "/cafe/pilot": [PERMISSIONS.STAFF_MANAGE],
  "/cafe/settings": [PERMISSIONS.STAFF_MANAGE],
  "/cafe/lock": null,
  "/staff/waiter": null,
};

/**
 * Can this operator open `pathname`?
 *
 * Uses the longest matching route prefix so `/cafe/orders/123` inherits the
 * rule from `/cafe/orders`. Unknown paths are allowed through so a newly added
 * page is not accidentally hidden; the backend remains the real gate.
 */
export function canAccessPath(
  pathname: string,
  permissions: string[] | null | undefined
): boolean {
  const required = resolveRequiredPermissions(pathname);
  // No rule, or a rule with no permission requirement.
  if (!required || required.length === 0) return true;
  // No permission data yet (e.g. session still loading) — do not hide the link.
  if (!permissions) return true;

  return required.some((permission) => permissions.includes(permission));
}

function resolveRequiredPermissions(pathname: string): string[] | null {
  if (ROUTE_PERMISSIONS[pathname] !== undefined) {
    return ROUTE_PERMISSIONS[pathname];
  }
  // Longest-prefix match, so a nested route inherits its parent's rule.
  const match = Object.keys(ROUTE_PERMISSIONS)
    .filter((route) => route !== "/" && pathname.startsWith(`${route}/`))
    .sort((a, b) => b.length - a.length)[0];

  return match ? ROUTE_PERMISSIONS[match] : null;
}