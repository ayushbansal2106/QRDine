"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cartStore";
import { useStoresHydrated } from "@/store/useStoresHydrated";
import { WaiterAssistanceModal } from "@/components/WaiterAssistanceModal";
import { CustomerBillModal } from "@/components/menu/CustomerBillModal";
import { useSessionGate } from "@/components/menu/SessionGate";

interface StickyActionBarProps {
  tableId: string;
  /**
   * When provided the cart button opens the in-page cart sheet instead of
   * navigating to /cart, matching the mobile one-handed flow. Omitted by any
   * caller that still wants the standalone cart page.
   */
  onOpenCart?: () => void;
}

export const StickyActionBar: React.FC<StickyActionBarProps> = ({ tableId, onOpenCart }) => {
  const { getTotalItems } = useCartStore();
  const { ensureSession } = useSessionGate();
  const [isWaiterModalOpen, setIsWaiterModalOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);

  // The cart is persisted, so the badge must not claim items the server render
  // never knew about.
  const storesHydrated = useStoresHydrated();
  const totalItems = storesHydrated ? getTotalItems() : 0;

  /**
   * Calling a waiter is an action on behalf of the table, so it needs the same
   * dining session that ordering does. The gate prompts for sign-in only when
   * one is actually missing — browsing the menu never triggers this.
   */
  const requestWaiter = async () => {
    const session = await ensureSession();
    if (session) setIsWaiterModalOpen(true);
  };

  /**
   * The bill needs a session for the same reason a waiter does — the preview is
   * priced from the session's orders. This used to open the modal directly, so a
   * guest whose session store was empty got "No active orders found for this
   * session" and no way forward: the bill button looked simply broken.
   */
  const openBill = async () => {
    const session = await ensureSession();
    if (session) setIsBillModalOpen(true);
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest border-t border-surface-container shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] pb-safe">
        <div className="max-w-[1280px] mx-auto flex h-16 md:h-20">
          
          {/* Help Button */}
          <button
            onClick={requestWaiter}
            className="flex-1 flex flex-col items-center justify-center gap-xs cursor-pointer hover:bg-surface-container-low transition-colors border-r border-surface-container"
          >
            <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
              concierge
            </span>
            <span className="font-inter font-semibold text-label-sm text-on-surface">
              Help
            </span>
          </button>

          {/* Bill Button */}
          <button
            onClick={openBill}
            className="flex-1 flex flex-col items-center justify-center gap-xs cursor-pointer hover:bg-surface-container-low transition-colors border-r border-surface-container"
          >
            <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
              receipt_long
            </span>
            <span className="font-inter font-semibold text-label-sm text-on-surface">
              Bill
            </span>
          </button>

          {/* Cart Button */}
          {onOpenCart ? (
            <button
              type="button"
              onClick={onOpenCart}
              className="flex-1 flex flex-col items-center justify-center gap-xs cursor-pointer hover:bg-surface-container-low transition-colors relative"
            >
              <div className="relative">
                <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
                  shopping_cart
                </span>
                {totalItems > 0 && (
                  <div className="absolute -top-1 -right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-on-primary text-[10px] font-bold border-2 border-surface-container-lowest">
                    {totalItems}
                  </div>
                )}
              </div>
              <span className="font-inter font-semibold text-label-sm text-on-surface">
                Cart
              </span>
            </button>
          ) : (
            <Link
              href="/cart"
              className="flex-1 flex flex-col items-center justify-center gap-xs cursor-pointer hover:bg-surface-container-low transition-colors relative"
            >
              <div className="relative">
                <span className="material-symbols-outlined text-[24px] text-on-surface-variant">
                  shopping_cart
                </span>
                {totalItems > 0 && (
                  <div className="absolute -top-1 -right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center text-on-primary text-[10px] font-bold border-2 border-surface-container-lowest">
                    {totalItems}
                  </div>
                )}
              </div>
              <span className="font-inter font-semibold text-label-sm text-on-surface">
                Cart
              </span>
            </Link>
          )}
        </div>
      </div>

      {/* Modals & Drawers */}
      <WaiterAssistanceModal
        isOpen={isWaiterModalOpen}
        onClose={() => setIsWaiterModalOpen(false)}
        tableId={tableId}
      />
      
      <CustomerBillModal 
        isOpen={isBillModalOpen} 
        onClose={() => setIsBillModalOpen(false)} 
      />
    </>
  );
};
