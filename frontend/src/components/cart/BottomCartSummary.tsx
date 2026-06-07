"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";

export const BottomCartSummary: React.FC = () => {
  const { items, getTotalItems, getTotalPrice } = useCartStore();
  const [totalItems, setTotalItems] = useState(0);
  const [totalPrice, setTotalPrice] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      setTotalItems(getTotalItems());
      setTotalPrice(getTotalPrice());
    }
  }, [items, mounted, getTotalItems, getTotalPrice]);

  if (!mounted || totalItems === 0) return null;

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
