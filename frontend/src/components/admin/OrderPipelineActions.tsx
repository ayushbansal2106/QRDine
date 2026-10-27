"use client";

import React, { useEffect, useState } from "react";
import { addItemsToOrder, reassignOrderTable, refundOrder } from "@/actions/orders";
import { fetchMenuItems } from "@/actions/menu";
import type { Order } from "@/types";
import { formatCurrency } from "@/utils/currency";

interface Props {
  order: Order;
  onDone?: () => void;
}

type Dialog = "none" | "move" | "add" | "refund";

/** Minimal catalog shape the add-to-tab dialog needs. */
interface CatalogItem {
  id: string;
  name: string;
  price: number;
  available?: boolean;
}

const REFUND_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi_manual", label: "UPI (manual)" },
  { value: "card_manual", label: "Card (manual)" },
  { value: "wallet", label: "Store wallet credit" },
];

/**
 * Module #03 — omnichannel pipeline actions on an order ticket.
 *
 * Add-to-tab and move-table are only meaningful while a ticket is still open, so
 * they are hidden once it is served or cancelled. Refund is offered whenever the
 * order was paid, and wallet refunds actually credit the customer's balance
 * server-side rather than just writing a note.
 */
export const OrderPipelineActions: React.FC<Props> = ({ order, onDone }) => {
  const [dialog, setDialog] = useState<Dialog>("none");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Move table
  const [tableNumber, setTableNumber] = useState("");
  const [moveReason, setMoveReason] = useState("");

  // Add items
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Refund
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundReason, setRefundReason] = useState("");

  const isOpen = ["PENDING", "ACCEPTED", "PREPARING"].includes(order.status);
  const isPaid = order.paymentStatus === "paid";

  useEffect(() => {
    if (dialog !== "add") return;
    (async () => {
      const res = await fetchMenuItems({ limit: 200 });
      if (res.success && res.items) {
        setCatalog(
          res.items.map((item) => ({
            id: item._id,
            name: item.name,
            price: Number(item.price),
            available: item.isAvailable !== false,
          }))
        );
      }
    })();
  }, [dialog]);

  const close = () => {
    setDialog("none");
    setMessage(null);
  };

  const handleMove = async () => {
    if (!tableNumber.trim()) return;
    setBusy(true);
    const result = await reassignOrderTable(order.id, tableNumber.trim(), moveReason);
    setBusy(false);
    if (result.success) {
      close();
      onDone?.();
    } else {
      setMessage({ tone: "error", text: result.message || "Could not move this order." });
    }
  };

  const handleAddItems = async () => {
    const items = Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    if (items.length === 0) {
      setMessage({ tone: "error", text: "Pick at least one item to add." });
      return;
    }
    setBusy(true);
    const result = await addItemsToOrder(order.id, items);
    setBusy(false);
    if (result.success) {
      close();
      onDone?.();
    } else {
      setMessage({ tone: "error", text: result.message || "Could not add items." });
    }
  };

  const handleRefund = async () => {
    if (refundReason.trim().length < 3) {
      setMessage({ tone: "error", text: "A short reason is required for the audit trail." });
      return;
    }
    setBusy(true);
    const result = await refundOrder(order.id, {
      amount: refundAmount.trim() === "" ? undefined : Number(refundAmount),
      method: refundMethod,
      reason: refundReason.trim(),
    });
    setBusy(false);
    if (result.success) {
      const credited =
        result.walletReconciliation != null
          ? ` New wallet balance ${formatCurrency(Number(result.walletReconciliation.balance))}.`
          : "";
      close();
      onDone?.();
      alert(`Refund recorded.${credited}`);
    } else {
      setMessage({ tone: "error", text: result.message || "Could not record the refund." });
    }
  };

  const filteredCatalog = catalog.filter((item) =>
    query.trim() === ""
      ? true
      : item.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <div className="flex flex-wrap gap-xs mt-sm pt-xs border-t border-surface-container">
        {isOpen && (
          <>
            <button
              onClick={() => setDialog("move")}
              className="text-label-sm font-semibold text-on-surface-variant hover:text-primary"
            >
              Move table
            </button>
            <button
              onClick={() => setDialog("add")}
              className="text-label-sm font-semibold text-on-surface-variant hover:text-primary"
            >
              Add items
            </button>
          </>
        )}
        {isPaid && (
          <button
            onClick={() => setDialog("refund")}
            className="text-label-sm font-semibold text-error"
          >
            Refund
          </button>
        )}
      </div>

      {dialog !== "none" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div className="absolute inset-0 bg-black/40" onClick={close} aria-hidden />
          <div className="relative bg-surface-container-lowest rounded-xl p-lg w-full max-w-[32rem] max-h-[85vh] overflow-y-auto font-inter">
            <div className="flex items-center justify-between mb-md">
              <h3 className="text-title-lg font-semibold text-on-surface">
                {dialog === "move" ? "Move to another table" : dialog === "add" ? "Add to this tab" : "Refund / credit"}
              </h3>
              <button onClick={close} aria-label="Close" className="text-on-surface-variant">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {message && (
              <div className="bg-error/10 text-error rounded-lg p-sm text-body-sm mb-md">{message.text}</div>
            )}

            {dialog === "move" && (
              <div className="flex flex-col gap-md">
                <p className="text-body-sm text-on-surface-variant">
                  The order and its dining session move together, so the guests&apos; QR keeps working.
                </p>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="move-table">
                    Target table number
                  </label>
                  <input
                    id="move-table"
                    value={tableNumber}
                    onChange={(e) => setTableNumber(e.target.value)}
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="move-reason">
                    Reason
                  </label>
                  <input
                    id="move-reason"
                    value={moveReason}
                    onChange={(e) => setMoveReason(e.target.value)}
                    placeholder="Guests asked to move"
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                  />
                </div>
                <button
                  onClick={handleMove}
                  disabled={busy || !tableNumber.trim()}
                  className="self-start bg-primary text-on-primary rounded-full px-lg py-sm text-body-md font-semibold disabled:opacity-50"
                >
                  Move order
                </button>
              </div>
            )}

            {dialog === "add" && (
              <div className="flex flex-col gap-md">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the menu"
                  className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                />
                <ul className="flex flex-col gap-xs max-h-72 overflow-y-auto">
                  {filteredCatalog.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-sm">
                      <span className="text-body-md text-on-surface truncate">{item.name}</span>
                      <span className="flex items-center gap-sm">
                        <span className="text-body-sm font-mono">{formatCurrency(item.price)}</span>
                        <input
                          type="number"
                          min={0}
                          value={quantities[item.id] || 0}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [item.id]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          className="w-16 border border-surface-container rounded-lg px-xs py-xs text-body-sm"
                          aria-label={`Quantity of ${item.name}`}
                        />
                      </span>
                    </li>
                  ))}
                  {filteredCatalog.length === 0 && (
                    <li className="text-body-sm text-on-surface-variant">No menu items loaded.</li>
                  )}
                </ul>
                <button
                  onClick={handleAddItems}
                  disabled={busy}
                  className="self-start bg-primary text-on-primary rounded-full px-lg py-sm text-body-md font-semibold disabled:opacity-50"
                >
                  Add to tab
                </button>
              </div>
            )}

            {dialog === "refund" && (
              <div className="flex flex-col gap-md">
                <p className="text-body-sm text-on-surface-variant">
                  Refund total collected: {formatCurrency(order.totalAmount)}. Leave the amount blank for a
                  full refund. A wallet refund credits the customer&apos;s stored balance.
                </p>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="refund-amount">
                    Amount
                  </label>
                  <input
                    id="refund-amount"
                    type="number"
                    min={0}
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    placeholder={String(order.totalAmount)}
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="refund-method">
                    Method
                  </label>
                  <select
                    id="refund-method"
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                  >
                    {REFUND_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="refund-reason">
                    Reason (required)
                  </label>
                  <input
                    id="refund-reason"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Item unavailable"
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md"
                  />
                </div>
                <button
                  onClick={handleRefund}
                  disabled={busy}
                  className="self-start bg-error text-on-primary rounded-full px-lg py-sm text-body-md font-semibold disabled:opacity-50"
                >
                  Record refund
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};