"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getSalesHistory, resendInvoiceEmail } from "@/actions/billing";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { formatCurrency } from "@/utils/currency";
import { exportToCSV } from "@/utils/exportCSV";

/**
 * One row of takings. `kind` distinguishes a closed table session from a
 * counter sale; the fields a given kind does not have are simply absent.
 */
interface SalesEntry {
  kind: "session" | "pos_order";
  id: string;
  date: string;
  orderNumber?: string | null;
  customerName: string;
  customerEmail: string;
  tableNumber?: number | string | null;
  orderCount: number;
  subtotal: number;
  gst: number;
  totalAmount: number;
  paymentMethod: string;
  invoice?: { id: string; invoiceNumber: string; pdfUrl?: string } | null;
}

export const SalesHistoryClient: React.FC = () => {
  const [sessions, setSessions] = useState<SalesEntry[]>([]);
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

  // Invoice resend. `emailPromptFor` is the invoice awaiting an address;
  // `resendNotice` reports the outcome of the last attempt either way.
  const [emailPromptFor, setEmailPromptFor] = useState<SalesEntry | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [resendBusyId, setResendBusyId] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

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

  /**
   * Fetch one page of takings.
   *
   * Returns the payload instead of writing it into state, and deliberately
   * raises no "start" flag. The flag was previously raised at the top of this
   * function, which made the mount effect write state synchronously before its
   * first `await` — the exact cascading render `react-hooks/set-state-in-effect`
   * rejects, and it also blanked the table on every page change. `isLoading` is
   * seeded `true` and only cleared here, so the first paint shows a skeleton
   * and later fetches swap rows in silently.
   */
  const fetchHistory = useCallback(async () => {
    try {
      const filters = {
        ...getDateFilters(),
        page,
        limit: 20,
      };
      return await getSalesHistory(filters);
    } catch (err) {
      console.error("Failed to fetch sales history:", err);
      return null;
    }
  }, [page, getDateFilters]);

  // Changing the date range must return to page 1 — page 7 of "today" is not a
  // valid page of "this month". Done during render rather than in an effect: an
  // effect would fetch page 7 of the new range first, render it, and only then
  // correct to page 1.
  const [seededRange, setSeededRange] = useState(dateRange);
  if (seededRange !== dateRange) {
    setSeededRange(dateRange);
    setPage(1);
  }

  /** A filter or page the owner asked for. The spinner belongs here — the user
   *  clicked, and the table they are looking at is about to be replaced — but
   *  not in the effect, which also runs for the first load (already seeded) and
   *  would then write state synchronously on every mount. */
  const requestReload = () => setIsLoading(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await fetchHistory();
      if (cancelled || !result) return;
      // `entries` merges closed table sessions with settled counter sales. A
      // cafe taking money over the till and a cafe serving QR tables are the
      // same business, and the owner needs one takings figure, so both land in
      // the same list.
      setSessions(result.entries || result.sessions || []);
      setSummary(result.summary || { totalRevenue: 0, totalGST: 0, sessionCount: 0, averageOrderValue: 0 });
      setTotalPages(result.totalPages || 1);
      setIsLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
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
      case "cash":
        return "Cash";
      case "upi_manual":
        return "UPI";
      case "card_manual":
        return "Card";
      case "wallet":
        return "Wallet";
      default:
        return "Pending";
    }
  };

  const getPaymentBadgeStyle = (method: string) => {
    switch (method) {
      case "paid_online":
        return "bg-info-container text-info";
      case "paid_counter":
        return "bg-warning-container text-warning";
      // Counter tenders are named by the till method rather than a session flag.
      case "cash":
      case "upi_manual":
      case "card_manual":
      case "wallet":
        return "bg-success-container text-success";
      default:
        return "bg-surface-container text-on-surface-variant";
    }
  };

  // Apply client-side filters
  const filteredSessions = sessions.filter((s: SalesEntry) => {
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

  const openEmailPrompt = (entry: SalesEntry) => {
    setEmailPromptFor(entry);
    setEmailInput(entry.customerEmail || "");
    setResendNotice(null);
  };

  /**
   * Resend an invoice, offering to link an email when the guest never gave one.
   *
   * A 409 comes back as `needsEmail` rather than an error: there is simply
   * nobody to send to yet, which is a prompt the staff can answer, not a
   * failure. Supplying an address persists it to the customer's profile, so the
   * next resend goes straight through.
   */
  const handleResend = async (entry: SalesEntry, email?: string) => {
    if (!entry.invoice) return;
    setResendBusyId(entry.id);
    setResendNotice(null);
    try {
      const result = await resendInvoiceEmail(entry.invoice.id, email);

      if (result.needsEmail) {
        openEmailPrompt(entry);
        return;
      }

      setEmailPromptFor(null);
      setResendNotice(
        result.emailSent
          ? { tone: "success", message: result.message }
          : // SMTP being unconfigured is a real deployment gap, not a bug in
            // this flow — say so plainly rather than claiming it was sent.
            { tone: "error", message: result.message }
      );
    } catch (err) {
      setResendNotice({
        tone: "error",
        message: err instanceof Error ? err.message : "Failed to send the invoice.",
      });
    } finally {
      setResendBusyId(null);
    }
  };

  const handleExportCSV = () => {
    const exportData = filteredSessions.map((s) => ({
      Date: formatDate(s.date),
      Source: s.kind === "pos_order" ? "Counter" : "Table",
      Customer: s.customerName,
      Email: s.customerEmail,
      Table: s.tableNumber ?? "N/A",
      "Order No": s.orderNumber || "—",
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
            onClick={() => {
              requestReload();
              setDateRange(p.value);
            }}
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
            label: "Sales",
            value: String(summary.sessionCount),
            icon: "groups",
            color: "text-primary",
          },
          {
            label: "Avg Sale Value",
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
              : "Paid table sessions and counter sales will appear here."}
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
            {filteredSessions.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_0.8fr_0.5fr_0.8fr_0.7fr_0.8fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
              >
                <span className="font-inter text-body-sm text-on-surface">
                  {formatDate(s.date)}
                </span>
                <div className="min-w-0">
                  <p className="font-inter text-body-sm text-on-surface truncate">
                    {s.customerName}
                  </p>
                  <p className="font-inter text-label-sm text-on-surface-variant truncate md:hidden">
                    {s.orderNumber || s.customerEmail}
                  </p>
                </div>
                <span className="font-inter text-body-sm text-on-surface">
                  {s.kind === "pos_order"
                    ? s.tableNumber != null
                      ? `Table ${s.tableNumber}`
                      : "Counter"
                    : `Table ${s.tableNumber ?? "N/A"}`}
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
                <div className="flex flex-col items-end gap-xs">
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
                  {s.invoice && (
                    <button
                      onClick={() => handleResend(s)}
                      disabled={resendBusyId === s.id}
                      className="flex items-center gap-xs text-on-surface-variant font-inter font-semibold text-label-sm hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {resendBusyId === s.id ? "hourglass_top" : "forward_to_inbox"}
                      </span>
                      {resendBusyId === s.id ? "Sending…" : "Resend invoice"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-sm mt-md">
              <button
                onClick={() => {
                  requestReload();
                  setPage((p) => Math.max(1, p - 1));
                }}
                disabled={page <= 1}
                className="px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-inter text-body-sm cursor-pointer hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="font-inter text-body-sm text-on-surface-variant">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => {
                  requestReload();
                  setPage((p) => Math.min(totalPages, p + 1));
                }}
                disabled={page >= totalPages}
                className="px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-inter text-body-sm cursor-pointer hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {resendNotice && (
        <div
          role="status"
          className={`mt-md rounded-xl px-md py-sm font-inter text-body-sm ${
            resendNotice.tone === "success"
              ? "bg-success-container text-on-success-container"
              : "bg-error-container text-on-error-container"
          }`}
        >
          {resendNotice.message}
        </div>
      )}

      {/* Link an email so this invoice (and the next one) has somewhere to go */}
      {emailPromptFor?.invoice && (
        <Modal
          isOpen={true}
          onClose={() => setEmailPromptFor(null)}
          title="Link email to send invoice"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              {emailPromptFor.customerName} has no email address on this bill,
              so there is nowhere to send invoice{" "}
              {emailPromptFor.invoice.invoiceNumber}.
            </p>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">
                Email address
              </label>
              <input
                type="email"
                autoFocus
                placeholder="guest@example.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
              <p className="text-body-sm text-on-surface-variant italic">
                Saved to the customer&apos;s profile, so future invoices go
                straight through.
              </p>
            </div>

            <div className="flex justify-end gap-sm mt-sm">
              <Button
                variant="secondary"
                onClick={() => setEmailPromptFor(null)}
                disabled={resendBusyId !== null}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => handleResend(emailPromptFor, emailInput.trim())}
                disabled={!emailInput.trim() || resendBusyId !== null}
              >
                {resendBusyId ? "Sending…" : "Link & send"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
