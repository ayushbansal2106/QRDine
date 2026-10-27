"use client";

import React, { useState } from "react";

interface GuestPrivacyNoticeProps {
  className?: string;
  defaultExpanded?: boolean;
}

/**
 * DPDP Act 2023 & Guest Privacy Disclosure Component (Task 3.2).
 *
 * Explains:
 * 1. Why temporary session cookies are set (table isolation).
 * 2. Why phone numbers/emails are strictly optional (receipts & loyalty).
 * 3. Right to Erasure under Section 12 of DPDP Act 2023.
 * 4. 8-Year statutory retention under Section 36 of CGST Act 2017.
 */
export const GuestPrivacyNotice: React.FC<GuestPrivacyNoticeProps> = ({
  className = "",
  defaultExpanded = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  return (
    <div
      className={`w-full max-w-[480px] mx-auto rounded-xl border border-surface-container bg-surface-container-lowest/80 text-left transition-all ${className}`}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between p-sm text-left active:bg-surface-container/50 rounded-xl"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-xs">
          <span className="material-symbols-outlined text-[18px] text-primary">
            verified_user
          </span>
          <span className="font-inter text-label-md font-medium text-on-surface">
            Guest Privacy & DPDP Notice
          </span>
        </div>
        <span
          className={`material-symbols-outlined text-[18px] text-on-surface-variant transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className="px-sm pb-sm pt-xs border-t border-surface-container/60 space-y-xs font-inter text-[12px] text-on-surface-variant leading-relaxed">
          <p>
            <strong>• Session Cookies:</strong> We use ephemeral, encrypted cookies solely to connect
            your device to this table and prevent order cross-contamination.
          </p>
          <p>
            <strong>• Zero Mandatory Identity:</strong> Providing your phone number or email is
            entirely optional. You can browse menus and order as an anonymous table guest.
          </p>
          <p>
            <strong>• DPDP Act 2023 Compliance:</strong> You may inspect, modify, or permanently
            anonymize your profile at any time from your account settings.
          </p>
          <p>
            <strong>• Statutory Tax Retention:</strong> Past order invoice amounts are retained for 8
            years to comply with Section 36 of the Central Goods and Services Tax (CGST) Act, 2017.
          </p>
        </div>
      )}
    </div>
  );
};
