"use client";

import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StaffUser } from "@/types";
import {
  getCafeProfile,
  updateCafeProfile,
  getStaffUsers,
  createStaffUser,
  deleteStaffUser,
  setStaffPin,
  removeStaffPin,
  updateStaffUser,
  getPGSettings,
  updatePGSettings,
  type PGSettings,
} from "@/actions/settings";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import {
  getMySubscription,
  getMyEntitlements,
  getSubscriptionPlans,
  startCheckout,
  cancelSubscription,
  resumeSubscription,
} from "@/actions/subscription";
import { UsageMeter } from "@/components/subscription/UsageMeter";
import type { UsageSummary } from "@/types";

type SettingsTab = "profile" | "staff" | "billing" | "pg";

// Module #08 — assignable roles and their badge styling
const ASSIGNABLE_ROLES = ["manager", "cashier", "waiter", "barista", "staff"] as const;

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  owner: { label: "Owner", className: "bg-info-container text-info" },
  manager: { label: "Manager", className: "bg-warning-container text-warning" },
  cashier: { label: "Cashier", className: "bg-success-container text-success" },
  waiter: { label: "Waiter", className: "bg-accent-violet-container text-on-accent-violet-container" },
  barista: { label: "Barista", className: "bg-accent-cyan-container text-on-accent-cyan-container" },
  staff: { label: "Staff", className: "bg-surface-container text-on-surface-variant" },
};

const ROLE_HINTS: Record<string, string> = {
  manager: "Full operations access: menu, tables, staff, orders, and reports.",
  cashier: "Counter POS access, including opening the cash drawer.",
  waiter: "Table-side ordering and table management.",
  barista: "Kitchen Display (KDS) access and order status updates.",
  staff: "Basic order viewing and KDS access.",
};

