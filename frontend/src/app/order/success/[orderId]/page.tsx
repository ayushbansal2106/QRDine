import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { getPublicOrderAction } from "@/actions/orders";
import { formatCurrency } from "@/utils/currency";

interface SuccessPageProps {
  params: Promise<{ orderId: string }>;
}

export default async function SuccessPage({ params }: SuccessPageProps) {
  const { orderId } = await params;

  let order: any = null;

  try {
    const res = await getPublicOrderAction(orderId);
    if (res.success) {
      order = res.order;
    }
  } catch (error) {
    console.error("Error loading success order details:", error);
  }

  if (!order) {
    notFound();
  }

  const subtotal = order.subtotal || 0;
  const totalGST = order.totalGST || 0;
  const serviceCharge = order.serviceCharge || 0;
  const total = order.totalAmount || 0;
  const taxBreakdown = order.taxBreakdown || [];

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
              {order.items?.map((item: any, idx: number) => (
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
              {taxBreakdown.map((tax: any, idx: number) => (
                <div key={idx} className="flex justify-between">
                  <span>GST ({tax.percentage}%)</span>
                  <span>{formatCurrency(tax.amount)}</span>
                </div>
              ))}
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
