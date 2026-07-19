"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { useCartStore } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { createOrder } from "@/actions/orders";
import { formatCurrency } from "@/utils/currency";

export default function CheckoutPage() {
  const router = useRouter();
  const { items, getTotalPrice, tableId, sessionId, clearCart } = useCartStore();
  const { sessionStatus } = useSessionStore();
  const isSessionLocked = sessionStatus === 'bill_requested' || sessionStatus === 'awaiting_payment';
  const [mounted, setMounted] = useState(false);
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [clientRequestId] = useState(() => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15));

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopAppBar title="Checkout" showBack />
        <div className="flex-1 flex items-center justify-center">
          <span className="font-inter text-body-md text-on-surface-variant">
            Loading checkout...
          </span>
        </div>
      </div>
    );
  }

  // Redirect if cart is empty or no table selected
  if (items.length === 0 || !tableId) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <TopAppBar title="Checkout" showBack />
        <div className="flex-1 flex flex-col items-center justify-center p-md text-center">
          <h3 className="font-inter font-semibold text-headline-md text-on-surface mb-xs">
            Invalid Checkout
          </h3>
          <p className="font-inter font-normal text-body-sm text-on-surface-variant mb-md">
            Please make sure you have added items to your cart and scanned a table QR.
          </p>
          <Link href="/" passHref>
            <Button variant="primary">Return Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const subtotal = items.reduce((acc, item) => acc + (item.menuItem.price * item.quantity), 0);
  const totalGST = items.reduce((acc, item) => acc + (item.menuItem.price * item.quantity * (item.menuItem.gstPercentage || 0)) / 100, 0);
  const total = subtotal + totalGST;

  const handlePlaceOrder = async () => {
    setIsLoading(true);
    try {
      // Map cartStore items to createOrder parameters
      const mappedItems = items.map((i) => ({
        menuItemId: i.menuItem.id,
        quantity: i.quantity,
        price: Number(i.menuItem.price),
      }));

      const { participantId } = useSessionStore.getState();

      const res = await createOrder(tableId, mappedItems, notes, sessionId, participantId, clientRequestId);
      if (res.success) {
        // Clear local cart
        clearCart();
        // Redirect to success screen
        router.push(`/order/success/${res.orderId}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to place order. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background pb-md">
      {/* Header */}
      <TopAppBar title="Checkout" showBack />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[768px] mx-auto px-margin-mobile py-md flex flex-col justify-between">
        <div className="flex-1 flex flex-col">
          {/* Order Summary */}
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-md">
            <h3 className="font-inter font-semibold text-body-lg text-on-surface border-b border-surface-container pb-xs mb-sm">
              Items Summary
            </h3>
            <div className="flex flex-col gap-sm">
              {items.map((item) => (
                <div
                  key={item.menuItem.id}
                  className="flex justify-between items-center text-body-md text-on-surface font-inter"
                >
                  <span className="truncate pr-4">
                    {item.menuItem.name} <span className="text-on-surface-variant font-medium">x{item.quantity}</span>
                  </span>
                  <span className="shrink-0 font-semibold">
                    {formatCurrency(Number(item.menuItem.price) * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-md">
            <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
              Special Instructions
            </h3>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. No onions, dressing on the side, extra ice..."
              className="w-full bg-surface-container-low rounded-lg p-sm border-none font-inter text-body-md text-on-surface placeholder-on-surface-variant/60 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>

          {/* Totals */}
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
          
          {isSessionLocked && (
            <div className="bg-warning/10 text-warning text-body-sm font-inter rounded-lg p-sm mb-md flex items-center gap-sm">
              <span className="material-symbols-outlined text-[20px]">lock</span>
              This table is currently settling the bill. Additional orders cannot be placed.
            </div>
          )}
        </div>

        {/* Actions */}
        <Button
          variant="primary"
          fullWidth
          className="h-12"
          onClick={handlePlaceOrder}
          disabled={isLoading || isSessionLocked}
        >
          {isSessionLocked ? "Table Locked" : isLoading ? "Placing Order..." : "Confirm & Place Order"}
        </Button>
      </main>
    </div>
  );
}
