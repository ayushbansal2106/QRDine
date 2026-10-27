"use client";

import React from "react";
import Link from "next/link";

export interface CustomerCafe {
  name: string;
  legalName?: string;
  fssaiNumber?: string;
  gstin?: string;
  logo: string;
  address: string;
  isOrderingPaused?: boolean;
  orderingPausedReason?: string;
  operatingHours?: {
    enabled?: boolean;
    openTime?: string;
    closeTime?: string;
    days?: number[];
  };
}

interface CustomerHeaderProps {
  cafe: CustomerCafe;
  /** Null until genuinely public ratings exist — the chip is omitted, not faked. */
  rating?: number | null;
  cartCount: number;
  onCallServer: () => void;
  onOpenCart: () => void;
  /** Module #09 — entry point to the guest profile. */
  onOpenProfile: () => void;
}

/** Falls back to initials so a café without a logo still has an identity. */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/**
 * Sticky customer header.
 *
 * Mobile-first: the café name is allowed to truncate rather than push the
 * actions off-screen, because the action targets must stay reachable one-handed.
 */
export const CustomerHeader: React.FC<CustomerHeaderProps> = ({
  cafe,
  rating,
  cartCount,
  onCallServer,
  onOpenCart,
  onOpenProfile,
}) => (
  <header className="sticky top-0 z-40 bg-surface-container-lowest border-b border-surface-container">
    <div className="flex items-center gap-sm px-margin-mobile md:px-margin-desktop h-16 md:h-20">
      {/* Identity */}
      {cafe.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cafe.logo}
          alt=""
          className="h-10 w-10 md:h-12 md:w-12 rounded-full object-cover shrink-0 border border-surface-container"
        />
      ) : (
        <div
          aria-hidden="true"
          className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-primary text-on-primary grid place-items-center font-semibold shrink-0"
        >
          {initialsOf(cafe.name) || "•"}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-xs min-w-0">
          <h1 className="font-semibold text-body-lg md:text-headline-md text-on-surface truncate">
            {cafe.name || "Menu"}
          </h1>
          {typeof rating === "number" && rating > 0 && (
            <span className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-success px-1 py-0.5 text-[11px] font-semibold text-white">
              <span className="material-symbols-outlined text-[11px]">star</span>
              {rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="text-[11px] md:text-body-sm text-on-surface-variant truncate">
          Dine-in · QR menu
        </p>
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={onCallServer}
        className="shrink-0 inline-flex items-center gap-1 h-10 px-3 md:h-11 md:px-4 rounded-xl bg-primary text-on-primary text-body-sm font-semibold active:scale-[0.97] transition-transform"
      >
        <span className="material-symbols-outlined text-[18px]">notifications</span>
        <span className="hidden sm:inline">Server</span>
      </button>

      <Link
        href="/profile"
        onClick={onOpenProfile}
        aria-label="Your profile"
        className="shrink-0 grid place-items-center h-10 w-10 md:h-11 md:w-11 rounded-xl bg-surface-container text-on-surface active:scale-[0.97] transition-transform"
      >
        <span className="material-symbols-outlined text-[20px]">person</span>
      </Link>

      <button
        type="button"
        onClick={onOpenCart}
        aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
        className="shrink-0 relative grid place-items-center h-10 w-10 md:h-11 md:w-11 rounded-xl bg-surface-container text-on-surface active:scale-[0.97] transition-transform"
      >
        <span className="material-symbols-outlined text-[20px]">shopping_cart</span>
        {cartCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold grid place-items-center">
            {cartCount > 99 ? "99+" : cartCount}
          </span>
        )}
      </button>
    </div>
  </header>
);