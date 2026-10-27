"use client";

import React from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/common/Button";
import { GuestPrivacyNotice } from "@/components/common/GuestPrivacyNotice";
import { useCartStore } from "@/store/cartStore";
import { isCustomerSignedIn } from "@/actions/customerApp";

/**
 * Neutral landing page for guests.
 *
 * Every customer surface needs somewhere harmless to fall back to when there is
 * no table in the cart. The app root (`/`) is the *staff* entry point and
 * redirects to the admin portal, so using it as a guest fallback dumps customers
 * on the executive dashboard — which is exactly the bug this page exists to fix.
 */
export const WelcomeClient: React.FC = () => {
  const router = useRouter();
  const tableId = useCartStore((s) => s.tableId);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    isCustomerSignedIn().then(setSignedIn);
  }, []);

  // Someone who scanned a QR already has a table — send them straight there.
  useEffect(() => {
    if (tableId) router.replace(`/table/${tableId}`);
  }, [tableId, router]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 w-full max-w-[420px] mx-auto px-margin-mobile py-lg flex flex-col justify-center items-center text-center">
        <span className="material-symbols-outlined text-primary text-[56px] mb-md">
          restaurant_menu
        </span>

        <h1 className="font-inter font-bold text-headline-lg text-on-surface mb-xs">
          QRDine
        </h1>
        <p className="font-inter text-body-md text-on-surface-variant mb-lg">
          Scan the QR code on your table to browse the menu and order.
        </p>

        <div className="flex w-full max-w-[280px] flex-col gap-sm">
          <Button
            variant="primary"
            fullWidth
            className="h-12"
            onClick={() => router.push("/signin?next=%2Fprofile")}
          >
            Sign in to your account
          </Button>

          {signedIn && (
            <Button
              variant="secondary"
              fullWidth
              onClick={() => router.push("/profile")}
            >
              View your profile
            </Button>
          )}
        </div>

        <GuestPrivacyNotice className="mt-lg" />

        <p className="mt-md text-[11px] text-on-surface-variant/60">Powered by QRDine</p>
      </main>
    </div>
  );
};