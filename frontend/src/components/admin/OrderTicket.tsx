"use client";

import React, { useTransition } from "react";
import { Order, OrderStatus } from "@/types";
import { updateOrderStatus } from "@/actions/orders";
import Link from "next/link";
import { formatCurrency } from "@/utils/currency";

interface OrderTicketProps {
  order: Order;
  onStatusUpdated?: () => void;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  order,
  onStatusUpdated,
}) => {
  const [isPending, startTransition] = useTransition();

  const getNextStatus = (currentStatus: OrderStatus): OrderStatus | null => {
    switch (currentStatus) {
      case "PENDING":
        return "ACCEPTED";
      case "ACCEPTED":
        return "PREPARING";
      case "PREPARING":
        return "READY";
      case "READY":
        return "SERVED";
      default:
        return null;
    }
  };

  const getStatusActionLabel = (currentStatus: OrderStatus): string => {
    switch (currentStatus) {
      case "PENDING":
        return "Accept";
      case "ACCEPTED":
        return "Start Prep";
      case "PREPARING":
        return "Mark Ready";
      case "READY":
        return "Mark Served";
      default:
        return "";
    }
  };

  const handleAdvanceStatus = () => {
    const nextStatus = getNextStatus(order.status);
    if (!nextStatus) return;

    startTransition(async () => {
      try {
        await updateOrderStatus(order.id, nextStatus);
        if (onStatusUpdated) onStatusUpdated();
      } catch (err) {
        console.error(err);
        alert("Failed to update status");
      }
    });
  };

  const handleCancelOrder = () => {
    if (!confirm("Are you sure you want to cancel this order?")) return;

    startTransition(async () => {
      try {
        await updateOrderStatus(order.id, "CANCELLED");
        if (onStatusUpdated) onStatusUpdated();
      } catch (err) {
        console.error(err);
        alert("Failed to cancel order");
      }
    });
  };

  const nextStatus = getNextStatus(order.status);
  const total = Number(order.totalAmount); // Database total already includes tax

  return (
    <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.02)] border border-surface-container hover:shadow-[0px_8px_24px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col gap-sm font-inter">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-surface-container pb-xs">
        <div className="flex flex-col">
          <span className="font-semibold text-body-lg text-on-surface">
            Table {order.table?.tableNumber || "N/A"}
          </span>
          {order.placedByName && (
            <span className="text-body-sm text-on-surface-variant flex items-center gap-[4px]">
              <span className="material-symbols-outlined text-[16px]">person</span>
              {order.placedByName}
            </span>
          )}
        </div>
        <span className="text-body-sm text-on-surface-variant font-mono">
          #{order.id.slice(0, 4).toUpperCase()}
        </span>
      </div>

      {/* Items preview */}
      <div className="flex flex-col gap-xs max-h-[80px] overflow-y-auto">
        {order.items?.map((item) => (
          <div key={item.id} className="text-body-sm text-on-surface flex justify-between">
            <span className="truncate pr-sm">
              {item.name || item.menuItem?.name || "Unknown Item"} <span className="text-on-surface-variant font-semibold">x{item.quantity}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Note preview */}
      {order.notes && (
        <div className="bg-surface-container-low text-on-surface-variant/80 rounded px-xs py-base text-body-sm font-normal italic truncate">
          Note: "{order.notes}"
        </div>
      )}

      {/* Footer */}
      <div className="flex justify-between items-center border-t border-surface-container pt-xs mt-xs">
        <span className="font-semibold text-body-md text-primary">
          {formatCurrency(total)}
        </span>
        <div className="flex gap-xs">
          <Link href={`/admin/orders/${order.id}`} passHref>
            <button
              aria-label="Inspect ticket"
              className="px-sm py-base rounded-full bg-surface-container-high hover:bg-surface-container text-on-surface text-body-sm font-semibold cursor-pointer"
            >
              Details
            </button>
          </Link>
          {nextStatus && (
            <button
              onClick={handleAdvanceStatus}
              disabled={isPending}
              className="px-sm py-base rounded-full bg-primary text-on-primary hover:bg-primary-container text-body-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {getStatusActionLabel(order.status)}
            </button>
          )}
        </div>
      </div>
      {order.status === "PENDING" && (
        <button
          onClick={handleCancelOrder}
          disabled={isPending}
          className="text-error text-body-sm font-semibold hover:underline text-left mt-xs cursor-pointer self-start"
        >
          Cancel Order
        </button>
      )}
    </div>
  );
};
export default OrderTicket;
