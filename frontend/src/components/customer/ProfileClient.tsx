"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import {
  fetchMyOrders,
  getCafeContactForTable,
  requestEmailOtp,
  signOutCustomer,
  updatePreferences,
  verifyEmailOtp,
  anonymizeMyAccount,
  type CustomerProfile,
  type CustomerStats,
} from "@/actions/customerApp";
import { formatCurrency } from "@/utils/currency";
import { useCartStore } from "@/store/cartStore";
import { SettingsToggle } from "@/components/common/SettingsToggle";
import { Toaster, toast } from "@/components/ui/Toast";
import { RewardsSection } from "@/components/customer/RewardsSection";

interface ProfileClientProps {
  initialProfile: CustomerProfile;
  initialStats: CustomerStats;
  /** Where "back" returns to when the guest has no table in the cart. */
  backHref: string;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="mb-sm mt-md px-1 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant/80">
    {children}
  </h2>
);

export const ProfileClient: React.FC<ProfileClientProps> = ({
  initialProfile,
  initialStats,
  backHref,
}) => {
  const router = useRouter();
  // The table the guest is dining at, so "back" and "sign out" both land on the
  // menu they came from rather than on a dead end.
  const tableId = useCartStore((s) => s.tableId);
  const menuHref = tableId ? `/table/${tableId}` : backHref;
  const [profile, setProfile] = useState(initialProfile);
  // Mirrors `profile` so an async rollback never closes over a stale snapshot.
  const profileRef = useRef(initialProfile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const [stats] = useState(initialStats);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Add-email flow, collapsed until the guest asks for it.
  const [emailDraft, setEmailDraft] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [cafe, setCafe] = useState<{ phone?: string; name?: string }>({});
  const [showErasureConfirm, setShowErasureConfirm] = useState(false);
  const [isAnonymizing, setIsAnonymizing] = useState(false);

  const handleAnonymize = async () => {
    setIsAnonymizing(true);
    const result = await anonymizeMyAccount();
    setIsAnonymizing(false);
    if (result.success) {
      toast(result.message, "success");
      setShowErasureConfirm(false);
      router.replace("/welcome");
      router.refresh();
    } else {
      toast(result.message, "error");
    }
  };

  // The table lives in a persisted browser store, so the café can only be
  // resolved once we are on the client.
  useEffect(() => {
    if (!tableId) return;
    getCafeContactForTable(tableId).then(setCafe);
  }, [tableId]);

  /**
 * Save a boolean preference.
 *
 * The switch is applied optimistically so it feels instant, then reconciled
 * against the server's copy. The rollback reads the *current* profile from a
 * ref rather than a captured one: two quick taps would otherwise restore a
 * snapshot taken before the first save landed and silently undo it.
 */
const setPreference = async (key: "vegOnly" | "notifications", value: boolean) => {
    if (busyKey === key) return;
    setBusyKey(key);

    const previous = profileRef.current.preferences;
    setProfile((current) => ({
      ...current,
      preferences: { ...current.preferences, [key]: value },
    }));

    const result = await updatePreferences({ [key]: value });
    setBusyKey(null);

    if (result.success && result.customer) {
      setProfile(result.customer);
    } else {
      setProfile((current) => ({
        ...current,
        preferences: { ...current.preferences, ...previous },
      }));
      toast(result.message || "Could not save that preference.", "error");
    }
  };

  const openHistory = async () => {
    const result = await fetchMyOrders({ range: "3m", limit: 1 });
    if (result.success) setHistoryCount(result.total);
  };

  const sendEmailCode = async () => {
    setBusyKey("email");
    const result = await requestEmailOtp(emailDraft);
    setBusyKey(null);
    if (!result.success) {
      toast(result.message, "error");
      return;
    }
    setEmailSent(true);
    toast(
      result.devCode ? `Demo mode — your code is ${result.devCode}` : "We sent a code to your email.",
      "success"
    );
  };

  const confirmEmail = async () => {
    setBusyKey("email-verify");
    const result = await verifyEmailOtp(emailDraft, emailCode);
    setBusyKey(null);
    if (!result.success || !result.customer) {
      toast(result.message || "That code did not work.", "error");
      return;
    }
    setProfile(result.customer);
    setEmailSent(false);
    setEmailCode("");
    setEmailDraft("");
    toast("Email verified.", "success");
  };

  const signOut = async () => {
    await signOutCustomer();
    router.push(menuHref);
    router.refresh();
  };

  const initial = (profile.name || profile.phone || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Toaster />
      <TopAppBar title="Profile" showBack onBackHref={menuHref} />

      <main className="flex-1 w-full max-w-[560px] mx-auto px-margin-mobile pb-lg">
        {/* Identity */}
        <div className="flex items-center gap-md py-lg">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary text-headline-lg font-semibold text-on-primary">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="font-inter text-headline-md text-on-surface truncate">
              {profile.name ? `Welcome back, ${profile.name}` : "Welcome back"}
            </p>
            {profile.phone && (
              <p className="font-mono text-body-sm text-on-surface-variant">
                +91 {profile.phone}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-sm">
          {[
            { label: "Orders", value: String(stats.orders), tone: "text-primary" },
            { label: "Spent", value: formatCurrency(stats.spent), tone: "text-on-surface" },
            { label: "Saved", value: formatCurrency(stats.saved), tone: "text-success" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/70">
                {stat.label}
              </p>
              <p className={`mt-1 font-mono text-headline-md font-semibold ${stat.tone}`}>
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Account */}
        <SectionLabel>Account</SectionLabel>
        <Link
          href="/profile/orders"
          onClick={openHistory}
          className="flex items-center gap-md rounded-2xl bg-surface-container-lowest p-md border border-surface-container"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container text-primary">
            <span className="material-symbols-outlined text-[20px]">history</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-body-md font-semibold text-on-surface">Order history</span>
            <span className="block text-body-sm text-on-surface-variant">
              {historyCount === null ? `${stats.orders} orders` : `${historyCount} orders`}
            </span>
          </span>
          {historyCount !== null && (
            <span className="rounded-full bg-primary px-sm py-0.5 text-[11px] font-semibold text-on-primary">
              {historyCount}
            </span>
          )}
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
            chevron_right
          </span>
        </Link>

        {/* Stamps, wallet, scratch cards and offers. These used to exist only in
            the admin panel — a signed-in customer had nowhere to see any of it,
            which made the whole rewards side look broken rather than missing.
            Sits below order history: what the customer already did comes first,
            what they could still earn from it comes after. */}
        <SectionLabel>Rewards</SectionLabel>
        <RewardsSection />

        {/* Preferences */}
        <SectionLabel>Preferences</SectionLabel>
        <div className="flex flex-col rounded-2xl bg-surface-container-lowest border border-surface-container divide-y divide-surface-container overflow-hidden">
          <SettingsToggle
            checked={profile.preferences.vegOnly}
            onChange={(v) => setPreference("vegOnly", v)}
            label="Veg only"
            description="Hide non-veg dishes"
            disabled={busyKey === "vegOnly"}
            icon={
              <span className="material-symbols-outlined text-[20px] text-success">eco</span>
            }
          />

          <SettingsToggle
            checked={profile.preferences.notifications}
            onChange={(v) => setPreference("notifications", v)}
            label="Notifications"
            description="Order updates & offers"
            disabled={busyKey === "notifications"}
            icon={
              <span className="material-symbols-outlined text-[20px] text-primary">
                notifications
              </span>
            }
          />

          {/* English is the only shipped locale; the row is honest about it
              rather than silently accepting a language it cannot honour. */}
          <button
            type="button"
            onClick={() => toast("More languages are coming soon")}
            className="flex w-full items-center gap-md p-md text-left cursor-pointer transition-opacity hover:bg-surface-container-low active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-container text-primary">
              <span className="material-symbols-outlined text-[20px]">language</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-md font-semibold text-on-surface">Language</span>
              <span className="block text-body-sm text-on-surface-variant">English</span>
            </span>
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
              chevron_right
            </span>
          </button>
        </div>

        {/* Email */}
        <SectionLabel>Contact</SectionLabel>
        <div className="flex flex-col gap-sm rounded-2xl bg-surface-container-lowest border border-surface-container p-md">
          {profile.emailVerified ? (
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-success text-[18px]">check_circle</span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-md text-on-surface">{profile.email}</span>
                <span className="block text-body-sm text-on-surface-variant">Verified</span>
              </span>
            </div>
          ) : emailSent ? (
            <div className="flex flex-col gap-sm">
              <label
                htmlFor="email-code"
                className="font-inter font-semibold text-label-md text-on-surface"
              >
                Enter the 6-digit code
              </label>
              <input
                id="email-code"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="······"
                inputMode="numeric"
                className="h-12 rounded-xl bg-surface-container-low px-md font-mono text-body-lg tracking-[0.4em] text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="flex gap-sm">
                <Button
                  variant="primary"
                  onClick={confirmEmail}
                  disabled={busyKey === "email-verify" || emailCode.length !== 6}
                  fullWidth
                >
                  Verify
                </Button>
                <Button variant="secondary" onClick={() => setEmailSent(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-sm">
              <label
                htmlFor="add-email"
                className="font-inter font-semibold text-label-md text-on-surface"
              >
                Add an email for receipts
              </label>
              <input
                id="add-email"
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-xl bg-surface-container-low px-md font-inter text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
              />
              <Button
                variant="secondary"
                onClick={sendEmailCode}
                disabled={busyKey === "email" || !emailDraft.includes("@")}
              >
                Send code
              </Button>
            </div>
          )}
        </div>

        {/* Support */}
        <SectionLabel>Support</SectionLabel>
        {cafe.phone ? (
          <a
            href={`tel:${cafe.phone}`}
            className="flex items-center gap-md rounded-2xl bg-surface-container-lowest p-md border border-surface-container"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success-container text-success">
              <span className="material-symbols-outlined text-[20px]">call</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-md font-semibold text-on-surface">
                Call the restaurant
              </span>
              <span className="block text-body-sm text-on-surface-variant">
                {cafe.name ? cafe.name : "Tap to call"}
              </span>
            </span>
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">
              chevron_right
            </span>
          </a>
        ) : (
          <div className="flex items-center gap-md rounded-2xl bg-surface-container-lowest p-md border border-surface-container opacity-60">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container text-on-surface-variant">
              <span className="material-symbols-outlined text-[20px]">call</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-md font-semibold text-on-surface">
                Call the restaurant
              </span>
              <span className="block text-body-sm text-on-surface-variant">Not available</span>
            </span>
          </div>
        )}

        {/* Privacy & Statutory Rights (DPDP Act 2023) */}
        <SectionLabel>Privacy & Statutory Rights (DPDP Act)</SectionLabel>
        <div className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
          <div className="flex items-start gap-sm mb-sm">
            <span className="material-symbols-outlined text-primary text-[22px] mt-0.5">
              shield_person
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-inter font-semibold text-body-md text-on-surface">
                Digital Personal Data Protection Act, 2023
              </h3>
              <p className="mt-1 font-inter text-body-sm text-on-surface-variant leading-relaxed">
                You have the statutory right to request erasure and withdraw consent.
                Personal contact details will be irreversibly anonymized while statutory tax
                invoices remain archived for 8 years under Section 36 of CGST Act.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowErasureConfirm(true)}
            className="mt-sm w-full rounded-xl border border-error/30 bg-surface-container-low py-sm font-inter text-body-sm font-semibold text-error transition-colors hover:bg-error/10 active:scale-[0.99]"
          >
            Request Profile Anonymization
          </button>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="mt-lg w-full rounded-2xl border border-error/40 bg-surface-container-lowest py-md font-inter font-semibold text-body-lg text-error cursor-pointer active:scale-[0.99]"
        >
          Sign out
        </button>

        {/* Erasure Confirmation Modal */}
        {showErasureConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-margin-mobile backdrop-blur-xs">
            <div className="w-full max-w-[420px] rounded-2xl bg-surface-container-lowest p-lg shadow-xl text-left">
              <div className="flex items-center gap-sm mb-sm text-error">
                <span className="material-symbols-outlined text-[28px]">delete_forever</span>
                <h3 className="font-inter font-bold text-headline-sm text-on-surface">
                  Erase & Anonymize Profile?
                </h3>
              </div>

              <div className="space-y-sm text-body-sm text-on-surface-variant font-inter mb-md leading-relaxed">
                <p>
                  In accordance with <strong>Section 12 of the DPDP Act, 2023</strong>:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Your name, phone number, email, and preferences will be permanently scrubbed.</li>
                  <li>Any unused loyalty stamps, scratch cards, and wallet balance will be deactivated.</li>
                  <li>
                    <strong>Statutory Exception:</strong> Order totals and tax invoice numbers are retained
                    for 8 years to comply with Section 36 of the Central Goods & Services Tax (CGST) Act.
                  </li>
                </ul>
                <p className="text-[12px] font-semibold text-error">
                  This action is permanent and cannot be undone.
                </p>
              </div>

              <div className="flex gap-sm">
                <button
                  type="button"
                  onClick={() => setShowErasureConfirm(false)}
                  disabled={isAnonymizing}
                  className="flex-1 rounded-xl bg-surface-container px-md py-sm font-inter text-body-md font-semibold text-on-surface disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAnonymize}
                  disabled={isAnonymizing}
                  className="flex-1 rounded-xl bg-error px-md py-sm font-inter text-body-md font-semibold text-on-error disabled:opacity-50 active:scale-[0.99]"
                >
                  {isAnonymizing ? "Anonymizing…" : "Confirm Erasure"}
                </button>
              </div>
            </div>
          </div>
        )}

        <p className="mt-lg text-center text-[11px] text-on-surface-variant/60">
          Powered by QRDine
        </p>
      </main>
    </div>
  );
};