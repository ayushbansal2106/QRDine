"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useEffect, useCallback } from "react";
import { LoyaltySnapshot, type SessionParticipant } from "@/types";
import { getBills, getBillDetail } from "@/actions/billing";
import {
  markSessionPaid,
  addBillAdjustment,
  transferOwnership,
  closeSession,
  requestBillForTable,
} from "@/actions/sessions";
import { PERMISSIONS } from "@/lib/permissionCatalog";
import { useSocketStore } from "@/store/socketStore";
import { formatCurrency } from "@/utils/currency";
import { useNow } from "@/hooks/useNow";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";

type BillFilter = "all" | "active" | "awaiting_payment";

/** A session participant, as stored on `DiningSession.participants`. */
type Participant = SessionParticipant;

/**
 * One row on the bills board — a spread `DiningSession` document, so it carries
 * more than the board draws.
 *
 * This was `any` before, which is why `bill.participants` at the ownership
 * transfer button typechecked even though `BillRow` never declared it: the
 * runtime value is present (`...s.toObject()` in `getBills`), the type just
 * never said so.
 */
type BillRow = {
  id: string;
  status: string;
  tableId?: { tableNumber?: string | number } | null;
  customerName?: string;
  orderCount?: number;
  runningTotal?: number;
  startedAt?: string;
  createdAt?: string;
  participants?: Participant[];
  /** Attached by `attachLoyalty` when a guest on this table has signed in. */
  loyalty?: LoyaltySnapshot | null;
  /** The guest's stated preference, used to label the "Take payment" action. */
  paymentMethod?: "paid_counter" | "paid_online" | null;
};

type BillDetail = {
  id: string;
  status: string;
  tableId?: { tableNumber?: string | number } | null;
  customerName: string;
  startedAt: string;
  orderCount: number;
  subtotal: number;
  gst: number;
  adjustmentsTotal: number;
  totalAmount: number;
  adjustments?: { type: string; amount: number; description?: string; reason?: string }[];
  participants?: Participant[];
  orders: {
    _id: string;
    orderNumber: string;
    status: string;
    totalAmount: number;
    items: { itemName: string; quantity: number; price: number; status?: string }[];
  }[];
  customer: { name?: string; phone?: string; email?: string } | null;
  loyalty: LoyaltySnapshot | null;
};

/**
 * One line of stamp progress, shown on every table that has a signed-in guest.
 *
 * The stamp lands when the bill settles, so the cashier can see what this
 * payment is worth to the guest before they take it — and a voucher already on
 * the card is a discount the cafe owes.
 */
