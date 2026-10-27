"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";
import { useHydrated } from "@/hooks/useHydrated";

export const BottomCartSummary: React.FC = () => {
  const items = useCartStore((s) => s.items);
  // The cart is persisted to localStorage, so the server cannot know its
  // contents. Gate on the client taking over instead of a mount-effect flag.
  const hydrated = useHydrated();

  // Derived, not stored: these were previously mirrored into `useState` by an
  // effect, which meant one render with the old totals before the new ones
  // landed — so adding an item briefly showed the pre-add price.
  const { totalItems, totalPrice } = useMemo(() => {
    let count = 0;
    let price = 0;
    for (const item of items) {
      count += item.quantity;
      price += Number(item.unitPrice ?? item.menuItem.price) * item.quantity;
    }
    return { totalItems: count, totalPrice: price };
  }, [items]);

  if (!hydrated || totalItems === 0) return null;

  return (
    <>
      {/* Mobile Cart Summary */}
      <div className="fixed bottom-0 left-0 w-full z-50 rounded-t-xl bg-surface shadow-[0px_-4px_20px_rgba(0,0,0,0.04)] md:hidden">
        <div className="w-full bg-primary text-on-primary px-margin-mobile py-sm flex justify-between items-center h-16 shadow-[0px_-12px_32px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col">
            <span className="font-inter font-semibold text-label-md text-on-primary/90">
              {totalItems} {totalItems === 1 ? "item" : "items"}
            </span>
            <span className="font-inter font-semibold text-headline-md text-on-primary">
              {formatCurrency(totalPrice)}
            </span>
          </div>
          <Link href="/cart" passHref>
            <button className="bg-surface-container-lowest text-primary font-inter font-semibold text-label-md px-lg py-sm rounded-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] hover:bg-surface-container transition-colors cursor-pointer">
              View Cart
            </button>
          </Link>
        </div>
      </div>

      {/* Desktop Cart Summary */}
      <div className="hidden md:flex fixed bottom-0 left-0 w-full z-50 justify-center pb-md pointer-events-none">
        <div className="bg-primary text-on-primary px-lg py-sm rounded-full flex justify-between items-center w-full max-w-[600px] shadow-[0px_12px_32px_rgba(0,0,0,0.08)] pointer-events-auto h-16">
          <div className="flex items-center gap-md">
            <div className="bg-on-primary/20 p-sm rounded-full flex items-center justify-center">
              <span className="material-symbols-outlined text-on-primary text-[24px]">
                shopping_bag
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-inter font-semibold text-label-md text-on-primary/90">
                {totalItems} {totalItems === 1 ? "item" : "items"}
              </span>
              <span className="font-inter font-semibold text-body-lg text-on-primary">
                {formatCurrency(totalPrice)}
              </span>
            </div>
          </div>
          <Link href="/cart" passHref>
            <button className="bg-surface-container-lowest text-primary font-inter font-semibold text-label-md px-lg py-sm rounded-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] hover:bg-surface-container transition-colors cursor-pointer">
              View Cart
            </button>
          </Link>
        </div>
      </div>
    </>
  );
};
