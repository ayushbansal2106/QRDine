"use client";

import React from "react";

interface CustomerSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Total dishes available, shown in the placeholder as the reference does. */
  dishCount: number;
  vegOnly: boolean;
  onToggleVegOnly: () => void;
}

/**
 * Search with the dish count folded into the placeholder, plus a real filter.
 *
 * The filter is deliberately vegetarian-only rather than decorative: in an
 * Indian cafe it is the single most-used narrowing control, and a button that
 * does nothing would be worse than no button.
 */
export const CustomerSearchBar: React.FC<CustomerSearchBarProps> = ({
  value,
  onChange,
  dishCount,
  vegOnly,
  onToggleVegOnly,
}) => (
  <div className="flex items-center gap-sm">
    <div className="relative flex-1 min-w-0">
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-[18px] text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
      >
        search
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Search in ${dishCount} dishes…`}
        aria-label={`Search ${dishCount} dishes`}
        className="w-full h-11 md:h-12 pl-9 pr-3 rounded-xl bg-surface-container-lowest border border-surface-container text-body-md text-on-surface outline-none focus:border-primary"
      />
    </div>

    <button
      type="button"
      onClick={onToggleVegOnly}
      aria-pressed={vegOnly}
      aria-label="Show vegetarian dishes only"
      title="Vegetarian only"
      className={`shrink-0 grid place-items-center h-11 w-11 md:h-12 md:w-12 rounded-xl border transition-colors ${
        vegOnly
          ? "bg-success-container border-success text-on-success-container"
          : "bg-surface-container-lowest border-surface-container text-on-surface"
      }`}
    >
      <span className="material-symbols-outlined text-[20px]">eco</span>
    </button>
  </div>
);