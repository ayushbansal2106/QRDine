"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WaiterRequest } from "@/types";
import { resolveWaiterRequest } from "@/actions/requests";
import { useSocketStore } from "@/store/socketStore";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";

interface RequestsClientProps {
  initialRequests: WaiterRequest[];
  cafeId: string;
}

const mapDbRequestToRequest = (req: any): WaiterRequest => ({
  id: req._id || req.id,
  tableId: req.tableId?._id || req.tableId || "",
  table: req.tableId && typeof req.tableId === "object" ? {
    id: req.tableId._id,
    tableNumber: parseInt(req.tableId.tableNumber, 10) || 0,
    qrCodeUrl: req.tableId.qrCodeUrl || `/table/${req.tableId.tableNumber}`,
    status: req.tableId.isActive ? "FREE" : ("ASSISTANCE_REQUIRED" as any),
    createdAt: new Date(req.tableId.createdAt),
  } : undefined,
  requestType: req.requestType || "Assistance Requested",
  status: (req.status || "PENDING").toUpperCase() as any,
  createdAt: new Date(req.createdAt),
});

export const RequestsClient: React.FC<RequestsClientProps> = ({
  initialRequests,
  cafeId,
}) => {
  const router = useRouter();
  const [requests, setRequests] = useState<WaiterRequest[]>(initialRequests);
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

  // Sync initialRequests from server updates (if pages refresh)
  useEffect(() => {
    setRequests(initialRequests);
  }, [initialRequests]);

  // Set up real-time socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleRequestCreated = (dbReq: any) => {
      console.log("Real-time: Waiter request created via socket", dbReq);
      const mapped = mapDbRequestToRequest(dbReq);
      setRequests((prev) => {
        if (prev.some((r) => r.id === mapped.id)) return prev;
        return [mapped, ...prev];
      });
    };

    const handleRequestResolved = (payload: any) => {
      console.log("Real-time: Waiter request resolved via socket", payload);
      if (payload && payload.id) {
        setRequests((prev) => prev.filter((r) => r.id !== payload.id));
      }
    };

    socket.on("waiter-request-created", handleRequestCreated);
    socket.on("waiter-request-resolved", handleRequestResolved);

    return () => {
      socket.off("waiter-request-created", handleRequestCreated);
      socket.off("waiter-request-resolved", handleRequestResolved);
    };
  }, [socket]);

  // Polling fallback when disconnected
  useEffect(() => {
    if (isConnected) return;

    console.log("Requests Board socket disconnected. Enabling 15s polling fallback.");
    const interval = setInterval(() => {
      console.log("Polling waiter requests...");
      router.refresh();
    }, 15000);

    return () => clearInterval(interval);
  }, [isConnected, router]);

  const handleResolve = (requestId: string) => {
    startTransition(async () => {
      try {
        await resolveWaiterRequest(requestId);
        // Update local state directly & immediately
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        router.refresh();
      } catch (err) {
        console.error(err);
        alert("Failed to resolve call");
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Header */}
      <TopAppBar title="Assistance Calls Queue" iconName="ring_volume" showStatusBadge={true} />

      {/* Main Content */}
      <main className="flex-1 p-md max-w-[800px] w-full mx-auto flex flex-col gap-sm">
        {requests.length > 0 ? (
          <div className="flex flex-col gap-sm">
            {requests.map((req) => (
              <div
                key={req.id}
                className="bg-surface-container-lowest border border-surface-container rounded-xl p-md shadow-[0px_4px_12px_rgba(0,0,0,0.02)] flex justify-between items-center hover:shadow-[0px_6px_16px_rgba(0,0,0,0.04)] transition-all duration-150"
              >
                <div className="flex flex-col gap-xs">
                  <span className="font-semibold text-body-lg text-primary">
                    Table {req.table?.tableNumber || "N/A"}
                  </span>
                  <div className="flex items-center gap-xs text-on-surface-variant text-body-md font-semibold">
                    <span className="material-symbols-outlined text-[18px]">
                      info
                    </span>
                    {req.requestType}
                  </div>
                  <span className="text-body-sm text-on-surface-variant/40">
                    Called at {new Date(req.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <Button
                  onClick={() => handleResolve(req.id)}
                  disabled={isPending}
                  variant="primary"
                  className="h-10 px-md shadow-none"
                >
                  Resolve Call
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-xl bg-surface-container-low rounded-xl text-body-md text-on-surface-variant/30 select-none">
            No active calls for assistance
          </div>
        )}
      </main>
    </div>
  );
};
export default RequestsClient;
