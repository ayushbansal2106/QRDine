"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Order, OrderStatus } from "@/types";
import { OrderStatusColumn } from "@/components/admin/OrderStatusColumn";
import { useSocketStore } from "@/store/socketStore";
import { TopAppBar } from "@/components/layout/TopAppBar";

interface OrdersClientProps {
  initialOrders: Order[];
  cafeId: string;
}

const mapDbOrderToOrder = (order: any): Order => ({
  id: order._id || order.id,
  tableId: order.tableId?._id || order.tableId || "",
  table: order.tableId && typeof order.tableId === "object" ? {
    id: order.tableId._id,
    tableNumber: parseInt(order.tableId.tableNumber, 10) || 0,
    qrCodeUrl: order.tableId.qrCodeUrl || `/table/${order.tableId.tableNumber}`,
    status: order.tableId.isActive ? "FREE" : ("ASSISTANCE_REQUIRED" as any),
    createdAt: new Date(order.tableId.createdAt),
  } : undefined,
  status: (order.status || "PENDING").toUpperCase() as OrderStatus,
  totalAmount: Number(order.totalAmount),
  notes: order.notes || "",
  createdAt: new Date(order.createdAt),
  orderNumber: order.orderNumber || "",
  items: (order.items || []).map((item: any, idx: number) => ({
    id: item._id || String(idx),
    menuItemId: item.menuItemId,
    quantity: item.quantity,
    price: Number(item.price),
    name: item.itemName || "Unknown Item",
  })),
});

export const OrdersClient: React.FC<OrdersClientProps> = ({ initialOrders, cafeId }) => {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const { connect, disconnect, socket, isConnected, joinRoom, leaveRoom } = useSocketStore();

  // Connect & Join room
  useEffect(() => {
    connect();
    if (cafeId) {
      joinRoom(`cafe-${cafeId}`);
    }
    return () => {
      if (cafeId) {
        leaveRoom(`cafe-${cafeId}`);
      }
      disconnect();
    };
  }, [connect, disconnect, joinRoom, leaveRoom, cafeId]);

  // Sync initialOrders from server updates (if pages refresh)
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  // Set up real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewOrder = (dbOrder: any) => {
      console.log("Real-time: New order received via socket", dbOrder);
      const mapped = mapDbOrderToOrder(dbOrder);
      setOrders((prev) => {
        if (prev.some((o) => o.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    };

    const handleLocalOrderStatusUpdate = (orderId: string, status: string) => {
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, status: status.toUpperCase() as OrderStatus } : o
        )
      );
    };

    const handleStatusUpdatedEvent = (payload: any) => {
      console.log("Real-time: Order status updated event received", payload);
      if (payload && payload.orderId && payload.status) {
        handleLocalOrderStatusUpdate(payload.orderId, payload.status);
      }
    };

    const handleSpecificStatusEvent = (statusStr: string) => (payload: any) => {
      console.log(`Real-time: Specific order status event (${statusStr}) received`, payload);
      if (payload && payload.orderId) {
        handleLocalOrderStatusUpdate(payload.orderId, statusStr);
      }
    };

    socket.on("new-order", handleNewOrder);
    socket.on("order-created", handleNewOrder);
    socket.on("status-updated", handleStatusUpdatedEvent);
    socket.on("order-accepted", handleSpecificStatusEvent("ACCEPTED"));
    socket.on("order-preparing", handleSpecificStatusEvent("PREPARING"));
    socket.on("order-ready", handleSpecificStatusEvent("READY"));
    socket.on("order-served", handleSpecificStatusEvent("SERVED"));

    return () => {
      socket.off("new-order", handleNewOrder);
      socket.off("order-created", handleNewOrder);
      socket.off("status-updated", handleStatusUpdatedEvent);
      socket.off("order-accepted", handleSpecificStatusEvent("ACCEPTED"));
      socket.off("order-preparing", handleSpecificStatusEvent("PREPARING"));
      socket.off("order-ready", handleSpecificStatusEvent("READY"));
      socket.off("order-served", handleSpecificStatusEvent("SERVED"));
    };
  }, [socket]);

  // Polling fallback when disconnected
  useEffect(() => {
    if (isConnected) return;

    console.log("Orders Board socket disconnected. Enabling 15s polling fallback.");
    const interval = setInterval(() => {
      console.log("Polling active orders...");
      router.refresh();
    }, 15000);

    return () => clearInterval(interval);
  }, [isConnected, router]);

  // Group orders by status
  const getOrdersByStatus = (status: string) => {
    return orders.filter((order) => order.status === status);
  };

  const handleOrderChange = () => {
    // If dragging/updating triggers a local action that triggers router.refresh(), we also trigger it locally
    router.refresh();
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg">
      {/* Header */}
      <TopAppBar title="Active Orders Board" iconName="assignment" showStatusBadge={true} />

      {/* Columns Container */}
      <main className="flex-1 p-md flex gap-md overflow-x-auto items-start">
        <OrderStatusColumn
          title="Pending"
          status="PENDING"
          orders={getOrdersByStatus("PENDING")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Accepted"
          status="ACCEPTED"
          orders={getOrdersByStatus("ACCEPTED")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Preparing"
          status="PREPARING"
          orders={getOrdersByStatus("PREPARING")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Ready"
          status="READY"
          orders={getOrdersByStatus("READY")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Served"
          status="SERVED"
          orders={getOrdersByStatus("SERVED")}
          onOrderUpdated={handleOrderChange}
        />
      </main>
    </div>
  );
};
export default OrdersClient;
