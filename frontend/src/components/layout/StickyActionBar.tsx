"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cartStore";
import { WaiterAssistanceModal } from "@/components/WaiterAssistanceModal";
import { CustomerBillModal } from "@/components/menu/CustomerBillModal";

interface StickyActionBarProps {
  tableId: string;
}

export const StickyActionBar: React.FC<StickyActionBarProps> = ({ tableId }) => {
  const { getTotalItems } = useCartStore();
  const [isWaiterModalOpen, setIsWaiterModalOpen] = useState(false);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);

  const totalItems = getTotalItems();

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-container-lowest border-t border-surface-container shadow-[0px_-4px_20px_rgba(0,0,0,0.05)] pb-safe">
        <div className="max-w-[1280px] mx-auto flex h-16 md:h-20">
          
          {/* Help Button */}
          <button
            onClick={() => setIsWaiterModalOpen(true)}
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
            onClick={() => setIsBillModalOpen(true)}
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