const LoyaltyChip: React.FC<{ loyalty: LoyaltySnapshot }> = ({ loyalty }) => {
  const progress =
    loyalty.stampsRequired > 0
      ? Math.min(100, Math.round((loyalty.stamps / loyalty.stampsRequired) * 100))
      : 0;

  return (
    <div className="flex items-center gap-sm mb-sm p-xs rounded-lg bg-surface-container-low">
      <span className="material-symbols-outlined text-[16px] text-primary">redeem</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-xs">
          <span className="font-inter text-label-sm text-on-surface font-semibold">
            {loyalty.stamps}/{loyalty.stampsRequired} stamps
          </span>
          {loyalty.vouchers.length > 0 && (
            <span className="font-inter text-label-sm text-primary font-semibold">
              {loyalty.vouchers.length} voucher{loyalty.vouchers.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {loyalty.stampsRequired > 0 && (
          <div className="h-1 mt-xs rounded-full bg-surface-container-high overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

interface BillsClientProps {
  cafeId: string;
  /**
   * Effective permissions of the signed-in operator.
   *
   * A cashier works this board all day but must not be offered Adjust — changing
   * what a guest owes is a manager's call. Hiding the control keeps the UI
   * honest with what the backend will actually accept.
   */
  permissions?: string[];
}

export const BillsClient: React.FC<BillsClientProps> = ({ cafeId, permissions }) => {
  const [bills, setBills] = useState<BillRow[]>([]);
  const [filter, setFilter] = useState<BillFilter>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  
  const [adjustingBill, setAdjustingBill] = useState<BillRow | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<"addition" | "discount">("discount");
  const [adjustmentDesc, setAdjustmentDesc] = useState("");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [isAdjusting, setIsAdjusting] = useState(false);

  const [transferringBill, setTransferringBill] = useState<BillRow | null>(null);
  const [newOwnerParticipantId, setNewOwnerParticipantId] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);

  const [closingBill, setClosingBill] = useState<BillRow | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeWriteOff, setCloseWriteOff] = useState(false);
  /**
   * The write-off checkbox stays hidden until the backend says it is needed.
   * The bills list does not carry per-order payment state, so the cashier is
   * told "this table has unpaid orders" by the server rather than being shown a
   * destructive option on every table in the building.
   */
  const [closeNeedsWriteOff, setCloseNeedsWriteOff] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  /** Session detail — opened from a bill card, fetched on demand. */
  const [detailBill, setDetailBill] = useState<BillRow | null>(null);
  const [detailData, setDetailData] = useState<BillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const { socket, connect, joinRoom } = useSocketStore();

  // No permission data (e.g. a direct client render) must not hide the board —
  // the backend is the real gate, and hiding every control would be worse.
  const can = (permission: string) =>
    !permissions || permissions.length === 0 || permissions.includes(permission);
  const canAdjust = can(PERMISSIONS.BILL_ADJUST);
  const canPay = can(PERMISSIONS.BILL_PAY);

  /**
   * Fetch the board for the current filter. Returns the rows rather than
   * writing them: the mount effect must not write state synchronously (see
   * below), and the refreshes that follow a payment or an adjustment are driven
   * by socket events that should swap rows in silently rather than blanking the
   * board behind a spinner.
   */
  const fetchBills = useCallback(async () => {
    try {
      const params: { status?: BillFilter } = {};
      if (filter !== "all") params.status = filter;
      const result = await getBills(params);
      return result.bills || [];
    } catch (err) {
      console.error("Failed to fetch bills:", err);
      return null;
    }
  }, [filter]);

  /** Commit a fetch. Split from `fetchBills` so the mount effect can skip the
   *  write entirely when it has been torn down mid-flight. */
  const applyBills = useCallback((rows: BillRow[]) => {
    setBills(rows);
    setIsLoading(false);
  }, []);

  // `isLoading` is seeded `true`, so the first fetch needs no "start" signal.
  // A later fetch only becomes necessary when the owner changes the filter, and
  // that is raised from the click handler below rather than from this effect —
  // setting it here made every socket-driven refresh blank the board with a
  // spinner, and a synchronous `setState` in an effect is the cascading-render
  // shape `react-hooks/set-state-in-effect` rejects.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const rows = await fetchBills();
      if (cancelled || !rows) return;
      applyBills(rows);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [applyBills, fetchBills]);

  // Socket setup for real-time updates
  useEffect(() => {
    connect();
    joinRoom(`cafe-${cafeId}`);
  }, [cafeId, connect, joinRoom]);

  /** Refresh after a server-side change, keeping the current rows visible while
   *  the next page of the board is in flight. */
  const refreshBills = useCallback(async () => {
    const rows = await fetchBills();
    if (rows) applyBills(rows);
  }, [applyBills, fetchBills]);

  useEffect(() => {
    if (!socket) return;

    const handlePaymentAwaiting = () => {
      void refreshBills();
    };

    const handleSessionClosed = () => {
      void refreshBills();
    };

    socket.on("payment-awaiting", handlePaymentAwaiting);
    socket.on("session-closed", handleSessionClosed);
    socket.on("session-paid", handleSessionClosed);
    // A stamp lands the moment a bill settles anywhere in the cafe — the board
    // must not keep showing a stale count after the till takes the payment.
    socket.on("loyalty-updated", handleSessionClosed);

    return () => {
      socket.off("payment-awaiting", handlePaymentAwaiting);
      socket.off("session-closed", handleSessionClosed);
      socket.off("session-paid", handleSessionClosed);
      socket.off("loyalty-updated", handleSessionClosed);
    };
  }, [refreshBills, socket]);

  const handleMarkPaid = async (
    sessionId: string,
    method: "paid_counter" | "paid_online"
  ) => {
    setProcessingIds((prev) => new Set(prev).add(sessionId));
    try {
      await markSessionPaid(sessionId, method);
      // Remove from list after pipeline completes
      setBills((prev) => prev.filter((b) => b.id !== sessionId));
    } catch (err: unknown) {
      alert(thrownMessage(err, "Failed to process payment"));
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const openDetail = async (bill: BillRow) => {
    setDetailBill(bill);
    setDetailData(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await getBillDetail(bill.id);
      setDetailData(result.bill);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Failed to load session details."
      );
    } finally {
      setDetailLoading(false);
    }
  };

  /**
   * Raise the bill for a table from the counter.
   *
   * The guest asked for it at the till instead of tapping Bill in the app, so
   * the session is still `active`. Idempotent server-side, so a double-tap is
   * harmless.
   */
  const handleRaiseBill = async (bill: BillRow) => {
    setProcessingIds((prev) => new Set(prev).add(bill.id));
    try {
      const result = await requestBillForTable(bill.id);
      void refreshBills();
      if (result.alreadyRequested) {
        alert("This table's bill was already raised.");
      }
    } catch (err: unknown) {
      alert(thrownMessage(err, "Failed to raise the bill"));
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(bill.id);
        return next;
      });
    }
  };

  const openCloseDialog = (bill: BillRow) => {
    setClosingBill(bill);
    setCloseReason("");
    setCloseWriteOff(false);
    setCloseNeedsWriteOff(false);
    setCloseError("");
  };

  const handleCloseSession = async () => {
    if (!closingBill || !closeReason.trim()) return;
    setIsClosing(true);
    setCloseError("");
    try {
      await closeSession(closingBill.id, closeReason.trim(), closeWriteOff);
      setBills((prev) => prev.filter((b) => b.id !== closingBill.id));
      setClosingBill(null);
      // The session now lives in sales history rather than on the bills board.
      void refreshBills();
    } catch (err: unknown) {
      const message = thrownMessage(err, "Failed to close session.");
      // Surface the write-off escape hatch only when the backend says money is
      // still outstanding on this table.
      if (/unpaid order/i.test(message)) {
        setCloseNeedsWriteOff(true);
      }
      setCloseError(message);
    } finally {
      setIsClosing(false);
    }
  };

  const handleAddAdjustment = async () => {
    if (!adjustingBill || !adjustmentDesc || !adjustmentAmount) return;
    setIsAdjusting(true);
    try {
      await addBillAdjustment(
        adjustingBill.id,
        adjustmentType,
        adjustmentDesc,
        Number(adjustmentAmount)
      );
      setAdjustingBill(null);
      setAdjustmentDesc("");
      setAdjustmentAmount("");
      void refreshBills();
    } catch (err: unknown) {
      alert(thrownMessage(err, "Failed to add adjustment"));
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleTransferOwnership = async () => {
    if (!transferringBill || !newOwnerParticipantId) return;
    setIsTransferring(true);
    try {
      await transferOwnership(transferringBill.id, newOwnerParticipantId, newOwnerEmail || undefined);
      setTransferringBill(null);
      setNewOwnerParticipantId("");
      setNewOwnerEmail("");
      void refreshBills();
    } catch (err: unknown) {
      alert(thrownMessage(err, "Failed to transfer ownership"));
    } finally {
      setIsTransferring(false);
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
          <span className="px-sm py-xs rounded-full bg-warning/10 text-warning text-label-sm font-inter font-semibold animate-pulse flex items-center gap-xs">
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

  // Ticks once a minute: every elapsed label on the board is minute-granular.
  const now = useNow(60_000);

  const getElapsedTime = (startedAt: string | Date | undefined, now: number) => {
    // The schema defaults `startedAt` to now, so it is effectively always sent —
    // but a session created before that default existed would arrive without
    // one, and `new Date(undefined)` is NaN, which rendered as "NaNm ago".
    if (!startedAt) return "just opened";
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start)) return "just opened";
    // `now` comes from `useNow`: reading `Date.now()` here would be an impure
    // call in the render body, so the label could disagree with itself across
    // the double-render React does in development.
    if (!now) return "just opened";
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
            onClick={() => {
              setIsLoading(true);
              setFilter(f.value);
            }}
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
            const tableNum = bill.tableId?.tableNumber || "N/A";

            return (
              <div
                key={bill.id}
                className={`bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border transition-all ${
                  bill.status === "awaiting_payment"
                    ? "border-warning/30 shadow-[0px_4px_20px_rgba(230,81,0,0.08)]"
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
                    {getElapsedTime(bill.startedAt, now)}
                  </div>
                </div>

                {/* Loyalty — only when a guest on this table has signed in */}
                {bill.loyalty && <LoyaltyChip loyalty={bill.loyalty} />}

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
                {bill.status === "awaiting_payment" && canPay && (
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

                {bill.status === "active" && canPay && (
                  <button
                    onClick={() => handleRaiseBill(bill)}
                    disabled={isProcessing}
                    className="w-full h-10 bg-primary text-on-primary rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-primary-container transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                  >
                    <span className="material-symbols-outlined text-[18px]">request_quote</span>
                    Raise Bill
                  </button>
                )}

                {bill.status === "active" && !canPay && (
                  <div className="text-body-sm font-inter text-on-surface-variant text-center py-xs">
                    Customer is still ordering...
                  </div>
                )}

                {/* Action Buttons */}
                {(bill.status === "active" || bill.status === "awaiting_payment") && (
                  <div className="flex gap-sm mt-sm">
                    <button
                      onClick={() => openDetail(bill)}
                      disabled={isProcessing}
                      className="flex-1 h-10 bg-surface-container-high text-on-surface rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-surface-container transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                    >
                      <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                      Details
                    </button>
                    {canAdjust && (
                      <button
                        onClick={() => setAdjustingBill(bill)}
                        disabled={isProcessing}
                        className="flex-1 h-10 bg-surface-container-high text-on-surface rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-surface-container transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit_note</span>
                        Adjust
                      </button>
                    )}
                    {canAdjust && bill.participants && bill.participants.filter((p) => p.status === 'active').length > 1 && (
                      <button
                        onClick={() => {
                          setTransferringBill(bill);
                          setNewOwnerParticipantId("");
                          setNewOwnerEmail("");
                        }}
                        disabled={isProcessing}
                        className="flex-1 h-10 bg-surface-container-high text-on-surface rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-surface-container transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                      >
                        <span className="material-symbols-outlined text-[18px]">transfer_within_a_station</span>
                        Transfer
                      </button>
                    )}
                  </div>
                )}

                {/* Close session — an escape hatch, not a routine action, so it
                    sits apart from Adjust/Transfer rather than competing with
                    them. Paying the bill is the normal way a table leaves. */}
                {(bill.status === "active" || bill.status === "awaiting_payment") && canPay && (
                  <button
                    onClick={() => openCloseDialog(bill)}
                    disabled={isProcessing}
                    className="w-full mt-xs h-9 text-on-surface-variant rounded-lg font-inter font-semibold text-body-sm cursor-pointer hover:bg-surface-container-low transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-xs"
                  >
                    <span className="material-symbols-outlined text-[16px]">door_front</span>
                    Close session
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Session Detail Modal */}
      {detailBill && (
        <Modal
          isOpen={true}
          onClose={() => setDetailBill(null)}
          title={`Table ${detailData?.tableId?.tableNumber ?? detailBill.tableId?.tableNumber ?? ""} — Session`}
        >
          {detailLoading ? (
            <div className="flex items-center justify-center py-lg">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : detailError ? (
            <div className="text-body-sm text-error">{detailError}</div>
          ) : detailData ? (
            <div className="flex flex-col gap-md">
              {/* Header facts */}
              <div className="flex flex-wrap items-center gap-md text-body-sm font-inter text-on-surface-variant">
                <span className="flex items-center gap-xs">
                  <span className="material-symbols-outlined text-[16px]">person</span>
                  {detailData.customerName || "Guest"}
                </span>
                <span className="flex items-center gap-xs">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  {getElapsedTime(detailData.startedAt, now)}
                </span>
                {detailData.customer?.phone && (
                  <span className="flex items-center gap-xs">
                    <span className="material-symbols-outlined text-[16px]">call</span>
                    {detailData.customer.phone}
                  </span>
                )}
              </div>

              {/* Loyalty card */}
              {detailData.loyalty ? (
                <div className="flex flex-col gap-sm p-md rounded-xl bg-surface-container-low">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-xs font-inter font-semibold text-body-md text-on-surface">
                      <span className="material-symbols-outlined text-[18px] text-primary">redeem</span>
                      {detailData.loyalty.programName}
                    </span>
                    <span className="font-inter text-body-sm text-on-surface-variant">
                      {detailData.loyalty.stamps}/{detailData.loyalty.stampsRequired} stamps
                    </span>
                  </div>

                  {detailData.loyalty.stampsRequired > 0 && (
                    <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (detailData.loyalty.stamps / detailData.loyalty.stampsRequired) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  )}

                  <p className="text-body-sm text-on-surface-variant">
                    {detailData.loyalty.stampsToReward > 0
                      ? `${detailData.loyalty.stampsToReward} more stamp${
                          detailData.loyalty.stampsToReward !== 1 ? "s" : ""
                        } until the next reward. One is added when this bill is settled.`
                      : "A reward is unlocked on the next settled bill."}
                  </p>

                  {detailData.loyalty.vouchers.length > 0 && (
                    <div className="flex flex-col gap-xs">
                      {detailData.loyalty.vouchers.map((voucher) => (
                        <div
                          key={voucher.code}
                          className="flex items-center justify-between gap-sm p-xs rounded-lg bg-surface-container-lowest border border-surface-container"
                        >
                          <div className="min-w-0">
                            <span className="font-inter font-semibold text-body-sm text-on-surface block truncate">
                              {voucher.label}
                            </span>
                            <span className="font-mono text-label-sm text-on-surface-variant">
                              {voucher.code}
                            </span>
                          </div>
                          <span className="font-inter font-bold text-body-sm text-primary shrink-0">
                            {voucher.type === "percent"
                              ? `${voucher.value}% off`
                              : formatCurrency(voucher.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  No loyalty card on this table — the guest has not signed in with a phone.
                </p>
              )}

              {/* Orders */}
              <div className="flex flex-col gap-sm">
                <span className="font-inter font-semibold text-label-md text-on-surface">
                  Orders ({detailData.orderCount})
                </span>
                {detailData.orders.length === 0 ? (
                  <span className="text-body-sm text-on-surface-variant">No orders on this table.</span>
                ) : (
                  detailData.orders.map((order) => (
                    <div key={order._id} className="flex flex-col gap-xs p-sm rounded-lg bg-surface-container-low">
                      <div className="flex items-center justify-between">
                        <span className="font-inter font-semibold text-body-sm text-on-surface">
                          {order.orderNumber}
                        </span>
                        <span className="font-inter text-body-sm text-on-surface">
                          {formatCurrency(order.totalAmount)}
                        </span>
                      </div>
                      {order.items.map((item, index) => (
                        <div key={index} className="flex items-center justify-between text-body-sm">
                          <span
                            className={`text-on-surface-variant ${
                              item.status === "cancelled" ? "line-through" : ""
                            }`}
                          >
                            {item.quantity} × {item.itemName}
                          </span>
                          <span className="text-on-surface-variant">
                            {formatCurrency(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>

              {/* Totals */}
              <div className="flex flex-col gap-xs p-md rounded-xl bg-surface-container-low">
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-on-surface-variant">Subtotal</span>
                  <span className="text-on-surface">{formatCurrency(detailData.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-body-sm">
                  <span className="text-on-surface-variant">GST</span>
                  <span className="text-on-surface">{formatCurrency(detailData.gst)}</span>
                </div>
                {detailData.adjustmentsTotal !== 0 && (
                  <div className="flex items-center justify-between text-body-sm">
                    <span className="text-on-surface-variant">Adjustments</span>
                    <span className="text-on-surface">
                      {detailData.adjustmentsTotal < 0 ? "-" : "+"}
                      {formatCurrency(Math.abs(detailData.adjustmentsTotal))}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-xs border-t border-surface-container">
                  <span className="font-inter font-semibold text-body-md text-on-surface">Total</span>
                  <span className="font-inter font-bold text-body-lg text-on-surface">
                    {formatCurrency(detailData.totalAmount)}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setDetailBill(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>
      )}

      {/* Adjustment Modal */}
      {adjustingBill && (
        <Modal
          isOpen={true}
          onClose={() => setAdjustingBill(null)}
          title="Adjust Bill"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              Adding adjustment for Table {adjustingBill.tableId?.tableNumber || "N/A"}.
            </p>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">Type</label>
              <div className="flex gap-sm">
                <Button
                  variant={adjustmentType === "discount" ? "primary" : "secondary"}
                  onClick={() => setAdjustmentType("discount")}
                  className="flex-1"
                >
                  Discount
                </Button>
                <Button
                  variant={adjustmentType === "addition" ? "primary" : "secondary"}
                  onClick={() => setAdjustmentType("addition")}
                  className="flex-1"
                >
                  Addition
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">Description</label>
              <input
                type="text"
                placeholder="e.g. Service Apology"
                value={adjustmentDesc}
                onChange={(e) => setAdjustmentDesc(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
            </div>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">Amount (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 50"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
            </div>

            <div className="flex justify-end gap-sm mt-sm">
              <Button
                variant="secondary"
                onClick={() => setAdjustingBill(null)}
                disabled={isAdjusting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddAdjustment}
                disabled={!adjustmentDesc || !adjustmentAmount || isAdjusting}
              >
                {isAdjusting ? "Saving..." : "Save Adjustment"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Close Session Modal */}
      {closingBill && (
        <Modal
          isOpen={true}
          onClose={() => setClosingBill(null)}
          title="Close Session"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              Closing Table {closingBill.tableId?.tableNumber || "N/A"} moves it
              out of the bills board and into sales history.
            </p>

            <div className="flex items-start gap-sm bg-surface-container-low p-sm rounded-lg">
              <span className="material-symbols-outlined text-[18px] text-warning shrink-0 mt-[2px]">
                info
              </span>
              <p className="text-body-sm text-on-surface-variant">
                Use this only when the bill will not be settled here — a
                walkout, a comped table, or a session stranded by a crashed
                till. Normal tables close by taking payment.
              </p>
            </div>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">
                Reason <span className="text-error">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Guest walked out"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
              <p className="text-body-sm text-on-surface-variant italic">
                Recorded against this table in the audit ledger. A closed session
                with no reason is an unexplained gap in the day&apos;s takings.
              </p>
            </div>

            {closeNeedsWriteOff && (
              <label className="flex items-start gap-sm p-sm bg-error-container/40 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={closeWriteOff}
                  onChange={(e) => setCloseWriteOff(e.target.checked)}
                  className="mt-[2px] w-4 h-4 accent-[var(--color-error)] shrink-0"
                />
                <span className="text-body-sm text-on-surface">
                  <span className="font-semibold">Write off the unpaid orders on this table.</span>{" "}
                  They will be cancelled and the amount recorded as written off.
                  This cannot be undone.
                </span>
              </label>
            )}

            {closeError && (
              <div className="text-body-sm text-error">{closeError}</div>
            )}

            <div className="flex justify-end gap-sm mt-sm">
              <Button
                variant="secondary"
                onClick={() => setClosingBill(null)}
                disabled={isClosing}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCloseSession}
                disabled={!closeReason.trim() || isClosing}
              >
                {isClosing ? "Closing..." : "Close Session"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Transfer Ownership Modal */}
      {transferringBill && (
        <Modal
          isOpen={true}
          onClose={() => setTransferringBill(null)}
          title="Transfer Ownership"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              Transferring ownership for Table {transferringBill.tableId?.tableNumber || "N/A"}.
              The new owner will be responsible for the bill.
            </p>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">Select New Owner</label>
              <select
                value={newOwnerParticipantId}
                onChange={(e) => setNewOwnerParticipantId(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              >
                <option value="">-- Select Participant --</option>
                {transferringBill.participants
                  ?.filter((p) => p.status === 'active' && p.role !== 'owner')
                  .map((p) => (
                    <option key={p.participantId} value={p.participantId}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex flex-col gap-sm">
              <label className="font-inter font-semibold text-label-md text-on-surface">Email (Optional)</label>
              <input
                type="email"
                placeholder="Required for invoices"
                value={newOwnerEmail}
                onChange={(e) => setNewOwnerEmail(e.target.value)}
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
              <p className="text-body-sm text-on-surface-variant italic">
                If the new owner did not provide an email, enter one here to ensure they receive the invoice.
              </p>
            </div>

            <div className="flex justify-end gap-sm mt-sm">
              <Button
                variant="secondary"
                onClick={() => setTransferringBill(null)}
                disabled={isTransferring}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleTransferOwnership}
                disabled={!newOwnerParticipantId || isTransferring}
              >
                {isTransferring ? "Transferring..." : "Transfer Ownership"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
