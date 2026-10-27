"use client";

import React, { useState } from "react";

interface FssaiDisclaimerProps {
  restaurantName?: string;
  legalName?: string;
  fssaiNumber?: string;
  compact?: boolean;
}

/**
 * Statutory FSSAI Food Safety & Intermediary Disclaimer (Task 5.3 - Stage 5)
 *
 * Fulfills legal disclosure requirement designating restaurant as solely liable
 * for food safety, hygiene, and allergen declaration under FSSAI Digital Guidelines,
 * while QRDine operates strictly as a software intermediary under Section 79 of the IT Act.
 */
export const FssaiDisclaimer: React.FC<FssaiDisclaimerProps> = ({
  restaurantName = "Restaurant",
  legalName,
  fssaiNumber,
  compact = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayEntity = legalName || restaurantName;
  const displayLic = fssaiNumber ? fssaiNumber : "Registered / Applied For";

  if (compact) {
    return (
      <div className="w-full text-center py-2 px-3 bg-surface-container-low/40 rounded-lg border border-surface-container/50">
        <p className="text-[11px] text-on-surface-variant/80 font-inter leading-relaxed">
          <span className="font-semibold text-on-surface">FSSAI Compliance: </span>
          Food preparation, allergen declaration, and hygiene are managed exclusively by{" "}
          <span className="font-medium text-on-surface">{displayEntity}</span> (FSSAI Lic. No.{" "}
          <span className="font-mono font-medium text-on-surface">{displayLic}</span>). QRDine is a software intermediary.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full bg-surface-container-low/60 rounded-xl p-3 border border-surface-container text-left transition-all">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">verified</span>
          <span className="text-label-sm font-semibold text-on-surface font-inter">
            Food Safety & FSSAI Disclosure
          </span>
        </div>
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant transition-transform duration-200" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }}>
          expand_more
        </span>
      </div>

      {isExpanded ? (
        <div className="mt-2 pt-2 border-t border-surface-container/60 flex flex-col gap-1.5 font-inter text-body-xs text-on-surface-variant leading-relaxed">
          <p>
            Food preparation, allergen declaration, and hygiene are managed exclusively by{" "}
            <strong className="text-on-surface">{displayEntity}</strong> (FSSAI Lic. No.{" "}
            <span className="font-mono font-semibold text-on-surface">{displayLic}</span>). QRDine is a software intermediary.
          </p>
          <p className="text-[10px] text-on-surface-variant/60">
            Technology platform provided under Section 79 of the Information Technology Act, 2000. QRDine does not prepare, handle, package, or transport food items.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-on-surface-variant/70 font-inter line-clamp-1">
          Food preparation & hygiene managed exclusively by {displayEntity} (FSSAI Lic. No. {displayLic}).
        </p>
      )}
    </div>
  );
};
