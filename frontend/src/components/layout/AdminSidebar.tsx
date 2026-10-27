"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAdmin } from "@/actions/auth";
import { canAccessPath } from "@/lib/permissions";
import { useRouter } from "next/navigation";

interface AdminSidebarProps {
  /** Effective permissions of the signed-in operator; null while unknown. */
  permissions: string[] | null;
  /** Plan feature entitlement for the cafe this operator belongs to.
   *  `null` while the shell is still loading the subscription state. */
  featureAccess: string[] | null;
}

interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Which plan feature must be present for this item to be shown.
   *  `null` means "show for any authenticated operator, regardless of plan". */
  feature?: string | null;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Navigation is grouped by how often each surface is used during service.
 *
 * Two independent gates now apply:
 *  - `canAccessPath` ⇒ operator permission (role-based, existing behavior)
 *  - `featureAccess` ⇒ plan entitlement (plan-based, new behavior)
 *
 * A starter-plan cafe should not see loyalty / coupons / wallet / scratch /
 * geofence / nfc / analytics / audits / reviews-settings unless the plan
 * includes that feature. Reaching them any other way must trigger the strict
 * upgrade modal.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    title: "Operations",
    items: [
      { label: "Dashboard", path: "/cafe/dashboard", icon: "space_dashboard", feature: null },
      { label: "POS", path: "/cafe/pos", icon: "point_of_sale", feature: null },
      { label: "Orders", path: "/cafe/orders", icon: "assignment", feature: null },
      { label: "Bills", path: "/cafe/bills", icon: "receipt_long", feature: null },
    ],
  },
  {
    title: "Pinned",
    items: [
      { label: "KDS", path: "/cafe/kitchen", icon: "cooking", feature: null },
      { label: "Inventory / Menu", path: "/cafe/menu", icon: "restaurant_menu", feature: null },
    ],
  },
  {
    title: "More",
    items: [
      { label: "Customers", path: "/cafe/customers", icon: "person_search", feature: null },
      { label: "Loyalty", path: "/cafe/loyalty", icon: "loyalty", feature: "loyalty" },
      { label: "Coupons", path: "/cafe/coupons", icon: "local_offer", feature: "coupons" },
      { label: "Wallets", path: "/cafe/wallets", icon: "account_balance_wallet", feature: "wallet" },
      { label: "Scratch Cards", path: "/cafe/scratch", icon: "casino", feature: "scratch" },
      { label: "Sales History", path: "/cafe/sales", icon: "trending_up", feature: "analytics" },
      { label: "Shift & Drawer", path: "/cafe/shift", icon: "point_of_sale", feature: null },
      { label: "Analytics", path: "/cafe/analytics", icon: "analytics", feature: "analytics" },
      { label: "Reviews & AI", path: "/cafe/reviews", icon: "rate_review", feature: "reviews" },
      { label: "Fraud Watch", path: "/cafe/geofence", icon: "gps_fixed", feature: "geofence" },
      { label: "Tables & QR", path: "/cafe/tables", icon: "table_restaurant", feature: null },
      { label: "QR Codes", path: "/cafe/qr", icon: "qr_code_2", feature: null },
      { label: "NFC Tags", path: "/cafe/nfc", icon: "contactless", feature: "nfc" },
      { label: "Waiter Calls", path: "/cafe/requests", icon: "ring_volume", feature: null },
      { label: "Audit & Ledger", path: "/cafe/audit", icon: "history_edu", feature: "reports.export" },
      { label: "14-Day Pilot", path: "/cafe/pilot", icon: "flag", feature: null },
    ],
  },
];

const SETTINGS_ITEM: NavItem = { label: "Settings", path: "/cafe/settings", icon: "settings", feature: null };

