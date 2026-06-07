"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DiningSession } from "@/types";
import { getBills } from "@/actions/billing";
import { markSessionPaid } from "@/actions/sessions";
import { useSocketStore } from "@/store/socketStore";
import { formatCurrency } from "@/utils/currency";

type BillFilter = "all" | "active" | "awaiting_payment";

export const BillsClient: React.FC<{ cafeId: string }> = ({ cafeId }) => {
  const [bills, setBills] = useState<any[]>([]);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const { socket, connect, joinRoom } = useSocketStore();

  const fetchBills = useCallback(async () => {
    try {
      const params: any = {};
      if (filter !== "all") params.status = filter;
      const result = await getBills(params);
      setBills(result.bills || []);
    } catch (err) {
      console.error("Failed to fetch bills:", err);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setIsLoading(true);
    fetchBills();
  }, [fetchBills]);

  // Socket setup for real-time updates
  useEffect(() => {
    connect();
    joinRoom(`cafe-${cafeId}`);
  }, [cafeId, connect, joinRoom]);

  useEffect(() => {
    if (!socket) return;

    const handlePaymentAwaiting = () => {
      fetchBills();
    };

    const handleSessionClosed = () => {
      fetchBills();
    };

    socket.on("payment-awaiting", handlePaymentAwaiting);
    socket.on("session-closed", handleSessionClosed);
    socket.on("session-paid", handleSessionClosed);

    return () => {
      socket.off("payment-awaiting", handlePaymentAwaiting);
      socket.off("session-closed", handleSessionClosed);
      socket.off("session-paid", handleSessionClosed);
    };
  }, [socket, fetchBills]);

  const handleMarkPaid = async (
    sessionId: string,
    method: "paid_counter" | "paid_online"
  ) => {
    setProcessingIds((prev) => new Set(prev).add(sessionId));
    try {
      await markSessionPaid(sessionId, method);
      // Remove from list after pipeline completes
      setBills((prev) => prev.filter((b) => b.id !== sessionId));
    } catch (err: any) {
      alert(err.message || "Failed to process payment");
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <span className="px-sm py-xs rounded-full bg-primary/10 text-primary text-label-sm font-inter font-semibold">
            Active
          </span>
        );
      case "awaiting_payment":
        return (
          <span className="px-sm py-xs rounded-full bg-[#E65100]/10 text-[#E65100] text-label-sm font-inter font-semibold animate-pulse flex items-center gap-xs">
            <span className="material-symbols-outlined text-[14px]">hourglass_empty</span>
            Awaiting Payment
          </span>
        );
      default:
        return (
          <span className="px-sm py-xs rounded-full bg-surface-container text-on-surface-variant text-label-sm font-inter font-semibold">
            {status}
          </span>
        );
    }
  };

  const getElapsedTime = (startedAt: string | Date) => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMin = Math.floor((now - start) / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    const hours = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return `${hours}h ${mins}m ago`;
  };

  const filters: { label: string; value: BillFilter }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Awaiting Payment", value: "awaiting_payment" },
  ];

  return (
    <div className="flex-1 flex flex-col p-md lg:p-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-md">
        <h1 className="font-inter font-bold text-headline-md text-on-surface">
          Bills
        </h1>
        <span className="font-inter text-body-sm text-on-surface-variant">
          {bills.length} session{bills.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-xs mb-md overflow-x-auto no-scrollbar">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-md py-sm rounded-full text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              filter === f.value
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : bills.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
            receipt_long
          </span>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
            No Bills
          </h3>
          <p className="font-inter text-body-sm text-on-surface-variant">
            Bills will appear here when customers start ordering.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-md">
          {bills.map((bill) => {
            const isProcessing = processingIds.has(bill.id);
            const tableNum = (bill as any).tableId?.tableNumber || "N/A";

            return (
              <div
                key={bill.id}
                className={`bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border transition-all ${
                  bill.status === "awaiting_payment"
                    ? "border-[#E65100]/30 shadow-[0px_4px_20px_rgba(230,81,0,0.08)]"
                    : "border-surface-container"
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-sm">
                  <div>
                    <div className="flex items-center gap-xs mb-xs">
                      <span className="material-symbols-outlined text-primary text-[20px]">
                        table_restaurant
                      </span>
                      <span className="font-inter font-bold text-body-lg text-on-surface">
                        Table {tableNum}
                      </span>
                    </div>
                    <span className="font-inter text-body-md text-on-surface">
                      {bill.customerName}
                    </span>
                  </div>
                  {getStatusBadge(bill.status as string)}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-md mb-md text-body-sm font-inter text-on-surface-variant">
                  <div className="flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[16px]">
                      shopping_bag
                    </span>
                    {bill.orderCount || 0} order
                    {(bill.orderCount || 0) !== 1 ? "s" : ""}
                  </div>
                  <div className="flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[16px]">
                      schedule
                    </span>
                    {getElapsedTime(bill.startedAt)}
                  </div>
                </div>

                {/* Total */}
                <div className="flex items-center justify-between mb-md">
                  <span className="font-inter text-body-sm text-on-surface-variant">
                    Running Total
                  </span>
                  <span className="font-inter font-bold text-body-lg text-on-surface">
                    {formatCurrency(bill.runningTotal || 0)}
                  </span>
                </div>

                {/* Actions */}
                {bill.status === "awaiting_payment" && (
                  <div className="flex flex-col gap-xs">
                    <div className="flex items-center gap-xs text-body-sm font-inter text-on-surface-variant mb-xs bg-surface-container-low p-xs rounded-lg">
                      <span className="material-symbols-outlined text-[16px]">
                        {bill.paymentMethod === "paid_online" ? "account_balance_wallet" : "storefront"}
                      </span>
                      {bill.paymentMethod === "paid_online" ? "Customer wants to pay Online" : "Customer will pay at Counter"}
                    </div>
                    <button
                      onClick={() => handleMarkPaid(bill.id, bill.paymentMethod as "paid_counter" | "paid_online")}
                      disabled={isProcessing}
                      className="w-full h-10 bg-primary text-on-primary rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-primary-container transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                    >
                      {isProcessing ? (
                        <>
                          <span className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[18px]">check_circle</span>
                          Confirm Payment
                        </>
                      )}
                    </button>
                  </div>
                )}

                {bill.status === "active" && (
                  <div className="text-body-sm font-inter text-on-surface-variant text-center py-xs">
                    Customer is still ordering...
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