export const SettingsClient: React.FC = () => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  // ─── Cafe Profile State ────────────────────────────────
  const [isLoadingCafe, setIsLoadingCafe] = useState(true);
  const [profileForm, setProfileForm] = useState({
    name: "",
    legalName: "",
    tradeName: "",
    gstin: "",
    fssaiNumber: "",
    taxMode: "composite_5" as "composite_5" | "regular_18" | "exempt",
    address: "",
    phone: "",
    email: "",
    logo: "",
    isOrderingPaused: false,
    orderingPausedReason: "",
    operatingHours: {
      enabled: false,
      openTime: "00:00",
      closeTime: "23:59",
      days: [0, 1, 2, 3, 4, 5, 6],
    },
  });
  const [profileMessage, setProfileMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ─── Staff State ───────────────────────────────────────
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "staff",
  });
  const [staffError, setStaffError] = useState("");

  // Module #08 — PIN management
  const [pinModalUser, setPinModalUser] = useState<StaffUser | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");

  // ─── Billing State ─────────────────────────────────────
  const [subscription, setSubscription] = useState<any>(null);
  const [plans, setPlans] = useState<Record<string, any>>({});
  // Metered allowances (orders this month, outlets). Server-resolved: the meter
  // cannot be moved by editing the page, it only reports what the backend will
  // actually allow.
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [isLoadingBilling, setIsLoadingBilling] = useState(true);
  const [billingMessage, setBillingMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // ─── Payment Gateway (BYO-PG) State ────────────────────
  const [pgSettings, setPgSettings] = useState<PGSettings | null>(null);
  const [isLoadingPG, setIsLoadingPG] = useState(false);
  const [pgUpgradeRequired, setPgUpgradeRequired] = useState(false);
  const [pgForm, setPgForm] = useState({
    enabled: false,
    provider: "razorpay" as "razorpay" | "cashfree" | "paytm" | "stripe",
    keyId: "",
    keySecret: "",
    webhookSecret: "",
  });
  const [pgMessage, setPgMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const loadPGSettings = async () => {
    setIsLoadingPG(true);
    setPgMessage(null);
    try {
      const res = await getPGSettings();
      if (res.success && res.settings) {
        setPgSettings(res.settings);
        setPgUpgradeRequired(false);
        setPgForm({
          enabled: Boolean(res.settings.enabled),
          provider: res.settings.provider || "razorpay",
          keyId: res.settings.keyId || "",
          keySecret: "",
          webhookSecret: "",
        });
      }
    } catch (err: unknown) {
      const msg = thrownMessage(err, "Failed to load payment gateway settings.");
      if (msg.includes("Upgrade") || msg.includes("Growth or Pro")) {
        setPgUpgradeRequired(true);
      } else {
        setPgMessage({ type: "error", text: msg });
      }
    } finally {
      setIsLoadingPG(false);
    }
  };

  // ─── Loaders ───────────────────────────────────────────
  const loadCafeProfile = async () => {
    try {
      const result = await getCafeProfile();
      if (result.success && result.cafe) {
        return {
          name: result.cafe.name || "",
          legalName: result.cafe.legalName || "",
          tradeName: result.cafe.tradeName || "",
          gstin: result.cafe.gstin || "",
          fssaiNumber: result.cafe.fssaiNumber || "",
          taxMode: (result.cafe.taxMode as "composite_5" | "regular_18" | "exempt") || "composite_5",
          address: result.cafe.address || "",
          phone: result.cafe.phone || "",
          email: result.cafe.email || "",
          logo: result.cafe.logo || "",
          isOrderingPaused: Boolean(result.cafe.isOrderingPaused),
          orderingPausedReason: result.cafe.orderingPausedReason || "",
          operatingHours: {
            enabled: Boolean(result.cafe.operatingHours?.enabled),
            openTime: result.cafe.operatingHours?.openTime || "00:00",
            closeTime: result.cafe.operatingHours?.closeTime || "23:59",
            days: result.cafe.operatingHours?.days || [0, 1, 2, 3, 4, 5, 6],
          },
        };
      }
      return null;
    } catch (err: unknown) {
      setProfileMessage({ type: "error", text: thrownMessage(err, "Failed to load cafe profile.") });
      return null;
    }
  };

  const loadStaffUsers = async () => {
    try {
      const result = await getStaffUsers();
      return result.success ? result.users : null;
    } catch (err) {
      console.error("Failed to load staff users:", err);
      return null;
    }
  };

  const loadBilling = async () => {
    try {
      const [subRes, plansRes, entRes] = await Promise.all([
        getMySubscription(),
        getSubscriptionPlans(),
        getMyEntitlements(),
      ]);
      return {
        subscription: subRes.success ? subRes : null,
        plans: plansRes.success ? plansRes.plans : {},
        usage: entRes.success ? entRes.usage ?? [] : [],
      };
    } catch (err) {
      console.error("Failed to load billing:", err);
      return null;
    }
  };

  /** Re-read metered usage after a plan change so the meters do not go stale. */
  const refreshUsage = async () => {
    try {
      const res = await getMyEntitlements();
      if (res.success) setUsage(res.usage ?? []);
    } catch (err) {
      console.error("Failed to refresh usage:", err);
    }
  };

  // ─── Load Data ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [cafe, staff, billing] = await Promise.all([loadCafeProfile(), loadStaffUsers(), loadBilling()]);
      if (cancelled) return;
      if (cafe) setProfileForm(cafe);
      if (staff) setStaffUsers(staff);
      if (billing) {
        setSubscription(billing.subscription);        setPlans(billing.plans);
        setUsage(billing.usage);
      }
      setIsLoadingCafe(false);
      setIsLoadingStaff(false);
      setIsLoadingBilling(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Profile Handlers ──────────────────────────────────
  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMessage(null);

    startTransition(async () => {
      try {
        const result = await updateCafeProfile(profileForm);
        if (result.success) {
          setProfileMessage({ type: "success", text: "Profile updated successfully." });
          setTimeout(() => setProfileMessage(null), 3000);
          router.refresh();
        }
      } catch (err: unknown) {
        setProfileMessage({ type: "error", text: thrownMessage(err, "Failed to update profile.") });
      }
    });
  };

  // ─── Staff Handlers ────────────────────────────────────
  const handleCreateStaff = (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError("");

    if (!staffForm.name.trim() || !staffForm.email.trim() || !staffForm.password) {
      setStaffError("All fields are required.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await createStaffUser(staffForm);
        if (result.success) {
          setStaffUsers((prev) => [...prev, result.user]);
          setIsAddModalOpen(false);
          setStaffForm({ name: "", email: "", password: "", role: "staff" });
          router.refresh();
        }
      } catch (err: unknown) {
        setStaffError(thrownMessage(err, "Failed to create staff user."));
      }
    });
  };

  const handleDeleteStaff = (user: StaffUser) => {
    if (!confirm(`Are you sure you want to remove ${user.name} (${user.email})? This action cannot be undone.`)) return;

    startTransition(async () => {
      try {
        await deleteStaffUser(user.id);
        setStaffUsers((prev) => prev.filter((u) => u.id !== user.id));
        router.refresh();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to delete staff user."));
      }
    });
  };

  // ─── Module #08 — PIN & status handlers ────────────────
  const handleSetPin = (e: React.FormEvent) => {
    e.preventDefault();
    setPinError("");
    if (!pinModalUser) return;
    if (!/^\d{4,6}$/.test(pinValue)) {
      setPinError("PIN must be 4 to 6 digits.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await setStaffPin(pinModalUser.id, pinValue);
        if (result.success) {
          setStaffUsers((prev) => prev.map((u) => (u.id === result.user.id ? result.user : u)));
          setPinModalUser(null);
          setPinValue("");
          router.refresh();
        }
      } catch (err: unknown) {
        setPinError(thrownMessage(err, "Failed to set PIN."));
      }
    });
  };

  const handleRemovePin = (user: StaffUser) => {
    if (!confirm(`Remove ${user.name}'s PIN? They will no longer be able to log in with a PIN.`)) return;
    startTransition(async () => {
      try {
        const result = await removeStaffPin(user.id);
        setStaffUsers((prev) => prev.map((u) => (u.id === result.user.id ? result.user : u)));
        router.refresh();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to remove PIN."));
      }
    });
  };

  const handleToggleActive = (user: StaffUser) => {
    startTransition(async () => {
      try {
        const result = await updateStaffUser(user.id, { isActive: !user.isActive });
        setStaffUsers((prev) => prev.map((u) => (u.id === result.user.id ? result.user : u)));
        router.refresh();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to update status."));
      }
    });
  };

  // ─── Billing Handlers ──────────────────────────────────
  const handleUpgrade = (planKey: string) => {
    if (!confirm(`Are you sure you want to subscribe to ${plans[planKey]?.name || planKey}?`)) return;
    startTransition(async () => {
      try {
        const result = await startCheckout(planKey, "monthly", 1);
        if (result.success) {
          setBillingMessage({ type: "success", text: result.message });
          const subRes = await getMySubscription();
          if (subRes.success) setSubscription(subRes);
          // A plan change moves the allowance, so the meter must be re-read.
          await refreshUsage();
        } else {
          setBillingMessage({ type: "error", text: result.message });
        }
      } catch (err: unknown) {
        setBillingMessage({ type: "error", text: thrownMessage(err, "Failed to upgrade.") });
      }
    });
  };

  const handleCancel = () => {
    if (!confirm("Are you sure you want to cancel your subscription? You will lose premium features at the end of your billing cycle.")) return;
    startTransition(async () => {
      try {
        const result = await cancelSubscription("User requested cancellation via Dashboard");
        if (result.success) {
          setBillingMessage({ type: "success", text: result.message });
          const subRes = await getMySubscription();
          if (subRes.success) setSubscription(subRes);
          await refreshUsage();
        } else {
          setBillingMessage({ type: "error", text: result.message });
        }
      } catch (err: unknown) {
        setBillingMessage({ type: "error", text: thrownMessage(err, "Failed to cancel.") });
      }
    });
  };

  const handleResume = () => {
    startTransition(async () => {
      try {
        const result = await resumeSubscription();
        if (result.success) {
          setBillingMessage({ type: "success", text: result.message });
          const subRes = await getMySubscription();
          if (subRes.success) setSubscription(subRes);
          await refreshUsage();
        } else {
          setBillingMessage({ type: "error", text: result.message });
        }
      } catch (err: unknown) {
        setBillingMessage({ type: "error", text: thrownMessage(err, "Failed to resume.") });
      }
    });
  };

  // ─── Payment Gateway Handlers ──────────────────────────
  const handlePGSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPgMessage(null);
    startTransition(async () => {
      try {
        const result = await updatePGSettings({
          enabled: pgForm.enabled,
          provider: pgForm.provider,
          keyId: pgForm.keyId,
          keySecret: pgForm.keySecret || undefined,
          webhookSecret: pgForm.webhookSecret || undefined,
        });
        if (result.success) {
          setPgSettings(result.settings);
          setPgMessage({ type: "success", text: result.message || "Payment gateway settings saved successfully." });
          setPgForm((prev) => ({
            ...prev,
            keySecret: "",
            webhookSecret: "",
          }));
          setTimeout(() => setPgMessage(null), 4000);
        }
      } catch (err: unknown) {
        setPgMessage({ type: "error", text: thrownMessage(err, "Failed to update payment gateway.") });
      }
    });
  };

  useEffect(() => {
    if (activeTab === "pg" && !pgSettings && !pgUpgradeRequired) {
      void loadPGSettings();
    }
  }, [activeTab, pgSettings, pgUpgradeRequired]);

  // ─── Tabs ──────────────────────────────────────────────
  const tabs = [
    { id: "profile" as SettingsTab, label: "Cafe Profile", icon: "store" },
    { id: "staff" as SettingsTab, label: "Staff Management", icon: "group" },
    { id: "billing" as SettingsTab, label: "Billing & Subscriptions", icon: "credit_card" },
    { id: "pg" as SettingsTab, label: "Direct PG (BYO)", icon: "payments" },
  ];

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Settings" iconName="settings" />

      <main className="flex-1 p-md lg:p-lg max-w-[900px] w-full mx-auto">
        {/* Tab Navigation */}
        <div className="flex gap-xs mb-lg border-b border-surface-container pb-xs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-xs px-md py-sm rounded-t-lg text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-all duration-200 relative ${
                activeTab === tab.id
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{tab.icon}</span>
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* ─── TAB: Cafe Profile ─────────────────────────────── */}
        {activeTab === "profile" && (
          <div>
            {isLoadingCafe ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleProfileSubmit} className="flex flex-col gap-md">
                {/* Name */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm pb-sm border-b border-surface-container">
                    Café Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Café Name</label>
                      <input
                        type="text"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Brew & Brew"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Email</label>
                      <input
                        type="email"
                        value={profileForm.email}
                        onChange={(e) => setProfileForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="cafe@example.com"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Phone</label>
                      <input
                        type="tel"
                        value={profileForm.phone}
                        onChange={(e) => setProfileForm((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+91 98765 43210"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Logo URL</label>
                      <input
                        type="url"
                        value={profileForm.logo}
                        onChange={(e) => setProfileForm((p) => ({ ...p, logo: e.target.value }))}
                        placeholder="https://example.com/logo.png"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Address */}
                  <div className="flex flex-col gap-xs mt-md">
                    <label className="font-inter font-semibold text-label-md text-on-surface">Address</label>
                    <textarea
                      value={profileForm.address}
                      onChange={(e) => setProfileForm((p) => ({ ...p, address: e.target.value }))}
                      rows={2}
                      placeholder="123 Main Street, City, State"
                      className="w-full bg-surface-container-low rounded-xl px-md py-sm font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none resize-none transition-all"
                    />
                  </div>
                </div>

                {/* Task 4.1 / Form A — Indian Statutory & Tax Compliance Card */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm pb-sm border-b border-surface-container flex items-center justify-between">
                    <span>Statutory & Tax Compliance (Form A)</span>
                    <span className="material-symbols-outlined text-[20px] text-primary">verified_user</span>
                  </h3>
                  <div className="bg-primary-container/10 border border-primary/20 rounded-xl p-sm mb-md flex gap-sm items-start">
                    <span className="material-symbols-outlined text-primary text-xl mt-0.5">info</span>
                    <p className="text-body-sm text-on-surface-variant leading-relaxed">
                      Statutory business identifiers required under <strong>CGST Act Section 31</strong> and <strong>FSSAI Food Safety Regulations</strong>. These are embedded on customer digital tax invoices and QR ordering receipts.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Legal Entity Name</label>
                      <input
                        type="text"
                        value={profileForm.legalName}
                        onChange={(e) => setProfileForm((p) => ({ ...p, legalName: e.target.value }))}
                        placeholder="e.g. Spice House Private Limited"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Trade / Brand Name</label>
                      <input
                        type="text"
                        value={profileForm.tradeName}
                        onChange={(e) => setProfileForm((p) => ({ ...p, tradeName: e.target.value }))}
                        placeholder="e.g. Spice House"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">GSTIN (15 Characters)</label>
                      <input
                        type="text"
                        maxLength={15}
                        value={profileForm.gstin}
                        onChange={(e) => setProfileForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                        placeholder="07AAAAA0000A1Z5"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface font-mono placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">FSSAI License (14 Digits)</label>
                      <input
                        type="text"
                        maxLength={14}
                        value={profileForm.fssaiNumber}
                        onChange={(e) => setProfileForm((p) => ({ ...p, fssaiNumber: e.target.value }))}
                        placeholder="10019011000123"
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface font-mono placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-xs md:col-span-2">
                      <label className="font-inter font-semibold text-label-md text-on-surface">Tax Scheme Mode</label>
                      <select
                        value={profileForm.taxMode}
                        onChange={(e) =>
                          setProfileForm((p) => ({
                            ...p,
                            taxMode: e.target.value as "composite_5" | "regular_18" | "exempt",
                          }))
                        }
                        className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all cursor-pointer"
                      >
                        <option value="composite_5">5% Composition Scheme (Section 10 CGST Act - No ITC)</option>
                        <option value="regular_18">18% Regular GST (9% CGST + 9% SGST with ITC)</option>
                        <option value="exempt">Tax Exempt / Non-GST Entity</option>
                      </select>
                    </div>
                  </div>

                  {/* Stage 5 / Task 5.1 & 5.3 — Legal & Intermediary Safe Harbor Agreement Status */}
                  <div className="mt-md pt-sm border-t border-surface-container flex flex-col sm:flex-row items-start sm:items-center justify-between gap-sm text-xs text-on-surface-variant">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-emerald-600">gavel</span>
                      <span>
                        Governed by <strong>Master SaaS Agreement</strong> & <strong>DPDP Data Processing Addendum (2026.1)</strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <a
                        href="/legal/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        View Terms & Safe Harbor ↗
                      </a>
                      <span className="text-outline/40">•</span>
                      <a
                        href="/legal/dpa"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline font-medium"
                      >
                        View DPA ↗
                      </a>
                    </div>
                  </div>
                </div>

                {/* Readiness Gate 1 / CUS-015 — Operational Ordering Control & Operating Hours */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm pb-sm border-b border-surface-container flex items-center justify-between">
                    <span>Operational Controls & Kitchen Capacity</span>
                    <span className="material-symbols-outlined text-[20px] text-primary">storefront</span>
                  </h3>

                  {/* Pause QR Ordering Toggle */}
                  <div className="flex items-center justify-between py-sm border-b border-surface-container">
                    <div>
                      <p className="font-semibold text-body-md text-on-surface">Pause QR Ordering</p>
                      <p className="text-body-sm text-on-surface-variant">
                        Temporarily halt incoming orders from customer phones when the kitchen is overloaded.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profileForm.isOrderingPaused}
                        onChange={(e) => setProfileForm((p) => ({ ...p, isOrderingPaused: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
                    </label>
                  </div>

                  {profileForm.isOrderingPaused && (
                    <div className="flex flex-col gap-xs mt-sm py-xs">
                      <label className="font-inter font-semibold text-label-md text-on-surface">
                        Reason for Pausing (shown to customers)
                      </label>
                      <input
                        type="text"
                        value={profileForm.orderingPausedReason}
                        onChange={(e) => setProfileForm((p) => ({ ...p, orderingPausedReason: e.target.value }))}
                        placeholder="e.g. Kitchen is at maximum capacity. Orders will resume in 20 minutes."
                        className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
                      />
                    </div>
                  )}

                  {/* Operating Hours Toggle */}
                  <div className="flex items-center justify-between py-sm border-b border-surface-container mt-sm">
                    <div>
                      <p className="font-semibold text-body-md text-on-surface">Operating Hours Gate</p>
                      <p className="text-body-sm text-on-surface-variant">
                        Block orders placed outside outlet operating hours.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={profileForm.operatingHours?.enabled || false}
                        onChange={(e) =>
                          setProfileForm((p) => ({
                            ...p,
                            operatingHours: {
                              ...p.operatingHours,
                              enabled: e.target.checked,
                            },
                          }))
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>

                  {profileForm.operatingHours?.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-md mt-sm">
                      <div className="flex flex-col gap-xs">
                        <label className="font-inter font-semibold text-label-md text-on-surface">Opening Time (24h)</label>
                        <input
                          type="time"
                          value={profileForm.operatingHours.openTime || "00:00"}
                          onChange={(e) =>
                            setProfileForm((p) => ({
                              ...p,
                              operatingHours: { ...p.operatingHours, openTime: e.target.value },
                            }))
                          }
                          className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
                        />
                      </div>
                      <div className="flex flex-col gap-xs">
                        <label className="font-inter font-semibold text-label-md text-on-surface">Closing Time (24h)</label>
                        <input
                          type="time"
                          value={profileForm.operatingHours.closeTime || "23:59"}
                          onChange={(e) =>
                            setProfileForm((p) => ({
                              ...p,
                              operatingHours: { ...p.operatingHours, closeTime: e.target.value },
                            }))
                          }
                          className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Message feedback */}
                {profileMessage && (
                  <div
                    className={`px-md py-sm rounded-lg text-body-sm font-inter font-semibold flex items-center gap-xs ${
                      profileMessage.type === "success"
                        ? "bg-success-container text-success"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {profileMessage.type === "success" ? "check_circle" : "error"}
                    </span>
                    {profileMessage.text}
                  </div>
                )}

                {/* Action */}
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={isPending} className="h-10 px-lg">
                    {isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ─── TAB: Staff Management ─────────────────────────── */}
        {activeTab === "staff" && (
          <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-md">
              <div>
                <h3 className="font-inter font-semibold text-body-lg text-on-surface">
                  Staff Members
                </h3>
                <p className="font-inter text-body-sm text-on-surface-variant">
                  Manage who has access to the admin dashboard.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  setStaffForm({ name: "", email: "", password: "", role: "staff" });
                  setStaffError("");
                  setIsAddModalOpen(true);
                }}
                className="h-10 px-md"
              >
                <span className="material-symbols-outlined text-[18px]">person_add</span>
                Add Staff
              </Button>
            </div>

            {/* Staff List */}
            {isLoadingStaff ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : staffUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-xl text-center">
                <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
                  group
                </span>
                <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
                  No Staff Members
                </h3>
                <p className="font-inter text-body-sm text-on-surface-variant">
                  Add staff members to give them access to the admin dashboard.
                </p>
              </div>
            ) : (
              <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
                {/* Header row */}
                <div className="hidden md:grid grid-cols-[2fr_2fr_1fr_1fr_0.5fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Name</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Email</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Role</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Added</span>
                  <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Actions</span>
                </div>

                {staffUsers.map((user) => (
                  <div
                    key={user.id}
                    className="grid grid-cols-1 md:grid-cols-[2fr_2fr_1fr_1fr_0.5fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
                  >
                    <div className="flex items-center gap-sm">
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <span className="font-inter font-bold text-label-sm text-primary">
                          {user.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-inter text-body-sm text-on-surface truncate">{user.name}</p>
                      </div>
                    </div>
                    <span className="font-inter text-body-sm text-on-surface truncate">{user.email}</span>
                    <span className="flex items-center gap-xs">
                      <span
                        className={`inline-flex items-center px-sm py-0.5 rounded-full text-label-sm font-inter font-semibold ${
                          (ROLE_BADGE[user.role] || ROLE_BADGE.staff).className
                        }`}
                      >
                        {(ROLE_BADGE[user.role] || ROLE_BADGE.staff).label}
                      </span>
                      {!user.isActive && (
                        <span className="font-inter text-label-sm text-error">Inactive</span>
                      )}
                    </span>
                    <span className="font-inter text-body-sm text-on-surface-variant">
                      {new Date(user.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                    </span>
                    <div className="flex justify-end gap-xs">
                      {/* PIN set / clear (Module #08) */}
                      {user.pinEnabled ? (
                        <button
                          onClick={() => handleRemovePin(user)}
                          disabled={isPending}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-40"
                          title={`Remove ${user.name}'s PIN`}
                        >
                          <span className="material-symbols-outlined text-[18px]">key_off</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setPinModalUser(user);
                            setPinValue("");
                            setPinError("");
                          }}
                          disabled={isPending}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer disabled:opacity-40"
                          title={`Set PIN for ${user.name}`}
                        >
                          <span className="material-symbols-outlined text-[18px]">pin</span>
                        </button>
                      )}

                      {user.role !== "owner" && (
                        <>
                          <button
                            onClick={() => handleToggleActive(user)}
                            disabled={isPending}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer disabled:opacity-40"
                            title={user.isActive ? `Deactivate ${user.name}` : `Activate ${user.name}`}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {user.isActive ? "toggle_on" : "toggle_off"}
                            </span>
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(user)}
                            disabled={isPending}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer disabled:opacity-40"
                            title={`Remove ${user.name}`}
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: Billing & Subscriptions ─────────────────── */}
        {activeTab === "billing" && (
          <div>
            {isLoadingBilling ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col gap-md">
                {billingMessage && (
                  <div
                    className={`px-md py-sm rounded-lg text-body-sm font-inter font-semibold flex items-center gap-xs ${
                      billingMessage.type === "success"
                        ? "bg-success-container text-success"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {billingMessage.type === "success" ? "check_circle" : "error"}
                    </span>
                    {billingMessage.text}
                  </div>
                )}

                {/* Current Plan Overview */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container shadow-sm">
                  <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm pb-sm border-b border-surface-container">
                    Current Subscription
                  </h3>
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-md">
                    <div>
                      {(() => {
                        const s = subscription?.subscription;
                        if (!s) return null;
                        const status = s.status || "unknown";
                        const planKey = s.planKey || "unknown";
                        const planName = status === "trialing"
                          ? "Free Trial"
                          : plans[planKey]?.name
                            || plans[Object.keys(plans).find(k => k.toLowerCase() === String(planKey).toLowerCase()) || "unknown"]?.name
                            || planKey;
                        return (
                          <p className="font-inter text-body-lg font-bold text-on-surface flex items-center gap-2 capitalize">
                            {planName} Plan
                            <span className={`text-xs px-2 py-1 rounded-full text-white font-semibold ${
                              status === "active" ? "bg-success" :
                              status === "trialing" ? "bg-blue-500" :
                              status === "cancelled" ? "bg-warning" : "bg-error"
                            }`}>
                              {status}
                            </span>
                          </p>
                        );
                      })()}
                      <div className="flex flex-col gap-1 mt-1">
                        {subscription?.subscription ? (
                          <>
                            <p className="font-inter text-label-sm text-on-surface-variant">
                              Purchased on: {new Date(subscription.subscription.lastChargedAt).toLocaleDateString()}
                            </p>
                            <p className="font-inter text-label-sm font-semibold text-on-surface mt-1">
                              Next billing: {new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString()}
                              {subscription?.access?.graceDaysRemaining > 0 ? ` (${subscription.access.graceDaysRemaining} grace days)` : " (active)"}
                            </p>
                          </>
                        ) : (
                          <p className="font-inter text-label-sm text-on-surface-variant mt-1">
                            {subscription?.subscription?.status === "trialing"
                              ? "Trial period — no paid subscription yet"
                              : subscription?.subscription?.status === "cancelled" && subscription?.subscription?.cancelAtPeriodEnd
                                ? `Auto-cancels on ${subscription?.subscription?.currentPeriodEnd ? new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString() : 'N/A'}`
                                : "No active paid period"}
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      {subscription?.subscription?.status === "active" && subscription?.subscription?.cancelAtPeriodEnd === false && (
                        <Button variant="danger" onClick={handleCancel} disabled={isPending}>
                          Cancel Subscription
                        </Button>
                      )}
                      {subscription?.subscription?.cancelAtPeriodEnd && (
                        <Button variant="primary" onClick={handleResume} disabled={isPending}>
                          Resume Subscription
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Metered allowances */}
                {usage.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                    {usage.map((meter) => (
                      <UsageMeter key={meter.metric} usage={meter} />
                    ))}
                  </div>
                )}

                {/* Available Plans */}
                <h3 className="font-inter font-semibold text-body-lg text-on-surface mt-4 mb-2">
                  Available Plans
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                  {Array.isArray(plans) && plans.map((plan: any) => {
                    const s = subscription?.subscription;
                    const isCurrentPlan = s?.planKey === plan.key && s?.status === "active";
                    
                    return (
                      <div key={plan.key} className={`rounded-xl p-md border ${isCurrentPlan ? "border-primary bg-primary/5" : "border-surface-container bg-surface-container-lowest"} flex flex-col`}>
                        <div className="mb-4">
                          <h4 className="font-inter font-bold text-title-md text-on-surface">{plan.name}</h4>
                          <p className="font-inter text-body-sm text-on-surface-variant mt-1">{plan.blurb}</p>
                        </div>
                        <div className="mb-6">
                          <span className="font-inter font-bold text-2xl text-on-surface">₹{plan.monthly?.rupees || 0}</span>
                          <span className="font-inter text-body-sm text-on-surface-variant"> / month</span>
                        </div>
                        
                        <div className="flex-1 mb-6">
                          <p className="font-inter text-label-sm font-semibold text-on-surface mb-2 uppercase tracking-wider">Features included:</p>
                          <ul className="space-y-2">
                            {plan.features?.map((feature: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 font-inter text-body-sm text-on-surface-variant">
                                <span className="material-symbols-outlined text-[16px] text-primary">check_circle</span>
                                <span>{feature}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        
                        <Button 
                          variant={isCurrentPlan ? "outline" : "primary"}
                          onClick={() => handleUpgrade(plan.key)}
                          disabled={isPending || isCurrentPlan}
                          className="w-full justify-center"
                        >
                          {isCurrentPlan ? "Current Plan" : "Upgrade"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── TAB: Direct Merchant Payment Gateway (BYO-PG) ─── */}
        {activeTab === "pg" && (
          <div className="flex flex-col gap-md">
            {/* Legal & Intermediary Architecture Notice */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-md flex items-start gap-md">
              <span className="material-symbols-outlined text-[24px] text-primary shrink-0 mt-0.5">
                account_balance
              </span>
              <div>
                <h4 className="font-inter font-bold text-title-sm text-on-surface">
                  RBI Intermediary Settlement Model (BYO-PG)
                </h4>
                <p className="font-inter text-body-sm text-on-surface-variant mt-1 leading-relaxed">
                  QRDine acts strictly as a technology intermediary under Reserve Bank of India (RBI) guidelines. Customer online payments flow directly from diner UPI/cards into your own merchant gateway account and are settled directly to your bank account. QRDine holds zero customer funds and charges 0% commission on transactions.
                </p>
              </div>
            </div>

            {isLoadingPG ? (
              <div className="flex items-center justify-center py-xl">
                <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : pgUpgradeRequired ? (
              <div className="bg-surface-container-lowest rounded-xl p-lg border border-surface-container text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 flex items-center justify-center mb-sm">
                  <span className="material-symbols-outlined text-[24px]">lock</span>
                </div>
                <h3 className="font-inter font-bold text-title-md text-on-surface">
                  Direct Payment Gateway Requires Growth or Pro Plan
                </h3>
                <p className="font-inter text-body-sm text-on-surface-variant mt-1 max-w-[28rem]">
                  Connecting your own Razorpay, Cashfree, or Paytm merchant credentials to receive 100% direct settlements is available on Growth and Pro plans.
                </p>
                <Button
                  variant="primary"
                  className="mt-md"
                  onClick={() => setActiveTab("billing")}
                >
                  View Subscription Plans
                </Button>
              </div>
            ) : (
              <form onSubmit={handlePGSubmit} className="flex flex-col gap-md">
                {pgMessage && (
                  <div
                    className={`rounded-xl px-md py-sm flex items-center gap-xs font-inter text-body-sm font-semibold ${
                      pgMessage.type === "success"
                        ? "bg-success-container text-on-success-container"
                        : "bg-error-container text-on-error-container"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {pgMessage.type === "success" ? "check_circle" : "error"}
                    </span>
                    {pgMessage.text}
                  </div>
                )}

                {/* Enable Gateway Toggle */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-inter font-bold text-title-sm text-on-surface">
                        Accept Online Payments at Table
                      </h3>
                      <p className="font-inter text-body-sm text-on-surface-variant mt-0.5">
                        Allow customers to settle bills directly from their phone using UPI, Cards, and Netbanking.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pgForm.enabled}
                        onChange={(e) => setPgForm((p) => ({ ...p, enabled: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface-container-high peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
                    </label>
                  </div>
                </div>

                {/* Gateway Credentials */}
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container flex flex-col gap-md">
                  <div className="flex items-center justify-between pb-sm border-b border-surface-container">
                    <div>
                      <h3 className="font-inter font-bold text-title-sm text-on-surface">
                        Gateway Configuration
                      </h3>
                      <p className="font-inter text-body-xs text-on-surface-variant mt-0.5">
                        API credentials are encrypted with AES-256-GCM before database storage.
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">lock</span>
                      AES-256 Encrypted
                    </span>
                  </div>

                  {/* Provider */}
                  <div className="flex flex-col gap-xs">
                    <label className="font-inter font-semibold text-label-md text-on-surface">
                      Payment Gateway Provider
                    </label>
                    <select
                      value={pgForm.provider}
                      onChange={(e) => setPgForm((p) => ({ ...p, provider: e.target.value as any }))}
                      className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all cursor-pointer"
                    >
                      <option value="razorpay">Razorpay (UPI, Credit/Debit, Netbanking)</option>
                      <option value="cashfree">Cashfree Payments (UPI, Cards, Wallets)</option>
                      <option value="paytm">Paytm Merchant Gateway</option>
                      <option value="stripe">Stripe</option>
                    </select>
                  </div>

                  {/* Key ID */}
                  <div className="flex flex-col gap-xs">
                    <label className="font-inter font-semibold text-label-md text-on-surface">
                      Merchant Key ID / API Key
                    </label>
                    <input
                      type="text"
                      value={pgForm.keyId}
                      onChange={(e) => setPgForm((p) => ({ ...p, keyId: e.target.value }))}
                      placeholder={pgForm.provider === "razorpay" ? "rzp_live_xxxxxxxxxxxxxx" : "Enter Merchant Key ID"}
                      className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all font-mono text-sm"
                    />
                  </div>

                  {/* Key Secret */}
                  <div className="flex flex-col gap-xs">
                    <div className="flex items-center justify-between">
                      <label className="font-inter font-semibold text-label-md text-on-surface">
                        Key Secret
                      </label>
                      {pgSettings?.hasKeySecret && (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">check</span> Secret Stored
                        </span>
                      )}
                    </div>
                    <input
                      type="password"
                      value={pgForm.keySecret}
                      onChange={(e) => setPgForm((p) => ({ ...p, keySecret: e.target.value }))}
                      placeholder={pgSettings?.hasKeySecret ? "•••••••••••••••• (leave blank to keep unchanged)" : "Enter Merchant Key Secret"}
                      className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all font-mono text-sm"
                    />
                  </div>

                  {/* Webhook Secret */}
                  <div className="flex flex-col gap-xs">
                    <div className="flex items-center justify-between">
                      <label className="font-inter font-semibold text-label-md text-on-surface">
                        Webhook Signing Secret
                      </label>
                      {pgSettings?.hasWebhookSecret && (
                        <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">check</span> Secret Stored
                        </span>
                      )}
                    </div>
                    <input
                      type="password"
                      value={pgForm.webhookSecret}
                      onChange={(e) => setPgForm((p) => ({ ...p, webhookSecret: e.target.value }))}
                      placeholder={pgSettings?.hasWebhookSecret ? "•••••••••••••••• (leave blank to keep unchanged)" : "Enter Webhook Secret"}
                      className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all font-mono text-sm"
                    />
                    <p className="font-inter text-label-xs text-on-surface-variant">
                      Used to cryptographically verify HMAC-SHA256 signatures for payment settlement webhooks.
                    </p>
                  </div>

                  {/* Webhook URL for Gateway Dashboard */}
                  {pgSettings?.webhookUrl && (
                    <div className="flex flex-col gap-xs mt-xs pt-sm border-t border-surface-container">
                      <label className="font-inter font-semibold text-label-md text-on-surface flex items-center justify-between">
                        <span>Webhook Endpoint URL</span>
                        <span className="text-xs text-on-surface-variant font-normal">Copy to your {pgForm.provider} Dashboard</span>
                      </label>
                      <div className="flex items-center gap-sm">
                        <input
                          readOnly
                          type="text"
                          value={pgSettings.webhookUrl}
                          className="w-full h-11 bg-surface-container-low rounded-xl px-md font-mono text-xs text-on-surface border-none outline-none select-all"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(pgSettings.webhookUrl || "");
                            setCopiedWebhook(true);
                            setTimeout(() => setCopiedWebhook(false), 2000);
                          }}
                          className="h-11 px-md rounded-xl bg-surface-container hover:bg-surface-container-high active:scale-95 text-on-surface font-semibold text-xs transition-all flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {copiedWebhook ? "check" : "content_copy"}
                          </span>
                          {copiedWebhook ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end pt-sm border-t border-surface-container">
                    <Button type="submit" variant="primary" disabled={isPending}>
                      {isPending ? "Saving..." : "Save Gateway Settings"}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}
      </main>

      {/* Add Staff Modal */}
      <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="Add Staff Member">
        <form onSubmit={handleCreateStaff} className="flex flex-col gap-md">
          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Full Name</label>
            <input
              required
              type="text"
              value={staffForm.name}
              onChange={(e) => setStaffForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Priya Sharma"
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Email Address</label>
            <input
              required
              type="email"
              value={staffForm.email}
              onChange={(e) => setStaffForm((p) => ({ ...p, email: e.target.value }))}
              placeholder="staff@qrdine.com"
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Password</label>
            <input
              required
              type="password"
              value={staffForm.password}
              onChange={(e) => setStaffForm((p) => ({ ...p, password: e.target.value }))}
              placeholder="Min. 6 characters"
              minLength={6}
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Role</label>
            <div className="grid grid-cols-2 gap-sm">
              {ASSIGNABLE_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setStaffForm((p) => ({ ...p, role }))}
                  className={`h-11 rounded-xl font-inter font-semibold text-body-sm capitalize cursor-pointer transition-all ${
                    staffForm.role === role
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container-low text-on-surface-variant border border-surface-container hover:bg-surface-container"
                  }`}
                >
                  {role}
                </button>
              ))}
            </div>
            <p className="font-inter text-label-sm text-on-surface-variant mt-xs">
              {ROLE_HINTS[staffForm.role] || "Role-based access is enforced on the server."}
            </p>
          </div>

          {staffError && (
            <div className="bg-error-container text-on-error-container text-body-sm font-inter font-semibold rounded-lg px-md py-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {staffError}
            </div>
          )}

          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Adding..." : "Add Staff"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Set PIN Modal (Module #08) */}
      <Modal
        isOpen={pinModalUser !== null}
        onClose={() => setPinModalUser(null)}
        title={`Set PIN — ${pinModalUser?.name || ""}`}
      >
        <form onSubmit={handleSetPin} className="flex flex-col gap-md">
          <p className="font-inter text-body-sm text-on-surface-variant">
            This PIN lets <strong className="text-on-surface">{pinModalUser?.name}</strong> log in on a shared
            counter tablet without typing an email and password.
          </p>
          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">4–6 digit PIN</label>
            <input
              autoFocus
              required
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md tracking-[0.4em] text-center text-on-surface placeholder-on-surface-variant/40 border-none focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          {pinError && (
            <div className="bg-error-container text-on-error-container text-body-sm font-inter font-semibold rounded-lg px-md py-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {pinError}
            </div>
          )}
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setPinModalUser(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending || pinValue.length < 4}>
              {isPending ? "Saving..." : "Set PIN"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