export const AdminSidebar: React.FC<AdminSidebarProps> = ({ permissions, featureAccess }) => {
  const pathname = usePathname();
  const router = useRouter();

  // Sections/items are always rendered if the operator has the permission.
  // Plan entitlement no longer hides them: a starter / lapsed cafe still sees
  // the feature in the menu and is told to upgrade when they open it.
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessPath(item.path, permissions)),
  })).filter((section) => section.items.length > 0);

  const canSeeSettings = canAccessPath(SETTINGS_ITEM.path, permissions);
  const canSeeWaiterMode = canAccessPath("/staff/waiter", permissions);

  const blocked = BLOCKED_FEATURE_ROUTES[pathname];

  /**
   * Show the strict upgrade modal when the current route requires a feature the
   * cafe cannot use right now.
   *
   * - `featureAccess == null` ⇒ still loading / not authenticated yet; do not
   *   block navigation before we know the plan.
   * - Otherwise the route is blocked when its required feature is not in the
   *   cafe's currently allowed feature set.
   */
  const showUpgradeModal =
    blocked != null &&
    featureAccess != null &&
    !featureAccess.includes(blocked.feature);

  /** Whether `item` is shown as locked because the current plan lacks its feature. */
  const isItemLocked = (item: NavItem) =>
    item.feature != null && featureAccess != null && !featureAccess.includes(item.feature);

  const [upgradeModal, setUpgradeModal] = useState<{
    open: boolean;
    featureLabel: string;
  }>({ open: false, featureLabel: "this feature" });

  const openUpgradeModal = (feature: string, label: string) => {
    setUpgradeModal({ open: true, featureLabel: label });
  };

  const closeUpgradeModal = () => setUpgradeModal({ open: false, featureLabel: "this feature" });

  const handleUpgrade = () => {
    closeUpgradeModal();
    // Plan management lives in cafe settings. This used to push `/admin/billing`,
    // which is the QRDine super-admin console — a route a cafe operator cannot
    // open — so every "Upgrade plan" click landed on a dead end.
    router.push("/cafe/settings");
  };

  // Keep the sidebar upgrade modal in sync with the blocking route, so both paths
  // (sidebar locked item vs direct route access) use one consistent upgrade surface.
  useEffect(() => {
    if (showUpgradeModal) {
      setUpgradeModal({ open: true, featureLabel: blocked!.label });
    }
  }, [showUpgradeModal, blocked?.label]);

  return (
    <aside className="w-64 bg-surface-container-low border-r border-surface-container flex flex-col shrink-0 h-screen sticky top-0 font-inter overflow-x-hidden overflow-y-auto">
      {/* Title / Logo */}
      <div className="p-md border-b border-surface-container flex items-center gap-xs">
        <span className="material-symbols-outlined text-primary text-[28px]">
          restaurant
        </span>
        <span className="font-semibold text-body-lg text-primary">
          QR-Dine Executive Portal
        </span>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 p-sm flex flex-col gap-md overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-xs">
            <p className="px-md pt-xs text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
              {section.title}
            </p>
            {section.items.map((item) => (
              <NavLink
                key={item.path}
                item={item}
                active={pathname === item.path}
                locked={isItemLocked(item)}
                onUpgrade={() => openUpgradeModal(item.feature ?? "", item.label)}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Logout Footer */}
      <div className="p-md border-t border-surface-container flex flex-col gap-xs">
        <p className="px-md text-[11px] font-bold uppercase tracking-widest text-on-surface-variant/50">
          Account
        </p>

        {canSeeWaiterMode && (
          <a
            href="/staff/waiter"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px] select-none">restaurant</span>
            Waiter Mode
          </a>
        )}

        <Link href="/cafe/lock" passHref>
          <span className="w-full flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[20px] select-none">switch_account</span>
            Switch Operator
          </span>
        </Link>

        {canSeeSettings && (
          <NavLink
            item={SETTINGS_ITEM}
            active={pathname === SETTINGS_ITEM.path}
            locked={isItemLocked(SETTINGS_ITEM)}
            onUpgrade={() => openUpgradeModal(SETTINGS_ITEM.feature ?? "", SETTINGS_ITEM.label)}
          />
        )}

        <button
          onClick={() => logoutAdmin()}
          className="w-full flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold text-error hover:bg-error/10 transition-colors cursor-pointer text-left"
        >
          <span className="material-symbols-outlined text-[20px] select-none">
            logout
          </span>
          Logout
        </button>
      </div>

      <FeatureUpgradeModal
        open={upgradeModal.open}
        featureLabel={upgradeModal.featureLabel}
        onClose={closeUpgradeModal}
        onUpgrade={handleUpgrade}
      />
    </aside>
  );
};

