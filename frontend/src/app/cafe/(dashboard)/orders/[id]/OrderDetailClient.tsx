"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Order, OrderStatus } from "@/types";
import type { StaffOrderItem } from "@/lib/mappers";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { updateOrderStatus, cancelOrderItem } from "@/actions/orders";
import { formatDateTime } from "@/lib/format";
import { formatCurrency } from "@/utils/currency";
import { Modal } from "@/components/common/Modal";
import { useState } from "react";

/**
 * An order as the detail screen needs it.
 *
 * `Omit<Order, "items">` rather than `Order & {...}`: intersecting two `items`
 * declarations does not narrow the element type, so the per-item fields the
 * screen reads (`status`, `cancellationReason`) stayed invisible. The page maps
 * through the staff variant, which is what makes them present.
 */
export type OrderForDetail = Omit<Order, "items"> & {
  acceptedAt?: Date | null;
  preparingAt?: Date | null;
  readyAt?: Date | null;
  servedAt?: Date | null;
  cancelledAt?: Date | null;
  items?: StaffOrderItem[];
};

interface OrderDetailClientProps {
  order: OrderForDetail;
}

export const OrderDetailClient: React.FC<OrderDetailClientProps> = ({ order }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [cancellingItem, setCancellingItem] = useState<{ id: string; name: string } | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");

  const handleStatusChange = (newStatus: OrderStatus) => {
    startTransition(async () => {
      try {
        await updateOrderStatus(order.id, newStatus);
        router.refresh();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to update order status"));
      }
    });
  };

  const handleCancelItem = async () => {
    if (!cancellingItem || !cancellationReason) return;
    
    startTransition(async () => {
      try {
        await cancelOrderItem(order.id, cancellingItem.id, cancellationReason);
        setCancellingItem(null);
        setCancellationReason("");
        router.refresh();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to cancel item"));
      }
    });
  };

  const subtotal = order.subtotal || 0;
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
            <span className="text-on-surface font-medium">{formatDateTime(order.createdAt)}</span>
          </div>
          {order.acceptedAt && (
            <div className="flex justify-between">
              <span>Accepted At</span>
              <span className="text-on-surface font-medium">{formatDateTime(order.acceptedAt)}</span>
            </div>
          )}
          {order.preparingAt && (
            <div className="flex justify-between">
              <span>Started Preparing At</span>
              <span className="text-on-surface font-medium">{formatDateTime(order.preparingAt)}</span>
            </div>
          )}
          {order.readyAt && (
            <div className="flex justify-between">
              <span>Ready for Service At</span>
              <span className="text-on-surface font-medium">{formatDateTime(order.readyAt)}</span>
            </div>
          )}
          {order.servedAt && (
            <div className="flex justify-between">
              <span>Served At</span>
              <span className="text-on-surface font-medium">{formatDateTime(order.servedAt)}</span>
            </div>
          )}
          {order.cancelledAt && (
            <div className="flex justify-between">
              <span>Cancelled At</span>
              <span className="text-error font-medium">{formatDateTime(order.cancelledAt)}</span>
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
              <div key={item.id} className="flex flex-col border-b border-surface-container pb-sm last:border-0">
                <div className="flex justify-between items-start text-body-md text-on-surface font-inter">
                  <div className="flex flex-col flex-1 pr-4">
                    <span className="font-medium">
                      {item.name || "Unknown Item"} <span className="text-on-surface-variant font-semibold">x{item.quantity}</span>
                    </span>
                    {item.status === 'cancelled' && (
                      <span className="text-error text-body-sm mt-xs">
                        Cancelled: {item.cancellationReason}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-xs">
                    <span className={`shrink-0 font-semibold ${item.status === 'cancelled' ? 'line-through text-on-surface-variant' : ''}`}>
                      {formatCurrency(Number(item.price) * item.quantity)}
                    </span>
                    {item.status !== 'cancelled' && !['CANCELLED', 'SERVED'].includes(order.status) && (
                      <button
                        onClick={() => {
                          console.log("Cancelling item:", item);
                          // The backend matches on the item's own `_id` first and
                          // falls back to `menuItemId` for pre-id items, so the
                          // id the mapper produced is exactly what it needs.
                          setCancellingItem({ id: item.id, name: item.name ?? "Unknown Item" });
                        }}
                        className="text-error text-label-sm font-semibold hover:underline cursor-pointer"
                        disabled={isPending}
                      >
                        Item Unavailable
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-surface-container pt-sm flex flex-col gap-xs text-body-sm text-on-surface-variant">
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

      {cancellingItem && (
        <Modal
          isOpen={true}
          onClose={() => {
            setCancellingItem(null);
            setCancellationReason("");
          }}
          title="Item Unavailable"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              Why is <strong>{cancellingItem.name}</strong> unavailable?
            </p>
            <select
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            >
              <option value="">Select a reason</option>
              <option value="Out Of Stock">Out Of Stock</option>
              <option value="Ingredient Missing">Ingredient Missing</option>
              <option value="Machine Failure">Machine Failure</option>
              <option value="Other">Other</option>
            </select>
            <div className="flex justify-end gap-sm mt-sm">
              <Button
                variant="secondary"
                onClick={() => {
                  setCancellingItem(null);
                  setCancellationReason("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCancelItem}
                disabled={!cancellationReason || isPending}
                className="bg-error hover:bg-error/90 text-on-error"
              >
                Confirm Cancellation
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default OrderDetailClient;
