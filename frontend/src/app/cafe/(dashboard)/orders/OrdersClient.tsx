"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSyncedState } from "@/hooks/useSyncedState";
import { Order, OrderStatus, OrderType } from "@/types";
import { OrderStatusColumn } from "@/components/admin/OrderStatusColumn";
import { useSocketStore } from "@/store/socketStore";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { OfflineBanner } from "@/components/admin/OfflineBanner";
import { playOrderDing } from "@/lib/orderAudio";
import {
  asOrderStatusPayload,
  asRawOrderPayload,
  mapRawOrder,
  toOrderStatus,
} from "@/lib/mappers";

interface OrdersClientProps {
  initialOrders: Order[];
  cafeId: string;
  /** True when the server page was reached via `?denied=1` from the route guard. */
  accessDenied: boolean;
}

export const OrdersClient: React.FC<OrdersClientProps> = ({
  initialOrders,
  cafeId,
  accessDenied,
}) => {
  const router = useRouter();
  const [orders, setOrders] = useSyncedState<Order[]>(initialOrders);
  const [typeFilter, setTypeFilter] = useState<"all" | OrderType>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | string>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const { connect, disconnect, socket, isConnected, joinRoom, leaveRoom } = useSocketStore();
  const prevConnectedRef = useRef(isConnected);

  // Trigger state reconciliation when socket reconnects
  useEffect(() => {
    if (!prevConnectedRef.current && isConnected) {
      console.log("Orders Board socket reconnected: reconciling state via router.refresh()");
      router.refresh();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, router]);

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

  // Set up real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleNewOrder = (payload: unknown) => {
      console.log("Real-time: New order received via socket", payload);
      // Untrusted input: drop anything that is not an order document rather
      // than rendering a card keyed on `undefined`.
      const dbOrder = asRawOrderPayload(payload);
      if (!dbOrder) return;
      const mapped = mapRawOrder(dbOrder);
      let isNew = false;
      setOrders((prev) => {
        if (prev.some((o) => o.id === mapped.id)) return prev;
        isNew = true;
        return [mapped, ...prev];
      });
      // Module #03 — the payload says whether to make a sound; a flagged order
      // gets a different tone so the manager hears "check this one".
      const meta = dbOrder.meta;
      if (isNew && meta?.sound !== false) {
        playOrderDing(meta?.flagged ? "flagged" : "normal");
      }
    };

    const handleLocalOrderStatusUpdate = (orderId: string, status: OrderStatus) => {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status } : o))
      );
    };

    const handleStatusUpdatedEvent = (payload: unknown) => {
      console.log("Real-time: Order status updated event received", payload);
      const event = asOrderStatusPayload(payload);
      if (event) {
        handleLocalOrderStatusUpdate(event.orderId, toOrderStatus(event.status));
      }
    };

    const handleSpecificStatusEvent =
      (status: OrderStatus) => (payload: unknown) => {
        console.log(`Real-time: Specific order status event (${status}) received`, payload);
        const event = asOrderStatusPayload(payload);
        if (event) {
          handleLocalOrderStatusUpdate(event.orderId, status);
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
  }, [socket, setOrders]);

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

  // Group orders by status, respecting the omnichannel type filter
  const getOrdersByStatus = (status: string) => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesStatus = order.status === status;
      const matchesType = typeFilter === "all" || order.orderType === typeFilter;
      const matchesChannel = channelFilter === "all" || order.channel === channelFilter;
      const matchesPayment = paymentFilter === "all" || order.paymentStatus === paymentFilter;
      const matchesSearch =
        query.length === 0 ||
        order.orderNumber?.toLowerCase().includes(query) ||
        String(order.table?.tableNumber ?? "").includes(query) ||
        (order.items || []).some((item) => item.name?.toLowerCase().includes(query));
      return matchesStatus && matchesType && matchesChannel && matchesPayment && matchesSearch;
    });
  };

  const handleOrderChange = () => {
    // If dragging/updating triggers a local action that triggers router.refresh(), we also trigger it locally
    router.refresh();
  };

  // The route guard redirects operators who lack a page's permission to
  // /admin/orders?denied=1. Surface why, instead of a silent bounce.
  //
  // `accessDenied` arrives as a prop from the server page, which read the
  // query string. Reading `window.location.search` here instead would render
  // `null` on the server and the notice on the client — a hydration mismatch —
  // and an effect-based read rendered the board without the explanation before
  // immediately re-rendering with it.
  //
  // The notice is dismissible, so it cannot be derived from the prop alone —
  // `dismissed` is the user's answer to "do not show this again on this
  // render". It is seeded from `accessDenied` and re-armed when a new denial
  // arrives, which is why this is a render-time adjustment rather than an
  // effect that copies the prop into state.
  const [dismissed, setDismissed] = useState(!accessDenied);
  const [seededAccess, setSeededAccess] = useState(accessDenied);
  if (seededAccess !== accessDenied) {
    setSeededAccess(accessDenied);
    setDismissed(!accessDenied);
  }
  const deniedNotice =
    accessDenied && !dismissed
      ? "You don't have permission to open that page. Ask an owner or manager to grant access."
      : null;

  // Clean the URL so a refresh does not re-show the notice. This is a side
  // effect on history, so an effect is the right tool.
  useEffect(() => {
    if (accessDenied) {
      router.replace("/cafe/orders", { scroll: false });
    }
  }, [accessDenied, router]);

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg">
      {deniedNotice && (
        <div
          role="status"
          className="mx-margin-desktop mt-md flex items-center gap-sm rounded-lg border border-surface-container bg-surface-container-low px-md py-sm text-body-sm font-semibold text-on-surface"
        >
          <span className="material-symbols-outlined text-[18px]">lock</span>
          <span className="flex-1">{deniedNotice}</span>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-on-surface-variant hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}
      {/* Header */}
      <TopAppBar title="Active Orders Board" iconName="assignment" showStatusBadge={true} />
      <OfflineBanner onSync={() => router.refresh()} />

      {/* Omnichannel type tabs */}
      <div className="px-md pt-md flex flex-wrap items-center gap-xs">
        {(["all", "dine_in", "takeaway", "delivery"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`px-md py-xs rounded-full text-body-sm font-semibold capitalize transition-colors ${
              typeFilter === type
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {type.replace("_", "-")}
          </button>
        ))}

        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          aria-label="Filter by channel"
          className="px-sm py-xs rounded-full text-body-sm font-semibold bg-surface-container text-on-surface-variant"
        >
          <option value="all">Any channel</option>
          <option value="qr">QR</option>
          <option value="pos">POS</option>
          <option value="waiter">Waiter</option>
          <option value="online">Online</option>
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          aria-label="Filter by payment status"
          className="px-sm py-xs rounded-full text-body-sm font-semibold bg-surface-container text-on-surface-variant"
        >
          <option value="all">Any payment</option>
          <option value="unpaid">Unpaid</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
          <option value="partially_refunded">Part refunded</option>
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Order no., table or item"
          aria-label="Search orders"
          className="flex-1 min-w-[180px] px-sm py-xs rounded-full text-body-sm bg-surface-container text-on-surface placeholder-on-surface-variant/50"
        />
      </div>

      {/* Columns Container */}
      <main className="flex-1 p-md flex gap-md overflow-x-auto items-start">
        <OrderStatusColumn
          title="Pending"
          orders={getOrdersByStatus("PENDING")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Accepted"
          orders={getOrdersByStatus("ACCEPTED")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Preparing"
          orders={getOrdersByStatus("PREPARING")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Ready"
          orders={getOrdersByStatus("READY")}
          onOrderUpdated={handleOrderChange}
        />
        <OrderStatusColumn
          title="Served"
          orders={getOrdersByStatus("SERVED")}
          onOrderUpdated={handleOrderChange}
        />
      </main>
    </div>
  );
};
export default OrdersClient;
