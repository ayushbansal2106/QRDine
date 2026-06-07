"use client";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Order, OrderStatus } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { updateOrderStatus } from "@/actions/orders";
import { formatCurrency } from "@/utils/currency";

interface OrderDetailClientProps {
  order: Order & {
    acceptedAt?: Date | null;
    preparingAt?: Date | null;
    readyAt?: Date | null;
    servedAt?: Date | null;
    cancelledAt?: Date | null;
  };
}

export const OrderDetailClient: React.FC<OrderDetailClientProps> = ({ order }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleStatusChange = (newStatus: OrderStatus) => {
    startTransition(async () => {
      try {
        await updateOrderStatus(order.id, newStatus);
        router.refresh();
      } catch (err: any) {
        alert(err.message || "Failed to update order status");
      }
    });
  };

  const subtotal = order.subtotal || 0;
  const totalGST = order.totalGST || 0;
  const serviceCharge = order.serviceCharge || 0;
  const total = order.totalAmount || 0;
  const taxBreakdown = order.taxBreakdown || [];

  const getStatusColor = (s: string) => {
    switch (s) {
      case "PENDING":
        return "bg-surface-container text-on-surface";
      case "ACCEPTED":
        return "bg-primary/20 text-primary";
      case "PREPARING":
        return "bg-amber-100 text-amber-800";
      case "READY":
        return "bg-emerald-100 text-emerald-800";
      case "SERVED":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-error/10 text-error";
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Header */}
      <TopAppBar title="Order Details" showBack />

      <main className="max-w-[800px] w-full mx-auto px-margin-mobile py-md flex flex-col gap-md">
        {/* Top Info Banner */}
        <div className="flex justify-between items-center bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container">
          <div className="flex flex-col">
            <span className="text-body-sm text-on-surface-variant font-medium">Order Reference</span>
            <span className="font-mono font-semibold text-body-lg text-on-surface">{order.orderNumber}</span>
          </div>
          <span className={`px-md py-xs rounded-full font-semibold text-label-sm ${getStatusColor(order.status)}`}>
            {order.status}
          </span>
        </div>

        {/* Action Controls for Admin */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container flex flex-col gap-sm">
          <h3 className="font-semibold text-body-lg text-on-surface border-b border-surface-container pb-xs">
            Manage Order Progression
          </h3>
          <div className="flex flex-wrap gap-sm pt-xs">
            {order.status === "PENDING" && (
              <>
                <Button
                  onClick={() => handleStatusChange("ACCEPTED")}
                  disabled={isPending}
                  variant="primary"
                  className="h-10 px-md"
                >
                  Accept Order
                </Button>
                <Button
                  onClick={() => handleStatusChange("CANCELLED")}
                  disabled={isPending}
                  variant="secondary"
                  className="h-10 px-md text-error hover:bg-error/5 border-error/20"
                >
                  Cancel Order
                </Button>
              </>
            )}

            {order.status === "ACCEPTED" && (
              <Button
                onClick={() => handleStatusChange("PREPARING")}
                disabled={isPending}
                variant="primary"
                className="h-10 px-md bg-amber-600 hover:bg-amber-700"
              >
                Start Preparing
              </Button>
            )}

            {order.status === "PREPARING" && (
              <Button
                onClick={() => handleStatusChange("READY")}
                disabled={isPending}
                variant="primary"
                className="h-10 px-md bg-emerald-600 hover:bg-emerald-700"
              >
                Mark as Ready
              </Button>
            )}

            {order.status === "READY" && (
              <Button
                onClick={() => handleStatusChange("SERVED")}
                disabled={isPending}
                variant="primary"
                className="h-10 px-md bg-blue-600 hover:bg-blue-700"
              >
                Mark as Served
              </Button>
            )}

            {order.status === "SERVED" && (
              <span className="text-body-md text-on-surface-variant/60 italic">
                This order has been successfully served. No further actions required.
              </span>
            )}

            {order.status === "CANCELLED" && (
              <span className="text-body-md text-error italic">
                This order has been cancelled.
              </span>
            )}
          </div>
        </div>

        {/* Timestamps Card */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container flex flex-col gap-xs text-body-sm text-on-surface-variant">
          <h3 className="font-semibold text-body-lg text-on-surface border-b border-surface-container pb-xs mb-xs">
            Timestamps Timeline
          </h3>
          <div className="flex justify-between">
            <span>Order Created</span>
            <span className="text-on-surface font-medium">{new Date(order.createdAt).toLocaleString()}</span>
          </div>
          {order.acceptedAt && (
            <div className="flex justify-between">
              <span>Accepted At</span>
              <span className="text-on-surface font-medium">{new Date(order.acceptedAt).toLocaleString()}</span>
            </div>
          )}
          {order.preparingAt && (
            <div className="flex justify-between">
              <span>Started Preparing At</span>
              <span className="text-on-surface font-medium">{new Date(order.preparingAt).toLocaleString()}</span>
            </div>
          )}
          {order.readyAt && (
            <div className="flex justify-between">
              <span>Ready for Service At</span>
              <span className="text-on-surface font-medium">{new Date(order.readyAt).toLocaleString()}</span>
            </div>
          )}
          {order.servedAt && (
            <div className="flex justify-between">
              <span>Served At</span>
              <span className="text-on-surface font-medium">{new Date(order.servedAt).toLocaleString()}</span>
            </div>
          )}
          {order.cancelledAt && (
            <div className="flex justify-between">
              <span>Cancelled At</span>
              <span className="text-error font-medium">{new Date(order.cancelledAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Ordered items details */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container flex flex-col gap-sm">
          <h3 className="font-semibold text-body-lg text-on-surface border-b border-surface-container pb-xs">
            Items List
          </h3>
          <div className="flex flex-col gap-sm">
            {order.items?.map((item) => (
              <div key={item.id} className="flex justify-between items-center text-body-md text-on-surface font-inter">
                <span className="truncate pr-4">
                  {item.name || "Unknown Item"} <span className="text-on-surface-variant font-semibold">x{item.quantity}</span>
                </span>
                <span className="shrink-0 font-semibold">
                  {formatCurrency(Number(item.price) * item.quantity)}
                </span>
              </div>
            ))}
          </div>

          <div className="border-t border-surface-container pt-sm flex flex-col gap-xs text-body-sm text-on-surface-variant">
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
            <div className="flex justify-between text-body-lg font-semibold text-primary border-t border-surface-container pt-xs mt-xs">
              <span>Total Bill</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container">
            <h3 className="font-semibold text-body-lg text-on-surface mb-xs">
              Preparation Remarks
            </h3>
            <p className="text-body-md text-on-surface-variant italic font-normal">
              &quot;{order.notes}&quot;
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

export default OrderDetailClient;
