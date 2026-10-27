"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { PhoneOtpField } from "@/components/customer/PhoneOtpField";
import { GuestPrivacyNotice } from "@/components/common/GuestPrivacyNotice";
import { isCustomerSignedIn } from "@/actions/customerApp";
import { useCartStore } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { useStoresHydrated } from "@/store/useStoresHydrated";

interface SignInClientProps {
  /** Where to go once the guest is verified. */
  next: string;
  /** The café to request the OTP against, when it is known. */
  cafeId?: string | null;
  cafeName?: string | null;
  backHref: string;
}

/**
 * Dedicated guest sign-in (Module #09).
 *
 * This exists because a guest used to be able to reach nothing: the profile
 * page sent them to `/`, which redirects to the staff portal. Browsing needs no
 * identity, so sign-in is always optional and always skippable — but when a
 * guest asks for their profile, it must land here rather than on a staff login.
 */
export const SignInClient: React.FC<SignInClientProps> = ({
  next,
  cafeId,
  cafeName,
  backHref,
}) => {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  // The cart persists the café, so this works even when the URL carries none. It
  // is gated on hydration: reading it on the first client pass would render the
  // "open from your table" warning on the client but not on the server.
  const storesHydrated = useStoresHydrated();
  const storedCafeId = useCartStore((s) => s.cafeId);
  const effectiveCafeId = cafeId || (storesHydrated ? storedCafeId : null) || "";
  const saveCustomerIdentity = useSessionStore((s) => s.saveCustomerIdentity);

  // Someone already signed in has no business on this page.
  useEffect(() => {
    isCustomerSignedIn().then((signedIn) => {
      if (signedIn) router.replace(next);
    });
  }, [next, router]);

  const handleVerified = (identity: { name: string; phone: string; email: string }) => {
    setError("");
    // Remember it so the dining-session gate can prefill the name later and
    // not ask for it a second time.
    saveCustomerIdentity(identity.name, identity.email, identity.phone);
    router.replace(next);
    router.refresh();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar title="Sign in" showBack onBackHref={backHref} />

      <main className="flex-1 w-full max-w-[420px] mx-auto px-margin-mobile py-lg">
        <div className="text-center mb-lg">
          <span className="material-symbols-outlined text-primary text-[48px] mb-sm block">
            person
          </span>
          <h1 className="font-inter font-bold text-headline-md text-on-surface mb-xs">
            Sign in
          </h1>
          <p className="font-inter text-body-md text-on-surface-variant">
            {cafeName
              ? `Keep your orders, offers and preferences at ${cafeName}.`
              : "Keep your orders, offers and preferences in one place."}
          </p>
        </div>

        {!effectiveCafeId && (
          <p className="mb-md rounded-xl bg-warning-container px-md py-sm text-body-sm text-on-warning-container">
            Open this page from your table&apos;s menu so we know which café you
            are signing in to.
          </p>
        )}

        <PhoneOtpField
          cafeId={effectiveCafeId}
          phone={phone}
          onPhoneChange={setPhone}
          onVerified={handleVerified}
        />

        {error && (
          <p role="alert" className="mt-sm bg-error/10 text-error text-body-sm rounded-lg p-sm">
            {error}
          </p>
        )}

        {/* Signing in is only for the profile; ordering never requires it up
            front, so it must stay genuinely optional. */}
        <button
          type="button"
          onClick={() => router.replace(backHref)}
          className="mt-md w-full h-11 text-primary font-inter font-semibold text-body-md cursor-pointer"
        >
          Browse the menu without signing in
        </button>

        <GuestPrivacyNotice className="mt-md" />
      </main>
    </div>
  );
};