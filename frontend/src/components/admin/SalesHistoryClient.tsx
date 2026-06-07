"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DiningSession } from "@/types";
import { getSalesHistory } from "@/actions/billing";
import { formatCurrency } from "@/utils/currency";

export const SalesHistoryClient: React.FC = () => {
  const [sessions, setSessions] = useState<DiningSession[]>([]);
  const [summary, setSummary] = useState({
    totalRevenue: 0,
    totalGST: 0,
    sessionCount: 0,
    averageOrderValue: 0,
  });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<"today" | "week" | "month" | "all">("today");

  const getDateFilters = useCallback(() => {
    const now = new Date();
    switch (dateRange) {
      case "today":
        return {
          dateFrom: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString(),
          dateTo: now.toISOString(),
        };
      case "week": {
        const weekAgo = new Date(now);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return { dateFrom: weekAgo.toISOString(), dateTo: now.toISOString() };
      }
      case "month": {
        const monthAgo = new Date(now);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        return { dateFrom: monthAgo.toISOString(), dateTo: now.toISOString() };
      }
      default:
        return {};
    }
  }, [dateRange]);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters = {
        ...getDateFilters(),
        page,
        limit: 20,
      };
      const result = await getSalesHistory(filters);
      setSessions(result.sessions || []);
      setSummary(result.summary || { totalRevenue: 0, totalGST: 0, sessionCount: 0, averageOrderValue: 0 });
      setTotalPages(result.totalPages || 1);
    } catch (err) {
      console.error("Failed to fetch sales history:", err);
    } finally {
      setIsLoading(false);
    }
  }, [page, getDateFilters]);

  useEffect(() => {
    setPage(1);
  }, [dateRange]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const datePresets: { label: string; value: typeof dateRange }[] = [
    { label: "Today", value: "today" },
    { label: "This Week", value: "week" },
    { label: "This Month", value: "month" },
    { label: "All Time", value: "all" },
  ];

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

  return (
    <div className="flex-1 flex flex-col p-md lg:p-lg">
      {/* Header */}
      <h1 className="font-inter font-bold text-headline-md text-on-surface mb-md">
        Sales History
      </h1>

      {/* Date Presets */}
      <div className="flex gap-xs mb-md overflow-x-auto no-scrollbar">
        {datePresets.map((p) => (
          <button
            key={p.value}
            onClick={() => setDateRange(p.value)}
            className={`px-md py-sm rounded-full text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              dateRange === p.value
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-sm mb-lg">
        {[
          {
            label: "Total Revenue",
            value: formatCurrency(summary.totalRevenue),
            icon: "payments",
            color: "text-primary",
          },
          {
            label: "GST Collected",
            value: formatCurrency(summary.totalGST),
            icon: "account_balance",
            color: "text-secondary",
          },
          {
            label: "Sessions",
            value: String(summary.sessionCount),
            icon: "groups",
            color: "text-primary",
          },
          {
            label: "Avg Order Value",
            value: formatCurrency(summary.averageOrderValue),
            icon: "trending_up",
            color: "text-secondary",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container"
          >
            <div className="flex items-center gap-xs mb-xs">
              <span
                className={`material-symbols-outlined text-[20px] ${card.color}`}
              >
                {card.icon}
              </span>
              <span className="font-inter text-label-sm text-on-surface-variant">
                {card.label}
              </span>
            </div>
            <span className="font-inter font-bold text-headline-sm text-on-surface">
              {card.value}
            </span>
          </div>
        ))}
      </div>

      {/* Sales Table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
            trending_up
          </span>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
            No Sales Yet
          </h3>
          <p className="font-inter text-body-sm text-on-surface-variant">
            Completed sessions will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_0.5fr_1fr_0.8fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Date</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Customer</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Table</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Orders</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Amount</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Invoice</span>
            </div>

            {/* Rows */}
            {sessions.map((s: any) => (
              <div
                key={s.id || s._id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_0.5fr_1fr_0.8fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
              >
                <span className="font-inter text-body-sm text-on-surface">
                  {formatDate(s.endedAt || s.startedAt)}
                </span>
                <span className="font-inter text-body-sm text-on-surface">
                  {s.customerName}
                </span>
                <span className="font-inter text-body-sm text-on-surface">
                  Table {s.tableId?.tableNumber || "N/A"}
                </span>
                <span className="font-inter text-body-sm text-on-surface">
                  {s.orderCount || 0}
                </span>
                <span className="font-inter font-semibold text-body-sm text-on-surface text-right">
                  {formatCurrency(s.totalAmount || 0)}
                </span>
                <div className="flex justify-end">
                  {s.invoice?.pdfUrl ? (
                    <a
                      href={`${API_URL.replace('/api', '')}${s.invoice.pdfUrl}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-xs text-primary font-inter font-semibold text-label-sm hover:underline"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        download
                      </span>
                      {s.invoice.invoiceNumber}
                    </a>
                  ) : (
                    <span className="font-inter text-label-sm text-on-surface-variant">
                      —
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-sm mt-md">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-inter text-body-sm cursor-pointer hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="font-inter text-body-sm text-on-surface-variant">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-inter text-body-sm cursor-pointer hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
