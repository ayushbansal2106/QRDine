"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSyncedState } from "@/hooks/useSyncedState";
import { Order, OrderStatus } from "@/types";
import { updateOrderStatus } from "@/actions/orders";
import { bumpKdsTicket, updateKdsItemStatus } from "@/actions/kds";
import { useSocketStore } from "@/store/socketStore";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { OfflineBanner } from "@/components/admin/OfflineBanner";
import {
  asKdsItemPayload,
  asRawOrderPayload,
  StaffOrderItem,
  mapRawOrderForStaff,
} from "@/lib/mappers";
import { playOrderDing } from "@/lib/orderAudio";

interface KitchenClientProps {
  initialOrders: Order[];
  cafeId: string;
}

type Station = "all" | "kitchen" | "bar";

const elapsedLabel = (createdAt: Date | string) => {
  const secs = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
};

// Green → Amber → Red urgency based on elapsed prep time
const urgencyClasses = (createdAt: Date | string) => {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000;
  if (mins < 5) return "border-green-500/60 bg-green-500/5";
  if (mins < 10) return "border-amber-500/60 bg-amber-500/5";
  return "border-red-500/60 bg-red-500/5";
};

const playDing = () => {
  // This board carried its own private oscillator while `lib/orderAudio.ts` grew
  // a shared, two-tone chime for the same event. Both reached for a
  // `window as any` cast; the shared module is the one to keep, so the board
  // drops its copy and gets the consistent cue the orders board plays.
  playOrderDing("normal");
};