const BLOCKED_FEATURE_ROUTES: Record<string, { label: string; feature: string }> = {
  "/cafe/loyalty": { label: "Loyalty", feature: "loyalty" },
  "/cafe/coupons": { label: "Coupons", feature: "coupons" },
  "/cafe/wallets": { label: "Wallets", feature: "wallet" },
  "/cafe/scratch": { label: "Scratch Cards", feature: "scratch" },
  "/cafe/sales": { label: "Sales History", feature: "analytics" },
  "/cafe/analytics": { label: "Analytics", feature: "analytics" },
  "/cafe/reviews": { label: "Reviews & AI", feature: "reviews" },
  "/cafe/geofence": { label: "Fraud Watch", feature: "geofence" },
  "/cafe/nfc": { label: "NFC Tags", feature: "nfc" },
  "/cafe/audit": { label: "Audit & Ledger", feature: "reports.export" },
};

interface FeatureUpgradeModalProps {
  open: boolean;
  featureLabel: string;
  onClose: () => void;
  onUpgrade: () => void;
}

const FeatureUpgradeModal: React.FC<FeatureUpgradeModalProps> = ({
  open,
  featureLabel,
  onClose,
  onUpgrade,
}) => {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[28rem] rounded-xl bg-surface-container border border-surface-strong shadow-[0px_20px_60px_rgba(0,0,0,0.45)] p-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-sm mb-md">
          <span className="material-symbols-outlined text-[28px] text-error">warning</span>
          <h2 className="font-semibold text-headline-md text-on-surface">
            This feature is not in your plan
          </h2>
        </div>

        <p className="text-body-md text-on-surface-variant mb-md">
          <span className="font-semibold text-on-surface">{featureLabel}</span> is not
          available on your current plan.
        </p>

        <p className="text-body-md text-on-surface-variant mb-lg">
          Please upgrade your plan to use {featureLabel.toLowerCase()} and the rest of
          QRDine&apos;s paid features.
        </p>

        <div className="flex gap-md flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className="flex-auto px-md py-sm rounded-lg border border-surface-strong text-body-md font-semibold text-on-surface-variant bg-surface-container-highest hover:bg-surface-container transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onUpgrade}
            className="flex-auto px-md py-sm rounded-lg bg-primary text-on-primary font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            Upgrade plan
          </button>
        </div>
      </div>
    </div>
  );
};

const NavLink: React.FC<{
  item: NavItem;
  active: boolean;
  locked: boolean;
  onUpgrade: () => void;
}> = ({ item, active, locked, onUpgrade }) => {
  const [hovered, setHovered] = useState(false);
  const [clicked, setClicked] = useState(false);

  if (locked) {
    return (
      <div
        className="relative"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setClicked((v) => !v)}
      >
        <Link href={item.path} passHref>
          <span
            className={`flex items-center gap-sm px-md py-sm rounded-lg cursor-pointer transition-colors duration-150 ${
              active
                ? "bg-[#51604f] text-on-primary shadow-[0px_4px_12px_rgba(81,96,79,0.15)]"
                : "bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[20px] select-none">
              {item.icon}
            </span>
            <span className="font-semibold">{item.label}</span>
            <span className="material-symbols-outlined text-[14px] shrink-0 text-[#5e5e5b]">
              lock
            </span>
          </span>
        </Link>

        {(hovered || clicked) && (
          <div
            className="absolute right-0 top-full mt-sm z-50 w-full max-w-[236px] rounded-xl border border-surface-strong bg-white shadow-[0px_12px_32px_rgba(0,0,0,0.35)] p-sm select-none"
          >
            <div className="flex items-start gap-sm">
              <span className="material-symbols-outlined text-base text-technical text-2xl text-[#444842]">
                lock
              </span>
              <div className="text-body-sm text-on-surface-variant">
                <div className="font-semibold text-on-surface">{item.label} isn&apos;t in your current plan</div>
                <p className="mt-xs text-on-surface-variant">
                  Upgrade the plan to unlock {item.label.toLowerCase()} for this café.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className="mt-md w-full rounded-lg bg-primary text-on-primary text-body-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer"
            >
              Upgrade plan
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Link href={item.path} passHref>
      <span
        className={`flex items-center gap-sm px-md py-sm rounded-lg text-body-md font-semibold cursor-pointer transition-colors duration-150 ${active
          ? "bg-primary text-on-primary shadow-[0px_4px_12px_rgba(81,96,79,0.15)]"
          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
        }`}
      >
        <span className="material-symbols-outlined text-[20px] select-none">
          {item.icon}
        </span>
        {item.label}
      </span>
    </Link>
  );
};

export default AdminSidebar;