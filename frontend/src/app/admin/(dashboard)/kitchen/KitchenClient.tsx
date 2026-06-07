"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Order, OrderStatus } from "@/types";
import { updateOrderStatus } from "@/actions/orders";
import { useSocketStore } from "@/store/socketStore";
import { TopAppBar } from "@/components/layout/TopAppBar";

interface KitchenClientProps {
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
    // Include menuItem object for compatibility inside KitchenClient.tsx
    menuItem: {
      id: item.menuItemId,
      name: item.itemName || "Unknown Item",
      price: Number(item.price),
      description: "",
      imageUrl: "",
      available: true,
      gstPercentage: 0,
    }
  })),
});

export const KitchenClient: React.FC<KitchenClientProps> = ({
  initialOrders,
  cafeId,
}) => {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [isPending, startTransition] = useTransition();
  const { connect, disconnect, socket, isConnected, joinRoom, leaveRoom } = useSocketStore();

  // Connect & Join cafe room
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
      console.log("Kitchen: New order received via socket", dbOrder);
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
      console.log("Kitchen: Order status updated event received", payload);
      if (payload && payload.orderId && payload.status) {
        handleLocalOrderStatusUpdate(payload.orderId, payload.status);
      }
    };

    const handleSpecificStatusEvent = (statusStr: string) => (payload: any) => {
      console.log(`Kitchen: Specific order status event (${statusStr}) received`, payload);
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

    console.log("Kitchen Board socket disconnected. Enabling 15s polling fallback.");
    const interval = setInterval(() => {
      console.log("Polling kitchen active orders...");
      router.refresh();
    }, 15000);

    return () => clearInterval(interval);
  }, [isConnected, router]);

  const columns: { title: string; status: OrderStatus; bg: string }[] = [
    { title: "Incoming (Pending)", status: "PENDING", bg: "bg-surface-container-low" },
    { title: "Accepted", status: "ACCEPTED", bg: "bg-primary/5 border border-primary/20" },
    { title: "Preparing", status: "PREPARING", bg: "bg-yellow-500/5 border border-yellow-500/20" },
    { title: "Ready", status: "READY", bg: "bg-green-500/5 border border-green-500/20" },
  ];

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    e.dataTransfer.setData("text/plain", orderId);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetStatus: OrderStatus) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("text/plain");
    if (!orderId) return;

    updateStatus(orderId, targetStatus);
  };

  const updateStatus = (orderId: string, status: OrderStatus) => {
    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, status);
        // Update local state directly & immediately
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status } : o))
        );
        router.refresh();
      } catch (err) {
        console.error(err);
        alert("Failed to update order status");
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Header */}
      <TopAppBar title="Kitchen Order Queue" iconName="countertops" showStatusBadge={true} />

      {/* Kanban Board */}
      <main className="flex-1 p-md flex gap-md overflow-x-auto items-start">
        {columns.map((col) => {
          const colOrders = orders.filter((o) => o.status === col.status);

          return (
            <div
              key={col.status}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.status)}
              className={`flex-1 min-w-[280px] rounded-xl p-sm flex flex-col gap-sm max-h-[80vh] overflow-y-auto ${col.bg}`}
            >
              {/* Header */}
              <div className="flex justify-between items-center px-sm border-b border-surface-container pb-xs mb-xs">
                <span className="font-semibold text-body-lg text-primary">
                  {col.title}
                </span>
                <span className="font-semibold text-label-sm bg-primary/10 text-primary px-sm py-xs rounded-full">
                  {colOrders.length}
                </span>
              </div>

              {/* Tickets List */}
              <div className="flex flex-col gap-sm overflow-y-auto flex-1 pb-sm">
                {colOrders.length > 0 ? (
                  colOrders.map((order) => (
                    <div
                      key={order.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, order.id)}
                      className="bg-surface-container-lowest border border-surface-container p-md rounded-lg shadow-[0px_4px_12px_rgba(0,0,0,0.02)] cursor-grab active:cursor-grabbing hover:shadow-[0px_6px_16px_rgba(0,0,0,0.04)] transition-all duration-150 flex flex-col gap-xs"
                    >
                      <div className="flex justify-between items-center border-b border-surface-container pb-xs mb-xs">
                        <span className="font-semibold text-body-md text-on-surface">
                          Table {order.table?.tableNumber || "N/A"}
                        </span>
                        <span className="text-body-sm text-on-surface-variant font-mono">
                          #{order.id.slice(0, 4).toUpperCase()}
                        </span>
                      </div>

                      {/* Items */}
                      <div className="flex flex-col gap-xs text-body-sm text-on-surface-variant">
                        {order.items?.map((item) => (
                          <div key={item.id} className="flex justify-between">
                            <span>
                              {item.menuItem?.name || item.name}{" "}
                              <span className="font-bold text-on-surface font-mono">
                                x{item.quantity}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Note */}
                      {order.notes && (
                        <div className="bg-surface-container-low text-on-surface-variant text-body-sm p-xs rounded italic border-l-2 border-primary/50 mt-sm">
                          "{order.notes}"
                        </div>
                      )}

                      {/* Quick actions for click/tap devices */}
                      <div className="flex justify-between items-center border-t border-surface-container pt-sm mt-sm">
                        <span className="text-body-sm text-on-surface-variant/40 font-medium">
                          Drag or click
                        </span>
                        <div className="flex gap-xs">
                          {col.status === "PENDING" && (
                            <button
                              onClick={() => updateStatus(order.id, "ACCEPTED")}
                              className="px-sm py-base rounded bg-primary text-on-primary text-body-sm font-semibold cursor-pointer"
                            >
                              Accept
                            </button>
                          )}
                          {col.status === "ACCEPTED" && (
                            <button
                              onClick={() => updateStatus(order.id, "PREPARING")}
                              className="px-sm py-base rounded bg-yellow-500 text-white hover:bg-yellow-600 text-body-sm font-semibold cursor-pointer"
                            >
                              Start Prep
                            </button>
                          )}
                          {col.status === "PREPARING" && (
                            <button
                              onClick={() => updateStatus(order.id, "READY")}
                              className="px-sm py-base rounded bg-green-500 text-white hover:bg-green-600 text-body-sm font-semibold cursor-pointer"
                            >
                              Ready
                            </button>
                          )}
                          {col.status === "READY" && (
                            <button
                              onClick={() => updateStatus(order.id, "SERVED")}
                              className="px-sm py-base rounded bg-blue-500 text-white hover:bg-blue-600 text-body-sm font-semibold cursor-pointer"
                            >
                              Serve
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-xl text-body-sm text-on-surface-variant/30 select-none">
                    Queue empty
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};
export default KitchenClient;
