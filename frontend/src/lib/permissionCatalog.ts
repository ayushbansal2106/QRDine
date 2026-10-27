/**
 * Permission strings, mirroring `backend/src/constants/permissions.js`.
 *
 * Kept as a literal map (rather than imported from the backend) because the
 * frontend bundle must not depend on backend CommonJS modules. The values are
 * wire identifiers — if one changes, both sides must change together.
 */
export const PERMISSIONS = {
  POS_USE: "pos.use",
  ORDER_VIEW: "order.view",
  ORDER_STATUS: "order.status",
  ORDER_CANCEL: "order.cancel",
  ORDER_DISCOUNT: "order.discount",
  ORDER_REFUND: "order.refund",
  KDS_USE: "kds.use",
  MENU_MANAGE: "menu.manage",
  MENU_AVAILABILITY: "menu.availability",
  TABLE_MANAGE: "table.manage",
  BILL_VIEW: "bill.view",
  BILL_PAY: "bill.pay",
  BILL_ADJUST: "bill.adjust",
  REPORT_VIEW: "report.view",
  REPORT_EXPORT: "report.export",
  DRAWER_OPEN: "drawer.open",
  STAFF_MANAGE: "staff.manage",
  SETTINGS_EDIT: "settings.edit",
  CUSTOMER_MANAGE: "customer.manage",
  COUPON_MANAGE: "coupon.manage",
  SCRATCH_MANAGE: "scratch.manage",
  LOYALTY_MANAGE: "loyalty.manage",
  WALLET_MANAGE: "wallet.manage",
  GEOFENCE_MANAGE: "geofence.manage",
  NFC_MANAGE: "nfc.manage",
  REVIEW_MANAGE: "review.manage",
  REVIEW_RESPONSE: "review.response",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];