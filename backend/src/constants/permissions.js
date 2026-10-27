/**
 * Granular permission catalog and role defaults (Module #08 — RBAC).
 *
 * Resolution rules used across the app:
 *  - owner always has every permission.
 *  - any other role uses its custom `User.permissions` array when non-empty,
 *    otherwise falls back to the role defaults below.
 * This lets managers grant AND revoke individual capabilities per employee.
 */

const PERMISSIONS = {
  POS_USE: 'pos.use',
  ORDER_VIEW: 'order.view',
  ORDER_STATUS: 'order.status',
  ORDER_CANCEL: 'order.cancel',
  ORDER_DISCOUNT: 'order.discount',
  ORDER_REFUND: 'order.refund',
  KDS_USE: 'kds.use',
  MENU_MANAGE: 'menu.manage',
  MENU_AVAILABILITY: 'menu.availability',
  TABLE_MANAGE: 'table.manage',
  // The counter flow. Split deliberately: a cashier settles tables all day, but
  // changing what a guest owes (discount, comp, manual add) is a manager's
  // call — it is the one action on a bill that quietly loses the cafe money.
  BILL_VIEW: 'bill.view',
  BILL_PAY: 'bill.pay',
  BILL_ADJUST: 'bill.adjust',
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  DRAWER_OPEN: 'drawer.open',
  STAFF_MANAGE: 'staff.manage',
  SETTINGS_EDIT: 'settings.edit',
  CUSTOMER_MANAGE: 'customer.manage',
  COUPON_MANAGE: 'coupon.manage',
  SCRATCH_MANAGE: 'scratch.manage',
  LOYALTY_MANAGE: 'loyalty.manage',
  WALLET_MANAGE: 'wallet.manage',
  GEOFENCE_MANAGE: 'geofence.manage',
  NFC_MANAGE: 'nfc.manage',
  REVIEW_MANAGE: 'review.manage',
  REVIEW_RESPONSE: 'review.response',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

const ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS,
  manager: [
    PERMISSIONS.POS_USE,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_STATUS,
    PERMISSIONS.ORDER_CANCEL,
    PERMISSIONS.ORDER_DISCOUNT,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.KDS_USE,
    PERMISSIONS.MENU_MANAGE,
    PERMISSIONS.MENU_AVAILABILITY,
    PERMISSIONS.TABLE_MANAGE,
    PERMISSIONS.BILL_VIEW,
    PERMISSIONS.BILL_PAY,
    PERMISSIONS.BILL_ADJUST,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.REPORT_EXPORT,
    PERMISSIONS.DRAWER_OPEN,
    PERMISSIONS.STAFF_MANAGE,
    PERMISSIONS.SETTINGS_EDIT,
    PERMISSIONS.CUSTOMER_MANAGE,
    PERMISSIONS.COUPON_MANAGE,
    PERMISSIONS.SCRATCH_MANAGE,
    PERMISSIONS.LOYALTY_MANAGE,
    PERMISSIONS.WALLET_MANAGE,
    PERMISSIONS.GEOFENCE_MANAGE,
    PERMISSIONS.NFC_MANAGE,
    PERMISSIONS.REVIEW_MANAGE,
    PERMISSIONS.REVIEW_RESPONSE,
  ],
  cashier: [
    PERMISSIONS.POS_USE,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_STATUS,
    PERMISSIONS.DRAWER_OPEN,
    // A cashier reaches /bills constantly — that is the counter job — and takes
    // the payment. No BILL_ADJUST: they may not discount or comp a table.
    PERMISSIONS.BILL_VIEW,
    PERMISSIONS.BILL_PAY,
  ],
  waiter: [
    PERMISSIONS.POS_USE,
    PERMISSIONS.ORDER_VIEW,
    PERMISSIONS.ORDER_STATUS,
    PERMISSIONS.TABLE_MANAGE,
    PERMISSIONS.KDS_USE,
  ],
  barista: [PERMISSIONS.KDS_USE, PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_STATUS],
  staff: [PERMISSIONS.ORDER_VIEW, PERMISSIONS.ORDER_STATUS, PERMISSIONS.KDS_USE],
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

const getDefaultPermissions = (role) => [...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.staff)];

/**
 * Compute the effective permission set for a user document.
 */
const getEffectivePermissions = (user) => {
  if (!user) return [];
  if (user.role === 'owner') return [...ALL_PERMISSIONS];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  return getDefaultPermissions(user.role);
};

const hasPermission = (user, permission) => getEffectivePermissions(user).includes(permission);

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLES,
  getDefaultPermissions,
  getEffectivePermissions,
  hasPermission,
};
