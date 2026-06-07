"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useSocketStore } from "@/store/socketStore";

interface TopAppBarProps {
  title: string;
  showBack?: boolean;
  onSearchClick?: () => void;
  showSearch?: boolean;
  iconName?: string;
  showStatusBadge?: boolean;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  title,
  showBack = false,
  onSearchClick,
  showSearch = false,
  iconName = "restaurant",
  showStatusBadge = false,
}) => {
  const router = useRouter();
  const { isConnected } = useSocketStore();

  return (
    <header className="bg-background w-full sticky top-0 z-50 px-margin-mobile py-sm flex items-center justify-between border-b border-surface-container shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
      {showBack ? (
        <button
          onClick={() => router.back()}
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

      <h1 className="font-inter font-semibold text-headline-md text-primary text-center flex-1 mx-4 select-none truncate">
        {title}
      </h1>

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
