"use client";

import React, { useEffect } from "react";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rendered in the sticky footer, e.g. Cancel / Confirm. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** Sheet height cap; the variant picker is short, the cart is tall. */
  maxHeight?: string;
  labelledBy?: string;
}

/**
 * Mobile-first bottom sheet.
 *
 * Built for one-handed reach: the sheet is anchored to the bottom edge, the
 * content scrolls, and the action row stays pinned so the primary action never
 * scrolls out of thumb range. Focus moves into the sheet on open and Escape
 * closes it, which is the minimum for keyboard users.
 */
export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  footer,
  children,
  maxHeight = "85vh",
  labelledBy,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    // Prevent the page behind the sheet from scrolling with it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center">
      <div
        onClick={onClose}
        aria-hidden="true"
        className="absolute inset-0 bg-on-surface/40 backdrop-blur-[2px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative w-full max-w-[520px] bg-surface-container-lowest rounded-t-3xl shadow-[0_-8px_32px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden`}
        style={{ maxHeight }}
      >
        {/* Drag handle — decorative; the sheet is opened by an explicit action */}
        <div aria-hidden="true" className="pt-2 pb-1 flex justify-center shrink-0">
          <span className="block h-1 w-10 rounded-full bg-surface-container-highest" />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>

        {footer && (
          <div className="shrink-0 border-t border-surface-container bg-surface-container-lowest px-margin-mobile py-sm pb-safe">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};