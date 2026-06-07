"use client";

import React, { useEffect, useState } from "react";
import { Order, OrderStatus } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { OrderStatusTracker } from "@/components/order/OrderStatusTracker";
import { useSocketStore } from "@/store/socketStore";
import { Button } from "@/components/common/Button";
import Link from "next/link";
import { getPublicOrderAction, getPublicOrderStatusAction } from "@/actions/orders";
import { formatCurrency } from "@/utils/currency";

interface OrderTrackingClientProps {
  initialOrder: Order;
}

export const OrderTrackingClient: React.FC<OrderTrackingClientProps> = ({
  initialOrder,
}) => {
  const [order, setOrder] = useState<Order>(initialOrder);
  const { connect, disconnect, socket, isConnected, joinRoom, leaveRoom } = useSocketStore();

  // 1. WebSocket Connection Setup
  useEffect(() => {
    connect();
    joinRoom(`order-${order.id}`);
    return () => {
      leaveRoom(`order-${order.id}`);
      disconnect();
    };
  }, [connect, disconnect, joinRoom, leaveRoom, order.id]);

  // 2. WebSocket Live Synchronization
  useEffect(() => {
    if (!socket) return;

    const handleStatusUpdate = (payload: any) => {
      const receivedOrderId = payload?.orderId || payload?.id;
      if (receivedOrderId === order.id) {
        console.log("Live websocket order update received:", payload);
        // Refresh full order details to ensure items/totals sync
        getPublicOrderAction(order.id)
          .then((res) => {
            if (res.success && res.order) {
              setOrder(res.order);
            }
          })
          .catch((err) => console.error("Websocket sync details fetch failed:", err));
      }
    };

    socket.on("status-updated", handleStatusUpdate);
    socket.on("order-updated", handleStatusUpdate);

    return () => {
      socket.off("status-updated", handleStatusUpdate);
      socket.off("order-updated", handleStatusUpdate);
    };
  }, [socket, order.id]);

  // 3. 15-Second Lightweight Polling Fallback (Runs only when socket is disconnected)
  useEffect(() => {
    if (isConnected) return;

    console.log("Customer tracking socket disconnected. Enabling 15s polling fallback.");
    const intervalId = setInterval(async () => {
      try {
        const res = await getPublicOrderStatusAction(order.id);
        if (res.success && res.status && res.status !== order.status) {
          console.log(`Polling status updated: ${order.status} -> ${res.status}. Loading details...`);
          const detailRes = await getPublicOrderAction(order.id);
          if (detailRes.success && detailRes.order) {
            setOrder(detailRes.order);
          }
        }
      } catch (err) {
        console.error("Failed to poll order status:", err);
      }
    }, 15000);

    return () => {
      clearInterval(intervalId);
    };
  }, [order.id, order.status, isConnected]);

  const subtotal = order.subtotal || 0;
  const totalGST = order.totalGST || 0;
  const serviceCharge = order.serviceCharge || 0;
  const total = order.totalAmount || 0;
  const taxBreakdown = order.taxBreakdown || [];

  return (
    <div className="min-h-screen flex flex-col bg-background pb-md">
      {/* Header */}
      <TopAppBar
        title="Track Order"
        showBack
        iconName="hourglass_top"
        showStatusBadge={true}
      />

      {/* Main Content */}
      <main className="flex-1 w-full max-w-[600px] mx-auto px-margin-mobile py-md flex flex-col justify-between">
        <div>
          {/* Order Details Banner */}
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-md border border-surface-container">
            <div className="flex justify-between items-center mb-xs">
              <span className="font-inter font-semibold text-body-lg text-on-surface">
                Order Reference: {order.orderNumber}
              </span>
              <span className="font-inter font-semibold text-label-sm px-sm py-xs bg-primary/10 text-primary rounded-full">
                Table {order.table?.tableNumber || "N/A"}
              </span>
            </div>
            <p className="font-inter text-body-sm text-on-surface-variant">
              Placed on {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          {/* Status Tracker */}
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] mb-md border border-surface-container">
            <OrderStatusTracker status={order.status} />
          </div>

          {/* Pricing Recap */}
          <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] flex flex-col gap-xs mb-lg font-inter border border-surface-container">
            <span className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider mb-1">Ordered Items</span>
            {order.items?.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between text-body-sm text-on-surface-variant">
                <span>{item.name} <span className="text-on-surface-variant/60 font-semibold">x{item.quantity}</span></span>
                <span>{formatCurrency(Number(item.price) * item.quantity)}</span>
              </div>
            ))}
            
            <div className="border-t border-surface-container mt-2 pt-2 flex justify-between text-body-sm text-on-surface-variant">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {taxBreakdown.map((tax: any, idx: number) => (
              <div key={idx} className="flex justify-between text-body-sm text-on-surface-variant">
                <span>GST ({tax.percentage}%)</span>
                <span>{formatCurrency(tax.amount)}</span>
              </div>
            ))}
            {serviceCharge > 0 && (
              <div className="flex justify-between text-body-sm text-on-surface-variant">
                <span>Service Charge</span>
                <span>{formatCurrency(serviceCharge)}</span>
              </div>
            )}
            <div className="flex justify-between text-body-md font-semibold text-on-surface border-t border-surface-container pt-xs mt-xs">
              <span>Total Bill</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        {/* Back Actions */}
        <Link href={`/table/${order.table?.tableNumber || ""}`} passHref className="w-full">
          <Button variant="secondary" fullWidth className="h-12">
            Back to Menu
          </Button>
        </Link>
      </main>
    </div>
  );
};

export default OrderTrackingClient;
