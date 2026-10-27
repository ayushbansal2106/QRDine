import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { getPublicOrderAction } from "@/actions/orders";
import { fetchMyLoyaltyCard } from "@/actions/loyalty";
import { fetchMyWallet } from "@/actions/wallet";
import { ScratchReveal } from "@/components/customer/ScratchReveal";
import { RatingPrompt } from "@/components/customer/RatingPrompt";
import { formatCurrency } from "@/utils/currency";
import { mapRawOrder } from "@/lib/mappers";
import type { Order, CustomerLoyaltySummary, Wallet } from "@/types";

interface SuccessPageProps {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<{ couponNotice?: string }>;
}

export default async function SuccessPage({ params, searchParams }: SuccessPageProps) {
  const { orderId } = await params;
  // A guest coupon that could not be honoured is reported by the orders API
  // rather than thrown, so the order still succeeded — relay that here.
  const { couponNotice } = (await searchParams) ?? {};

  let order: Order | null = null;

  try {
    const res = await getPublicOrderAction(orderId);
    if (res.success) {
      order = mapRawOrder(res.order);
    }
  } catch (error) {
    console.error("Error loading success order details:", error);
  }

  if (!order) {
    notFound();
  }

  // Module #15/#17 — show the guest's loyalty card and wallet when linked.
  // The guest_token cookie identifies the dining session server-side.
  let loyalty: CustomerLoyaltySummary | null = null;
  let wallet: Wallet | null = null;

  try {
    const [cardRes, walletRes] = await Promise.all([fetchMyLoyaltyCard(), fetchMyWallet()]);
    loyalty = cardRes.success ? cardRes.card : null;
    wallet = walletRes.success ? walletRes.wallet : null;
  } catch (error) {
    console.error("Failed to load loyalty/wallet for success page:", error);
  }

  const subtotal = order.subtotal || 0;
  const serviceCharge = order.serviceCharge || 0;
  const total = order.totalAmount || 0;
  const taxBreakdown = order.taxBreakdown || [];
  const discountTotal = order.discountTotal || 0;
  const appliedDiscounts = (order.discounts || []) as Array<{
    label?: string;
    couponCode?: string;
    amount?: number;
  }>;
  const discountLabels = appliedDiscounts
    .filter((d) => Number(d.amount) > 0)
    .map((d) => d.label || d.couponCode || "Discount");

  const orderMoreUrl = `/table/${order.table?.tableNumber || ""}`;

  return (
    <div className="min-h-screen flex flex-col bg-background pb-md">
      {/* Header */}
      <TopAppBar title="Order Confirmed" iconName="check_circle" />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[500px] mx-auto px-margin-mobile py-lg flex flex-col items-center text-center justify-between">
        <div className="w-full flex flex-col items-center">
          {/* Animated/Green Check Circle Icon */}
          <div className="w-20 h-20 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-md shadow-[0px_4px_20px_rgba(81,96,79,0.1)]">
            <span className="material-symbols-outlined text-[48px] select-none">
              check_circle
            </span>
          </div>

          <h2 className="font-inter font-semibold text-headline-xl text-on-surface mb-xs">
            Thank You!
          </h2>
          <p className="font-inter font-normal text-body-md text-on-surface-variant mb-lg">
            Your order has been sent to the kitchen and is being prepared.
          </p>

          {couponNotice && (
            <div className="w-full flex items-start gap-2 rounded-xl bg-warning-container px-md py-sm text-body-sm text-on-warning-container mb-md text-left">
              <span className="material-symbols-outlined text-[18px]">sell</span>
              <span>Your coupon wasn&apos;t applied: {couponNotice}</span>
            </div>
          )}

          {/* Details Card */}
          <div className="bg-surface-container-lowest rounded-xl p-md w-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] text-left mb-lg flex flex-col gap-sm border border-surface-container">
            <div className="flex justify-between border-b border-surface-container pb-xs text-body-sm text-on-surface-variant font-inter">
              <span>Order Reference</span>
              <span className="font-semibold text-on-surface font-mono">{order.orderNumber}</span>
            </div>
            <div className="flex justify-between border-b border-surface-container pb-xs text-body-sm text-on-surface-variant font-inter">
              <span>Table</span>
              <span className="font-semibold text-on-surface">Table {order.table?.tableNumber || "N/A"}</span>
            </div>
            
            {/* Ordered Items summary list */}
            <div className="flex flex-col gap-xs py-1 border-b border-surface-container">
              <span className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider mb-1">Items Summary</span>
              {order.items?.map((item, idx) => (
                <div key={idx} className="flex justify-between text-body-sm text-on-surface font-inter">
                  <span>{item.name} <span className="text-on-surface-variant">x{item.quantity}</span></span>
                  <span>{formatCurrency(Number(item.price) * item.quantity)}</span>
                </div>
              ))}
            </div>

            {/* Financial Breakdown */}
            <div className="flex flex-col gap-xs py-1 border-b border-surface-container text-body-sm text-on-surface-variant font-inter">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              {taxBreakdown.map((tax, idx) => (
                <div key={idx} className="flex justify-between">
                  <span>GST ({tax.percentage}%)</span>
                  <span>{formatCurrency(tax.amount)}</span>
                </div>
              ))}
              {discountTotal > 0 && (
                <div className="flex justify-between">
                  <span>Discount{discountLabels.length ? ` (${discountLabels.join(", ")})` : ""}</span>
                  <span className="text-primary">−{formatCurrency(discountTotal)}</span>
                </div>
              )}
              {serviceCharge > 0 && (
                <div className="flex justify-between">
                  <span>Service Charge</span>
                  <span>{formatCurrency(serviceCharge)}</span>
                </div>
              )}
            </div>

            <div className="flex justify-between text-body-md text-on-surface-variant font-inter pt-xs">
              <span>Total Amount</span>
              <span className="font-semibold text-primary">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Module #16 — scratch card reveal (client component, guest scoped) */}
        <ScratchReveal />

        {/* Module #18 — rating prompt with an AI Google-review draft */}
        <RatingPrompt orderId={order.id} />

        {/* Module #15 — loyalty stamp card */}
        {loyalty && loyalty.stampsRequired > 0 && (
          <div className="bg-surface-container-lowest rounded-xl p-md w-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] text-left mb-lg border border-surface-container">
            <div className="flex items-center gap-xs mb-sm">
              <span className="material-symbols-outlined text-primary text-[20px]">loyalty</span>
              <span className="font-inter font-semibold text-body-md text-on-surface">Your Stamps</span>
            </div>
            <div className="flex flex-wrap gap-xs">
              {Array.from({ length: loyalty.stampsRequired }).map((_, i) => (
                <span
                  key={i}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-body-sm ${
                    i < loyalty.stamps ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant/50"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {i < loyalty.stamps ? "star" : "circle"}
                  </span>
                </span>
              ))}
            </div>
            <p className="font-inter text-body-sm text-on-surface-variant mt-sm">
              {loyalty.stamps} of {loyalty.stampsRequired} stamps collected
              {loyalty.activeVouchers?.length > 0 ? ` · ${loyalty.activeVouchers.length} reward(s) ready` : ""}
            </p>
          </div>
        )}

        {/* Module #17 — wallet balance */}
        {wallet && Number(wallet.balance) > 0 && (
          <div className="bg-surface-container-lowest rounded-xl p-md w-full shadow-[0px_4px_20px_rgba(0,0,0,0.04)] text-left mb-lg border border-surface-container flex items-center justify-between">
            <div className="flex items-center gap-xs">
              <span className="material-symbols-outlined text-primary text-[20px]">account_balance_wallet</span>
              <span className="font-inter font-semibold text-body-md text-on-surface">Wallet Balance</span>
            </div>
            <span className="font-inter font-bold text-body-lg text-primary">{formatCurrency(Number(wallet.balance))}</span>
          </div>
        )}

        {/* Actions */}
        <div className="w-full flex flex-col gap-sm">
          <Link href={`/order/${order.id}`} passHref className="w-full">
            <Button variant="primary" fullWidth className="h-12">
              Track Order Status
            </Button>
          </Link>
          <Link href={orderMoreUrl} passHref className="w-full">
            <Button variant="secondary" fullWidth className="h-12">
              Order More
            </Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
