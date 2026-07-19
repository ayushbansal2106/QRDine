"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DiningSession } from "@/types";
import { getSalesHistory } from "@/actions/billing";
import { formatCurrency } from "@/utils/currency";
import { exportToCSV } from "@/utils/exportCSV";

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

  // Advanced filters
  const [customerSearch, setCustomerSearch] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

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

  const getPaymentMethodLabel = (method: string) => {
    switch (method) {
      case "paid_online":
        return "Online";
      case "paid_counter":
        return "Counter";
      default:
        return "Pending";
    }
  };

  const getPaymentBadgeStyle = (method: string) => {
    switch (method) {
      case "paid_online":
        return "bg-[#e3f2fd] text-[#1565c0]";
      case "paid_counter":
        return "bg-[#fff3e0] text-[#e65100]";
      default:
        return "bg-surface-container text-on-surface-variant";
    }
  };

  // Apply client-side filters
  const filteredSessions = sessions.filter((s: any) => {
    if (customerSearch) {
      const search = customerSearch.toLowerCase();
      const nameMatch = s.customerName?.toLowerCase().includes(search);
      const emailMatch = s.customerEmail?.toLowerCase().includes(search);
      if (!nameMatch && !emailMatch) return false;
    }
    if (paymentFilter !== "all" && s.paymentMethod !== paymentFilter) {
      return false;
    }
    return true;
  });

  const handleExportCSV = () => {
    const exportData = filteredSessions.map((s: any) => ({
      Date: formatDate(s.endedAt || s.startedAt),
      Customer: s.customerName,
      Email: s.customerEmail,
      Table: s.tableId?.tableNumber || "N/A",
      Orders: s.orderCount || 0,
      Subtotal: s.subtotal || 0,
      GST: s.gst || 0,
      "Total Amount": s.totalAmount || 0,
      "Payment Method": getPaymentMethodLabel(s.paymentMethod),
      "Invoice No": s.invoice?.invoiceNumber || "—",
    }));
    const dateStr = new Date().toISOString().slice(0, 10);
    exportToCSV(exportData, `sales-history-${dateStr}`);
  };

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

  return (
    <div className="flex-1 flex flex-col p-md lg:p-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-md">
        <h1 className="font-inter font-bold text-headline-md text-on-surface">
          Sales History
        </h1>
        <div className="flex items-center gap-xs">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-xs px-md py-sm rounded-lg text-body-sm font-inter font-semibold cursor-pointer transition-colors ${
              showFilters
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">
              filter_list
            </span>
            Filters
          </button>
          <button
            onClick={handleExportCSV}
            disabled={filteredSessions.length === 0}
            className="flex items-center gap-xs px-md py-sm rounded-lg bg-primary text-on-primary text-body-sm font-inter font-semibold cursor-pointer hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">
              download
            </span>
            Export CSV
          </button>
        </div>
      </div>

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

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="bg-surface-container-lowest rounded-xl p-md mb-md border border-surface-container shadow-[0px_4px_20px_rgba(0,0,0,0.04)] animate-[slideDown_0.2s_ease-out]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
            {/* Customer Search */}
            <div>
              <label className="font-inter text-label-sm text-on-surface-variant block mb-xs">
                Customer
              </label>
              <div className="relative">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant absolute left-sm top-1/2 -translate-y-1/2">
                  search
                </span>
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Name or email..."
                  className="w-full pl-10 pr-sm py-sm rounded-lg bg-surface-container border-none outline-none font-inter text-body-sm text-on-surface placeholder:text-on-surface-variant/50"
                />
              </div>
            </div>

            {/* Payment Method Filter */}
            <div>
              <label className="font-inter text-label-sm text-on-surface-variant block mb-xs">
                Payment Method
              </label>
              <select
                value={paymentFilter}
                onChange={(e) => setPaymentFilter(e.target.value)}
                className="w-full px-sm py-sm rounded-lg bg-surface-container border-none outline-none font-inter text-body-sm text-on-surface cursor-pointer"
              >
                <option value="all">All Methods</option>
                <option value="paid_online">Online</option>
                <option value="paid_counter">Counter</option>
              </select>
            </div>

            {/* Clear Filters */}
            <div className="flex items-end">
              <button
                onClick={() => {
                  setCustomerSearch("");
                  setPaymentFilter("all");
                }}
                className="px-md py-sm rounded-lg text-body-sm font-inter font-semibold text-on-surface-variant hover:bg-surface-container cursor-pointer transition-colors"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>
      )}

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
      ) : filteredSessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
            trending_up
          </span>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-xs">
            No Sales Found
          </h3>
          <p className="font-inter text-body-sm text-on-surface-variant">
            {customerSearch || paymentFilter !== "all"
              ? "Try adjusting your filters."
              : "Completed sessions will appear here."}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_0.8fr_0.5fr_0.8fr_0.7fr_0.8fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Date</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Customer</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Table</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant">Orders</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Amount</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-center">Payment</span>
              <span className="font-inter font-semibold text-label-sm text-on-surface-variant text-right">Invoice</span>
            </div>

            {/* Rows */}
            {filteredSessions.map((s: any) => (
              <div
                key={s.id || s._id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_0.8fr_0.5fr_0.8fr_0.7fr_0.8fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
              >
                <span className="font-inter text-body-sm text-on-surface">
                  {formatDate(s.endedAt || s.startedAt)}
                </span>
                <div className="min-w-0">
                  <p className="font-inter text-body-sm text-on-surface truncate">
                    {s.customerName}
                  </p>
                  <p className="font-inter text-label-sm text-on-surface-variant truncate md:hidden">
                    {s.customerEmail}
                  </p>
                </div>
                <span className="font-inter text-body-sm text-on-surface">
                  Table {s.tableId?.tableNumber || "N/A"}
                </span>
                <span className="font-inter text-body-sm text-on-surface">
                  {s.orderCount || 0}
                </span>
                <div className="text-right">
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {formatCurrency(s.totalAmount || 0)}
                  </span>
                  {s.gst > 0 && (
                    <p className="font-inter text-label-sm text-on-surface-variant">
                      GST: {formatCurrency(s.gst)}
                    </p>
                  )}
                </div>
                <div className="flex justify-center items-start">
                  <span
                    className={`inline-flex items-center px-xs py-[2px] rounded-full text-[11px] font-inter font-bold ${getPaymentBadgeStyle(s.paymentMethod)}`}
                  >
                    {getPaymentMethodLabel(s.paymentMethod)}
                  </span>
                </div>
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