export const KitchenClient: React.FC<KitchenClientProps> = ({ initialOrders, cafeId }) => {
  const router = useRouter();
  const [orders, setOrders] = useSyncedState<Order[]>(initialOrders);
  const [station, setStation] = useState<Station>("all");
  const [, setTick] = useState(0);
  const [, startTransition] = useTransition();
  const { connect, disconnect, socket, isConnected, joinRoom, leaveRoom } = useSocketStore();
  const audioUnlocked = useRef(false);
  const prevConnectedRef = useRef(isConnected);

  // Trigger state reconciliation when socket reconnects
  useEffect(() => {
    if (!prevConnectedRef.current && isConnected) {
      console.log("Kitchen KDS socket reconnected: reconciling state via router.refresh()");
      router.refresh();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, router]);

  useEffect(() => {
    connect();
    if (cafeId) joinRoom(`cafe-${cafeId}`);
    const onFirstClick = () => {
      audioUnlocked.current = true;
    };
    window.addEventListener("click", onFirstClick, { once: true });
    return () => {
      if (cafeId) leaveRoom(`cafe-${cafeId}`);
      disconnect();
      window.removeEventListener("click", onFirstClick);
    };
  }, [connect, disconnect, joinRoom, leaveRoom, cafeId]);

  // Refresh urgency timers every 15s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleNewOrder = (payload: unknown) => {
      const raw = asRawOrderPayload(payload);
      if (!raw) return;
      const mapped = mapRawOrderForStaff(raw);
      setOrders((prev) => (prev.some((o) => o.id === mapped.id) ? prev : [mapped, ...prev]));
      if (audioUnlocked.current) playDing();
    };

    const handleItemUpdated = (payload: unknown) => {
      const event = asKdsItemPayload(payload);
      if (!event) return;
      setOrders((prev) =>
        prev.map((o) =>
          o.id === event.orderId
            ? {
                ...o,
                items: (o.items as StaffOrderItem[] | undefined)?.map((it) =>
                  it.id === event.itemId ? { ...it, status: event.status } : it
                ),
              }
            : o
        )
      );
    };

    socket.on("new-order", handleNewOrder);
    socket.on("order-created", handleNewOrder);
    socket.on("kds-item-updated", handleItemUpdated);
    socket.on("kds-ticket-bumped", () => router.refresh());

    return () => {
      socket.off("new-order", handleNewOrder);
      socket.off("order-created", handleNewOrder);
      socket.off("kds-item-updated", handleItemUpdated);
      socket.off("kds-ticket-bumped");
    };
  }, [socket, router, setOrders]);

  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(interval);
  }, [isConnected, router]);

  const columns: { title: string; status: OrderStatus }[] = [
    { title: "Incoming", status: "PENDING" },
    { title: "Accepted", status: "ACCEPTED" },
    { title: "Preparing", status: "PREPARING" },
    { title: "Ready", status: "READY" },
  ];

  const visibleItems = (order: Order) =>
    ((order.items ?? []) as StaffOrderItem[]).filter(
      (it) => station === "all" || it.prepStation === station || it.prepStation === "both"
    );

  const ordersForColumn = (status: OrderStatus) =>
    orders.filter((o) => o.status === status && (station === "all" || visibleItems(o).length > 0));

  const updateStatus = (orderId: string, status: OrderStatus) => {
    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, status);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
        router.refresh();
      } catch {
        alert("Failed to update order status");
      }
    });
  };

  const bumpItem = (order: Order, item: StaffOrderItem) => {
    const next = item.status === "ready" ? "preparing" : "ready";
    startTransition(async () => {
      try {
        await updateKdsItemStatus(order.id, item.id, next);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  items: (o.items as StaffOrderItem[] | undefined)?.map((it) =>
                    it.id === item.id ? { ...it, status: next } : it
                  ),
                }
              : o
          )
        );
      } catch {
        alert("Failed to update item");
      }
    });
  };

  const bumpTicket = (orderId: string) => {
    startTransition(async () => {
      try {
        await bumpKdsTicket(orderId);
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "READY" as const } : o)));
        router.refresh();
      } catch {
        alert("Failed to bump ticket");
      }
    });
  };

  const handleDragStart = (e: React.DragEvent, orderId: string) => {
    e.dataTransfer.setData("text/plain", orderId);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: OrderStatus) => {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("text/plain");
    if (orderId) updateStatus(orderId, targetStatus);
  };

  const avgPrepMinutes = (() => {
    const served = orders.filter((o) => o.readyAt && o.createdAt);
    if (served.length === 0) return 0;
    const total = served.reduce(
      (sum, o) => sum + (new Date(o.readyAt as Date).getTime() - new Date(o.createdAt).getTime()) / 60000,
      0
    );
    return Number((total / served.length).toFixed(1));
  })();

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Kitchen Display System" iconName="countertops" showStatusBadge={true} />
      <OfflineBanner onSync={() => router.refresh()} />

      <div className="px-md pt-md flex justify-between items-center gap-md">
        <div className="flex gap-xs">
          {(["all", "kitchen", "bar"] as Station[]).map((s) => (
            <button
              key={s}
              onClick={() => setStation(s)}
              className={`px-md py-xs rounded-full text-body-sm font-semibold capitalize ${
                station === s ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="text-body-sm text-on-surface-variant">
          Avg prep: <span className="font-bold text-on-surface">{avgPrepMinutes} min</span>
        </div>
      </div>

      <main className="flex-1 p-md flex gap-md overflow-x-auto items-start">
        {columns.map((col) => {
          const colOrders = ordersForColumn(col.status);
          return (
            <div
              key={col.status}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, col.status)}
              className="flex-1 min-w-[300px] rounded-xl p-sm flex flex-col gap-sm max-h-[78vh] overflow-y-auto bg-surface-container-low"
            >
              <div className="flex justify-between items-center px-sm border-b border-surface-container pb-xs">
                <span className="font-semibold text-body-lg text-primary">{col.title}</span>
                <span className="font-semibold text-label-sm bg-primary/10 text-primary px-sm py-xs rounded-full">
                  {colOrders.length}
                </span>
              </div>

              {colOrders.map((order) => (
                <div
                  key={order.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, order.id)}
                  className={`border-2 rounded-lg p-sm flex flex-col gap-xs cursor-grab active:cursor-grabbing ${urgencyClasses(
                    order.createdAt
                  )}`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-body-md text-on-surface">
                      Table {order.table?.tableNumber || "—"} · {order.orderNumber || order.id.slice(0, 6)}
                    </span>
                    <span className="text-body-sm font-mono text-on-surface-variant">
                      {elapsedLabel(order.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-xs">
                    {visibleItems(order).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => bumpItem(order, item)}
                        className={`flex justify-between items-center text-left text-body-sm rounded px-xs py-xs ${
                          item.status === "ready"
                            ? "bg-green-500/15 text-green-700 line-through"
                            : "text-on-surface"
                        }`}
                      >
                        <span>
                          {item.name} <span className="font-bold">x{item.quantity}</span>
                          {item.modifiers?.length > 0 && (
                            <span className="block text-xs text-on-surface-variant">
                              {item.modifiers.map((m) => m.name).join(", ")}
                            </span>
                          )}
                        </span>
                        <span className="text-xs font-semibold uppercase">
                          {item.status === "ready" ? "✓" : "bump"}
                        </span>
                      </button>
                    ))}
                  </div>

                  {order.notes && (
                    <div className="bg-surface-container-lowest text-body-sm p-xs rounded italic border-l-2 border-primary/50">
                      &ldquo;{order.notes}&rdquo;
                    </div>
                  )}

                  <div className="flex justify-end gap-xs border-t border-surface-container pt-xs mt-xs">
                    {col.status === "PENDING" && (
                      <button
                        onClick={() => updateStatus(order.id, "ACCEPTED")}
                        className="px-sm py-base rounded bg-primary text-on-primary text-body-sm font-semibold"
                      >
                        Accept
                      </button>
                    )}
                    {col.status === "ACCEPTED" && (
                      <button
                        onClick={() => updateStatus(order.id, "PREPARING")}
                        className="px-sm py-base rounded bg-amber-500 text-white text-body-sm font-semibold"
                      >
                        Start Prep
                      </button>
                    )}
                    <button
                      onClick={() => bumpTicket(order.id)}
                      className="px-sm py-base rounded bg-green-600 text-white text-body-sm font-semibold"
                    >
                      Bump Ticket
                    </button>
                  </div>
                </div>
              ))}

              {colOrders.length === 0 && (
                <div className="text-center py-xl text-body-sm text-on-surface-variant/30 select-none">
                  Queue empty
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default KitchenClient;
