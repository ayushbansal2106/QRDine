"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { CartItem } from "@/components/cart/CartItem";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/common/Button";
import { useCartStore } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";
import { ActivityFeedList } from "@/components/cart/ActivityFeedList";

export default function CartPage() {
  const { items, getTotalPrice, tableId } = useCartStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopAppBar title="Your Cart" showBack />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-inter text-body-md text-on-surface-variant">
            Loading cart...
          </span>
        </div>
      </div>
    );
  }

  const subtotal = items.reduce((acc, item) => acc + (item.menuItem.price * item.quantity), 0);
  const totalGST = items.reduce((acc, item) => acc + (item.menuItem.price * item.quantity * (item.menuItem.gstPercentage || 0)) / 100, 0);
  const total = subtotal + totalGST;

  const backUrl = tableId ? `/table/${tableId}` : "/";

  return (
    <div className="min-h-screen flex flex-col bg-background pb-md">
      {/* Header */}
      <TopAppBar title="Your Cart" showBack />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[768px] mx-auto px-margin-mobile py-md flex flex-col justify-between">
        {items.length > 0 ? (
          <div className="flex-1 flex flex-col justify-between">
            {/* Cart Items List */}
            <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-md">
              {items.map((item) => (
                <CartItem key={item.menuItem.id} item={item} />
              ))}
            </div>

            {/* Recent Activity Feed */}
            <ActivityFeedList />

            {/* Pricing Summary */}
            <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] flex flex-col gap-sm mb-lg">
              <div className="flex justify-between items-center text-body-md text-on-surface-variant font-inter">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between items-center text-body-md text-on-surface-variant font-inter border-b border-surface-container pb-sm">
                <span>GST</span>
                <span>{formatCurrency(totalGST)}</span>
              </div>
              <div className="flex justify-between items-center text-body-lg font-semibold text-on-surface font-inter">
                <span>Total</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-sm">
              <Link href="/checkout" passHref className="w-full">
                <Button variant="primary" fullWidth className="h-12">
                  Proceed to Checkout
                </Button>
              </Link>
              <Link href={backUrl} passHref className="w-full">
                <Button variant="secondary" fullWidth className="h-12">
                  Add More Items
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState
            title="Your Cart is Empty"
            description="Browse our menu to add delicious items to your order."
            actionLabel="Browse Menu"
            onAction={() => window.location.href = backUrl}
            icon="shopping_basket"
          />
        )}
      </main>
    </div>
  );
}
