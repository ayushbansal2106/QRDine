"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSocketStore } from "@/store/socketStore";

interface TopAppBarProps {
  title: string;
  showBack?: boolean;
  onBackHref?: string;
  onSearchClick?: () => void;
  showSearch?: boolean;
  iconName?: string;
  showStatusBadge?: boolean;
  restaurantLegalName?: string;
  fssaiNumber?: string;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  title,
  showBack = false,
  onBackHref,
  onSearchClick,
  showSearch = false,
  iconName = "restaurant",
  showStatusBadge = false,
  restaurantLegalName,
  fssaiNumber,
}) => {
  const router = useRouter();
  const { isConnected } = useSocketStore();
  const [showFssaiInfo, setShowFssaiInfo] = React.useState(false);

  return (
    <header className="bg-background w-full sticky top-0 z-50 px-margin-mobile py-sm flex items-center justify-between border-b border-surface-container shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
      {showBack ? (
        <button
          onClick={() => (onBackHref ? router.push(onBackHref) : router.back())}
          aria-label="Go Back"
          className="text-on-surface-variant hover:opacity-80 transition-opacity active:scale-95 duration-200 cursor-pointer flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-[24px]">arrow_back</span>
        </button>
      ) : (
        <button
          aria-label="Menu Home"
          className="text-on-surface-variant hover:opacity-80 transition-opacity active:scale-95 duration-200 cursor-pointer flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-[24px]">{iconName}</span>
        </button>
      )}

      <div className="flex-1 flex flex-col items-center mx-2 select-none overflow-hidden">
        <h1 className="font-inter font-semibold text-headline-md text-primary text-center truncate w-full">
          {title}
        </h1>
        {(restaurantLegalName || fssaiNumber) && (
          <button
            type="button"
            onClick={() => setShowFssaiInfo(!showFssaiInfo)}
            className="flex items-center gap-1 text-[11px] text-on-surface-variant/80 hover:text-primary transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[13px] text-primary">verified</span>
            <span className="truncate max-w-[200px]">FSSAI: {fssaiNumber || "Verified Intermediary"}</span>
          </button>
        )}
      </div>

      {showFssaiInfo && (restaurantLegalName || fssaiNumber) && (
        <div className="absolute top-full left-0 right-0 bg-surface-container-lowest border-b border-surface-container shadow-lg p-3 z-50 animate-fadeIn">
          <div className="max-w-[32rem] mx-auto flex flex-col gap-1.5 font-inter">
            <div className="flex items-center justify-between pb-1 border-b border-surface-container">
              <span className="text-label-sm font-semibold text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">verified</span>
                Statutory FSSAI & IT Act Disclosure
              </span>
              <button
                type="button"
                onClick={() => setShowFssaiInfo(false)}
                className="text-on-surface-variant hover:text-on-surface text-body-sm"
              >
                ✕
              </button>
            </div>
            <p className="text-body-xs text-on-surface-variant leading-relaxed">
              Food preparation, allergen declaration, and hygiene are managed exclusively by{" "}
              <strong className="text-on-surface">{restaurantLegalName || title}</strong>
              {fssaiNumber ? ` (FSSAI Lic. No. ${fssaiNumber})` : ""}. QRDine is a software intermediary under Section 79 of the Information Technology Act, 2000.
            </p>
          </div>
        </div>
      )}

      {showStatusBadge ? (
        <div className="flex items-center gap-[4px] font-inter text-body-sm font-semibold select-none">
          {isConnected ? (
            <span className="flex items-center gap-[4px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="flex items-center gap-[4px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Reconnecting
            </span>
          )}
        </div>
      ) : showSearch ? (
        <button
          onClick={onSearchClick}
          aria-label="Search"
          className="text-on-surface-variant hover:opacity-80 transition-opacity active:scale-95 duration-200 cursor-pointer flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-[24px]">search</span>
        </button>
      ) : (
        <div className="w-6" /> // spacer
      )}
    </header>
  );
};
