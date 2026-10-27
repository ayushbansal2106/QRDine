"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useEffect, useTransition, useCallback } from "react";
import { Shift } from "@/types";
import { getCurrentShift, openShift, closeShift, getShiftHistory } from "@/actions/shifts";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi_manual: "UPI (manual)",
  card_manual: "Card (manual)",
  wallet: "Wallet",
  online: "Online",
};

const money = (value: number | null | undefined) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export const ShiftClient: React.FC = () => {
  const [shift, setShift] = useState<Shift | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const [openingFloat, setOpeningFloat] = useState("0");
  const [closingFloat, setClosingFloat] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  /**
   * Fetch the open shift plus recent history.
   *
   * Deliberately returns the values instead of writing them: every caller is
   * either an effect (whose synchronous state writes trigger cascading renders)
   * or a transition, and having one place that owns the assignment keeps the
   * "unmount before the fetch resolves" guard in a single spot.
   */
  const load = useCallback(async () => {
    const [current, hist] = await Promise.all([getCurrentShift(), getShiftHistory()]);
    return {
      shift: current.success ? current.shift : null,
      history: hist.success ? hist.shifts : [],
    };
  }, []);

  /** Apply a fetch result. Kept separate from `load` so the effect can guard on
   *  `cancelled` before committing, and the event handlers can commit directly. */
  const applyShiftData = useCallback((next: { shift: Shift | null; history: Shift[] }) => {
    setShift(next.shift);
    setHistory(next.history);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const next = await load();
      if (cancelled) return;
      applyShiftData(next);
      // The first load is the only one that clears the full-screen spinner, and
      // it is seeded `true`, so raising it here would only cause an extra
      // render. Later poll ticks swap the data in silently — flashing the
      // spinner every 30s made the screen strobe while an owner watched it.
      setIsLoading(false);
    };
    void run();
    // Live refresh so the running reconciliation stays current while the shift is open
    const timer = setInterval(() => {
      void run();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [applyShiftData, load]);

  const handleOpen = () => {
    setError("");
    startTransition(async () => {
      try {
        await openShift(Number(openingFloat) || 0, notes);
        setOpeningFloat("0");
        setNotes("");
        applyShiftData(await load());
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to open shift."));
      }
    });
  };

  const handleClose = () => {
    if (!shift) return;
    setError("");
    startTransition(async () => {
      try {
        await closeShift(shift.id, Number(closingFloat) || 0, notes);
        setClosingFloat("");
        setNotes("");
        applyShiftData(await load());
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to close shift."));
      }
    });
  };

  const liveDifference =
    shift && closingFloat !== ""
      ? Number(closingFloat) - (Number(shift.expectedCash) || 0)
      : null;

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Shift & Drawer" iconName="point_of_sale" />

      <main className="flex-1 p-md lg:p-lg max-w-[1100px] w-full mx-auto flex flex-col gap-lg">
        {error && (
          <div className="bg-error/10 border border-error/20 text-error text-body-sm rounded-lg px-md py-sm font-semibold flex items-center gap-xs">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-xl">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : shift ? (
          /* ─── Active shift ─────────────────────────────── */
          <div className="flex flex-col gap-md">
            <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
              <div className="flex items-center justify-between flex-wrap gap-sm pb-sm mb-md border-b border-surface-container">
                <div className="flex items-center gap-sm">
                  <span className="inline-flex items-center gap-xs px-sm py-1 rounded-full bg-success-container text-success text-label-sm font-semibold">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                    Open
                  </span>
                  <span className="font-inter text-body-sm text-on-surface-variant">
                    Opened by <strong className="text-on-surface">{shift.openedByName || "—"}</strong> · {formatDate(shift.openedAt)}
                  </span>
                </div>
                <span className="font-inter text-label-sm text-on-surface-variant">
                  Shift #{shift.id.slice(-6)}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
                {[
                  { label: "Opening Float", value: money(shift.openingFloat), icon: "savings" },
                  { label: "Cash Sales", value: money(shift.cashSales), icon: "payments" },
                  { label: "Expected in Drawer", value: money(shift.expectedCash), icon: "account_balance_wallet" },
                  { label: "Total Sales", value: money(shift.totalSales), icon: "trending_up" },
                ].map((card) => (
                  <div key={card.label} className="bg-surface-container-low rounded-xl p-md">
                    <div className="flex items-center gap-xs text-on-surface-variant mb-xs">
                      <span className="material-symbols-outlined text-[16px]">{card.icon}</span>
                      <span className="font-inter text-label-sm">{card.label}</span>
                    </div>
                    <p className="font-inter font-bold text-body-lg text-on-surface">{card.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-md pt-md border-t border-surface-container">
                <p className="font-inter font-semibold text-label-md text-on-surface-variant mb-sm">
                  Payment Breakdown · {shift.orderCount} settled order(s)
                </p>
                <div className="flex flex-wrap gap-sm">
                  {Object.entries(shift.breakdown || {}).map(([method, amount]) => (
                    <div key={method} className="flex items-center gap-xs bg-surface-container-low rounded-lg px-sm py-xs">
                      <span className="font-inter text-label-sm text-on-surface-variant">{METHOD_LABELS[method] || method}</span>
                      <span className="font-inter font-semibold text-body-sm text-on-surface">{money(amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Close drawer */}
            <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
              <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
                Close Shift & Reconcile Drawer
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
                <div className="flex flex-col gap-xs">
                  <label className="font-inter font-semibold text-label-md text-on-surface">Counted Cash at Close</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closingFloat}
                    onChange={(e) => setClosingFloat(e.target.value)}
                    placeholder={String(shift.expectedCash ?? 0)}
                    className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="font-inter font-semibold text-label-md text-on-surface">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional handover note"
                    className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="font-inter font-semibold text-label-md text-on-surface">Variance</label>
                  <div
                    className={`w-full h-12 rounded-xl px-md flex items-center font-inter font-bold text-body-md ${
                      liveDifference === null
                        ? "bg-surface-container-low text-on-surface-variant"
                        : liveDifference === 0
                          ? "bg-success-container text-success"
                          : liveDifference > 0
                            ? "bg-warning-container text-warning"
                            : "bg-error-container text-on-error-container"
                    }`}
                  >
                    {liveDifference === null ? "Enter counted cash" : `${liveDifference >= 0 ? "+" : ""}${money(liveDifference)}`}
                  </div>
                </div>
              </div>
              <div className="flex justify-end mt-md">
                <Button variant="primary" onClick={handleClose} disabled={isPending || closingFloat === ""}>
                  <span className="material-symbols-outlined text-[18px]">lock</span>
                  {isPending ? "Closing..." : "Close Shift"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* ─── No open shift → open drawer ───────────────── */
          <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container max-w-[520px]">
            <div className="flex items-center gap-sm mb-sm">
              <span className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <span className="material-symbols-outlined text-[22px]">lock_open</span>
              </span>
              <div>
                <h3 className="font-inter font-semibold text-body-lg text-on-surface">Open a New Shift</h3>
                <p className="font-inter text-body-sm text-on-surface-variant">
                  Count the opening cash float and start the drawer for this shift.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-md mt-md">
              <div className="flex flex-col gap-xs">
                <label className="font-inter font-semibold text-label-md text-on-surface">Opening Float (cash in drawer)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <div className="flex flex-col gap-xs">
                <label className="font-inter font-semibold text-label-md text-on-surface">Notes</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
              <Button variant="primary" onClick={handleOpen} disabled={isPending}>
                <span className="material-symbols-outlined text-[18px]">lock_open</span>
                {isPending ? "Opening..." : "Open Shift"}
              </Button>
            </div>
          </div>
        )}

        {/* ─── History ──────────────────────────────────── */}
        <div>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">Shift History</h3>
          {history.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container py-xl text-center">
              <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40">history</span>
              <p className="font-inter text-body-sm text-on-surface-variant mt-xs">No closed shifts yet.</p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
              <div className="hidden md:grid grid-cols-[1.6fr_1.2fr_1fr_1fr_1fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
                {["Closed By", "Closed At", "Total Sales", "Expected Cash", "Variance"].map((h) => (
                  <span key={h} className="font-inter font-semibold text-label-sm text-on-surface-variant">
                    {h}
                  </span>
                ))}
              </div>
              {history.map((s) => {
                const diff = Number(s.difference || 0);
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-1 md:grid-cols-[1.6fr_1.2fr_1fr_1fr_1fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
                  >
                    <span className="font-inter text-body-sm text-on-surface font-semibold">{s.closedByName || "—"}</span>
                    <span className="font-inter text-body-sm text-on-surface-variant">{formatDate(s.closedAt)}</span>
                    <span className="font-inter text-body-sm text-on-surface">{money(s.totalSales)}</span>
                    <span className="font-inter text-body-sm text-on-surface">{money(s.expectedCash)}</span>
                    <span
                      className={`font-inter text-body-sm font-semibold ${
                        diff === 0 ? "text-success" : diff > 0 ? "text-warning" : "text-on-error-container"
                      }`}
                    >
                      {diff >= 0 ? "+" : ""}
                      {money(diff)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ShiftClient;
