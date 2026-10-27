"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/common/Button";
import { getBillPreview, submitPaymentPreference } from "@/actions/sessions";
import { useSessionStore } from "@/store/sessionStore";
import { useSocketStore } from "@/store/socketStore";
import { formatCurrency } from "@/utils/currency";
import type { BillPreview } from "@/actions/sessions";

interface CustomerBillModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerBillModal: React.FC<CustomerBillModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { activeSessionId, sessionStatus, setSessionStatus, role, participantId } =
    useSessionStore();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billData, setBillData] = useState<BillPreview | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // The socket is already connected and joined to `session-{id}` by
  // `SessionGate`, so the modal only needs the live socket — not its own
  // connection or room membership. `bill-updated` is emitted to both the cafe
  // room (staff) and the session room (this table).
  const { socket } = useSocketStore();

  /**
   * Fetch the bill summary for a session.
   *
   * Returns the preview rather than writing it, and raises no "start" flag.
   * `isLoading` is seeded `true` for the modal's first fetch; raising it again
   * on every later refresh made the modal collapse to a spinner each time an
   * adjustment was raised at the counter — including on the `bill-updated`
   * ping that the guest is currently reading.
   */
  const fetchBillPreview = useCallback(async (sessionId: string) => {
    try {
      const result = await getBillPreview(sessionId);
      return result.success ? result.bill : null;
    } catch (err: unknown) {
      setError(thrownMessage(err, "Failed to load bill summary."));
      return null;
    }
  }, []);

  /** Commit a fetch. Split out so the open-effect can skip the write when the
   *  guest closed the modal before the request resolved. */
  const applyBillPreview = useCallback((bill: BillPreview | null) => {
    if (bill) setBillData(bill);
    setIsLoading(false);
  }, []);

  /** Refresh after the counter changed something. Keeps the figures on screen
   *  while the new total loads, so the guest sees the line move rather than a
   *  spinner. */
  const refreshBillPreview = useCallback(
    async (sessionId: string) => {
      const bill = await fetchBillPreview(sessionId);
      if (bill) setBillData(bill);
    },
    [fetchBillPreview]
  );

  useEffect(() => {
    if (!isOpen || !activeSessionId) return;
    let cancelled = false;
    const run = async () => {
      const bill = await fetchBillPreview(activeSessionId);
      if (cancelled) return;
      applyBillPreview(bill);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeSessionId, applyBillPreview, fetchBillPreview]);

  useEffect(() => {
    if (!socket || !isOpen || !activeSessionId) return;

    const handleBillUpdated = (data: { sessionId?: string; message?: string }) => {
      if (data.sessionId === activeSessionId) {
        if (data.message) {
          alert(`Notice: ${data.message}`);
        }
        void refreshBillPreview(activeSessionId);
      }
    };

    socket.on("bill-updated", handleBillUpdated);

    return () => {
      socket.off("bill-updated", handleBillUpdated);
    };
  }, [socket, isOpen, activeSessionId, refreshBillPreview]);

  const handlePaymentSelection = async (method: "paid_counter" | "paid_online") => {
    if (!activeSessionId) return;

    if (method === "paid_online") {
      // MVP: Online payment coming soon, but we still record the intent.
      alert("Online payment gateway integration is coming soon. Please pay at the counter for now. We have notified the staff of your intent.");
    }

    setIsSubmitting(true);
    setError("");
    try {
      const result = await submitPaymentPreference(activeSessionId, method, participantId);
      if (result.success) {
        setSessionStatus("awaiting_payment");
        setSuccessMsg("Staff has been notified. Please proceed to the counter or await confirmation.");
      }
    } catch (err: unknown) {
      setError(thrownMessage(err, "Failed to submit payment preference."));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Status overrides
  const isAwaiting = sessionStatus === "awaiting_payment" || sessionStatus === "AWAITING_PAYMENT";
  const isPaidOrClosed = ["paid", "PAID", "closed", "CLOSED"].includes(sessionStatus || "");

  if (isPaidOrClosed) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Session Closed">
        <div className="flex flex-col items-center justify-center p-md text-center">
          <span className="material-symbols-outlined text-[48px] text-primary mb-sm">
            check_circle
          </span>
          <h3 className="font-inter font-bold text-headline-sm text-on-surface mb-xs">
            Payment Confirmed
          </h3>
          <p className="font-inter text-body-md text-on-surface-variant mb-lg">
            Your bill has been settled. Thank you for dining with us!
          </p>
          <Button variant="primary" onClick={onClose} fullWidth>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Your Bill">
      <div className="flex flex-col gap-md">
        {isLoading ? (
          <div className="flex justify-center p-lg">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm text-center">
            {error}
          </div>
        ) : billData ? (
          <>
            {/* Bill Summary */}
            <div className="bg-surface-container-low rounded-xl p-md border border-surface-container">
              <div className="flex items-center justify-between mb-sm text-body-sm font-inter text-on-surface-variant">
                <span>Orders Included</span>
                <span>{billData.orderCount}</span>
              </div>
              
              {/* Itemized List */}
              {billData.items && billData.items.length > 0 && (
                <div className="mb-md pb-md border-b border-surface-container-high border-dashed">
                  {billData.items.map((item, idx) => (
                    <div key={idx} className="flex items-start justify-between mb-xs">
                      <div className="flex flex-col">
                        <span className="text-body-md font-inter text-on-surface">{item.name}</span>
                        <span className="text-body-sm font-inter text-on-surface-variant">Qty: {item.quantity}</span>
                      </div>
                      <span className="text-body-md font-inter text-on-surface">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between mb-xs text-body-md font-inter text-on-surface">
                <span>Subtotal</span>
                <span>{formatCurrency(billData.subtotal)}</span>
              </div>
              
              {(billData.additions || 0) > 0 && (
                <div className="flex items-center justify-between mb-xs text-body-md font-inter text-primary">
                  <span>Additions</span>
                  <span>+{formatCurrency(billData.additions ?? 0)}</span>
                </div>
              )}
              
              {(billData.discounts || 0) > 0 && (
                <div className="flex items-center justify-between mb-xs text-body-md font-inter text-error">
                  <span>Discounts</span>
                  <span>-{formatCurrency(billData.discounts ?? 0)}</span>
                </div>
              )}

              <div className="flex items-center justify-between mb-sm text-body-md font-inter text-on-surface">
                <span>GST</span>
                <span>{formatCurrency(billData.gst)}</span>
              </div>
              
              <div className="border-t border-surface-container-high my-sm pt-sm flex items-center justify-between">
                <span className="font-inter font-bold text-headline-sm text-on-surface">Total</span>
                <span className="font-inter font-bold text-headline-sm text-primary">
                  {formatCurrency(billData.totalAmount)}
                </span>
              </div>
            </div>

            {successMsg || isAwaiting ? (
              <div className="bg-warning/10 text-warning p-md rounded-xl text-center font-inter text-body-md mt-sm">
                <span className="material-symbols-outlined text-[32px] mb-xs block mx-auto">
                  hourglass_empty
                </span>
                {successMsg || "Staff has been notified. Please proceed to the counter or await confirmation."}
              </div>
            ) : role !== 'owner' ? (
              <div className="mt-sm p-md bg-surface-container-low rounded-xl text-center font-inter text-body-md text-on-surface-variant">
                Only the table host can request the bill and select a payment method.
              </div>
            ) : (
              <div className="mt-sm">
                <h4 className="font-inter font-semibold text-body-lg text-on-surface mb-sm text-center">
                  How would you like to pay?
                </h4>
                <div className="flex flex-col gap-sm">
                  <button
                    onClick={() => handlePaymentSelection("paid_online")}
                    disabled={isSubmitting}
                    className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
                    Pay Online
                  </button>
                  <button
                    onClick={() => handlePaymentSelection("paid_counter")}
                    disabled={isSubmitting}
                    className="w-full h-12 bg-surface-container-lowest border-2 border-primary text-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span className="material-symbols-outlined text-[20px]">storefront</span>
                    Pay At Counter
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center font-inter text-body-md text-on-surface-variant p-md">
            No active orders found for this session.
          </div>
        )}
      </div>
    </Modal>
  );
};
