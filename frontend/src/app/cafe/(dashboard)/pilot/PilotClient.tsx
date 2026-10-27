"use client";

import React, { useState, useEffect, useTransition } from "react";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { formatCurrency } from "@/utils/currency";
import {
  getPilotStatus,
  logPilotShift,
  advancePilotPhase,
  issueGaSignoffCertificate,
  type PilotRunData,
  type PilotAuditData,
  type DailyShiftLog,
} from "@/actions/pilot";

export const PilotClient: React.FC = () => {
  const [pilot, setPilot] = useState<PilotRunData | null>(null);
  const [audit, setAudit] = useState<PilotAuditData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Modals
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [isSignoffModalOpen, setIsSignoffModalOpen] = useState(false);
  const [signoffName, setSignoffName] = useState("");

  // Shift form
  const [shiftForm, setShiftForm] = useState({
    totalOrders: 0,
    totalSales: 0,
    cashCollected: 0,
    digitalCollected: 0,
    discrepancyAmount: 0,
    droppedOrdersCount: 0,
    kitchenLatencyAvgMinutes: 12,
    staffFeedbackNotes: "",
  });

  const loadData = async () => {
    try {
      const res = await getPilotStatus();
      if (res.success && res.pilot) {
        setPilot(res.pilot);
        if (res.audit) setAudit(res.audit);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load pilot status" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleLogShift = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await logPilotShift({
          totalOrders: Number(shiftForm.totalOrders),
          totalSales: Number(shiftForm.totalSales),
          cashCollected: Number(shiftForm.cashCollected),
          digitalCollected: Number(shiftForm.digitalCollected),
          discrepancyAmount: Number(shiftForm.discrepancyAmount),
          droppedOrdersCount: Number(shiftForm.droppedOrdersCount),
          kitchenLatencyAvgMinutes: Number(shiftForm.kitchenLatencyAvgMinutes),
          staffFeedbackNotes: shiftForm.staffFeedbackNotes,
        });

        if (res.success && res.pilot) {
          setPilot(res.pilot);
          setIsLogModalOpen(false);
          setShiftForm({
            totalOrders: 0,
            totalSales: 0,
            cashCollected: 0,
            digitalCollected: 0,
            discrepancyAmount: 0,
            droppedOrdersCount: 0,
            kitchenLatencyAvgMinutes: 12,
            staffFeedbackNotes: "",
          });
          setMessage({ type: "success", text: "Daily shift log saved and reconciled successfully." });
          void loadData();
        } else {
          setMessage({ type: "error", text: res.message || "Failed to log shift." });
        }
      } catch (err: unknown) {
        setMessage({ type: "error", text: "An error occurred while saving shift log." });
      }
    });
  };

  const handleAdvancePhase = () => {
    if (!confirm("Are you sure you want to advance the pilot to the next phase?")) return;

    startTransition(async () => {
      try {
        const res = await advancePilotPhase();
        if (res.success && res.pilot) {
          setPilot(res.pilot);
          setMessage({ type: "success", text: `Pilot successfully advanced to: ${res.pilot.currentPhase}` });
          void loadData();
        } else {
          setMessage({ type: "error", text: res.message || "Failed to advance phase." });
        }
      } catch {
        setMessage({ type: "error", text: "Failed to advance phase." });
      }
    });
  };

  const handleSignoff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signoffName.trim()) return;

    startTransition(async () => {
      try {
        const res = await issueGaSignoffCertificate(signoffName.trim());
        if (res.success) {
          setIsSignoffModalOpen(false);
          setMessage({
            type: "success",
            text: `General Availability (GA) certificate approved: ${res.certificate?.certificateNumber}`,
          });
          void loadData();
        } else {
          setMessage({ type: "error", text: res.message || "Failed to issue GA sign-off." });
        }
      } catch {
        setMessage({ type: "error", text: "Sign-off approval failed." });
      }
    });
  };

  const getPhaseDisplay = (phase: string) => {
    switch (phase) {
      case "phase_1_shadow":
        return { label: "Phase 1: Shadow Mode (Days 1–3)", color: "bg-amber-100 text-amber-800" };
      case "phase_2_limited_qr":
        return { label: "Phase 2: Limited QR (Days 4–7)", color: "bg-indigo-100 text-indigo-800" };
      case "phase_3_full_venue":
        return { label: "Phase 3: Full Venue (Days 8–14)", color: "bg-emerald-100 text-emerald-800" };
      case "completed":
        return { label: "General Availability (GA) Certified", color: "bg-emerald-600 text-white" };
      default:
        return { label: phase, color: "bg-slate-100 text-slate-800" };
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-surface min-h-screen">
      <TopAppBar title="14-Day Physical Pilot Rollout" />

      <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Banner Alert */}
        {message && (
          <div
            className={`p-4 rounded-xl text-sm font-medium ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-rose-50 text-rose-800 border border-rose-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Header Hero */}
        <div className="bg-surface-container-lowest border border-surface-container rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-on-surface">Physical Restaurant Pilot (Gate 4)</h1>
              {pilot && (
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${getPhaseDisplay(pilot.currentPhase).color}`}>
                  {getPhaseDisplay(pilot.currentPhase).label}
                </span>
              )}
            </div>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Live venue operational verification: 3-phase rollout tracking daily POS reconciliation, kitchen display
              latency, and zero-discrepancy General Availability exit criteria.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setIsLogModalOpen(true)}
              disabled={isLoading || isPending || pilot?.status === "completed"}
            >
              + Log Daily Shift
            </Button>
            {pilot?.currentPhase !== "completed" ? (
              <Button
                variant="outline"
                onClick={handleAdvancePhase}
                disabled={isLoading || isPending}
              >
                Advance Phase ➔
              </Button>
            ) : null}
            {audit?.isEligibleForGaSignoff && !pilot?.exitCriteria?.ownerSignoff && (
              <Button
                variant="primary"
                onClick={() => setIsSignoffModalOpen(true)}
                disabled={isLoading || isPending}
              >
                Sign Off GA Certificate 📜
              </Button>
            )}
          </div>
        </div>

        {/* 3-Phase Stepper */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            className={`p-4 rounded-xl border ${
              pilot?.currentPhase === "phase_1_shadow"
                ? "border-primary bg-primary/5"
                : "border-surface-container bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Phase 1 (Days 1–3)</span>
              <span className="material-symbols-outlined text-[18px] text-amber-600">receipt_long</span>
            </div>
            <h3 className="font-semibold text-on-surface mt-1">Shadow Mode</h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Staff enter all orders into POS alongside paper tickets. Customer QR table ordering disabled.
            </p>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              pilot?.currentPhase === "phase_2_limited_qr"
                ? "border-primary bg-primary/5"
                : "border-surface-container bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Phase 2 (Days 4–7)</span>
              <span className="material-symbols-outlined text-[18px] text-indigo-600">qr_code_scanner</span>
            </div>
            <h3 className="font-semibold text-on-surface mt-1">Limited QR Pilot</h3>
            <p className="text-xs text-on-surface-variant mt-1">
              QR table ordering enabled strictly on Tables 1–4. Waitstaff monitor kitchen screen sync.
            </p>
          </div>

          <div
            className={`p-4 rounded-xl border ${
              pilot?.currentPhase === "phase_3_full_venue" || pilot?.currentPhase === "completed"
                ? "border-primary bg-primary/5"
                : "border-surface-container bg-surface-container-lowest"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">Phase 3 (Days 8–14)</span>
              <span className="material-symbols-outlined text-[18px] text-emerald-600">storefront</span>
            </div>
            <h3 className="font-semibold text-on-surface mt-1">Full-Venue QR</h3>
            <p className="text-xs text-on-surface-variant mt-1">
              Contact-free QR ordering and digital payments active across all physical tables.
            </p>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-4">
            <span className="text-xs text-on-surface-variant">Current Progress</span>
            <div className="text-2xl font-bold text-on-surface mt-1">Day {pilot?.currentDay ?? 1} / 14</div>
            <span className="text-xs text-on-surface-variant">{pilot?.dailyLogs?.length ?? 0} shifts logged</span>
          </div>
          <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-4">
            <span className="text-xs text-on-surface-variant">Total Pilot Orders</span>
            <div className="text-2xl font-bold text-on-surface mt-1">
              {pilot?.metrics?.totalOrdersHandled ?? 0}
            </div>
            <span className="text-xs text-emerald-600">Processed live</span>
          </div>
          <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-4">
            <span className="text-xs text-on-surface-variant">Cumulative Sales</span>
            <div className="text-2xl font-bold text-on-surface mt-1">
              {formatCurrency(pilot?.metrics?.totalSalesRupees ?? 0)}
            </div>
            <span className="text-xs text-on-surface-variant">Reconciled till</span>
          </div>
          <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-4">
            <span className="text-xs text-on-surface-variant">Discrepancies / Dropped</span>
            <div className="text-2xl font-bold text-on-surface mt-1 flex items-center gap-1">
              <span className={pilot?.metrics?.cumulativeDiscrepancy === 0 ? "text-emerald-600" : "text-rose-600"}>
                ₹{pilot?.metrics?.cumulativeDiscrepancy ?? 0}
              </span>
              <span className="text-xs font-normal text-on-surface-variant">/ {pilot?.metrics?.totalDroppedOrders ?? 0}</span>
            </div>
            <span className="text-xs text-emerald-600">Target: Zero error rate</span>
          </div>
        </div>

        {/* GA Signoff Certificate Banner if signed */}
        {pilot?.exitCriteria?.ownerSignoff && (
          <div className="p-6 bg-emerald-50 border-2 border-emerald-500 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-4">
              <span className="text-4xl">🏆</span>
              <div>
                <h3 className="text-lg font-bold text-emerald-950">
                  General Availability (GA) Sign-Off Approved
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Certificate Number: <code className="font-mono font-bold">{pilot.exitCriteria.gaCertificateNumber}</code> •
                  Signed by: <strong>{pilot.exitCriteria.ownerSignoffName}</strong> on{" "}
                  {new Date(pilot.exitCriteria.ownerSignoffDate || "").toLocaleDateString()}
                </p>
              </div>
            </div>
            <span className="px-3 py-1 bg-emerald-600 text-white rounded-full text-xs font-bold">
              Gate 4 Cleared
            </span>
          </div>
        )}

        {/* Daily Shift Logs Table */}
        <div className="bg-surface-container-lowest border border-surface-container rounded-2xl p-6 shadow-sm">
          <h2 className="text-lg font-bold text-on-surface mb-4">Daily Shift Reconciliation History</h2>

          {isLoading ? (
            <div className="py-8 text-center text-sm text-on-surface-variant">Loading pilot ledger...</div>
          ) : !pilot?.dailyLogs || pilot.dailyLogs.length === 0 ? (
            <div className="py-12 text-center text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl mb-2 text-outline">history</span>
              <p className="font-medium text-sm">No daily shifts logged yet.</p>
              <p className="text-xs mt-1">Click &quot;+ Log Daily Shift&quot; after each service to record till reconciliation.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-surface-container text-xs font-bold text-on-surface-variant">
                    <th className="py-3 px-4">Day</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Phase</th>
                    <th className="py-3 px-4">Orders</th>
                    <th className="py-3 px-4">Sales (Cash / Digital)</th>
                    <th className="py-3 px-4">Discrepancy</th>
                    <th className="py-3 px-4">Dropped</th>
                    <th className="py-3 px-4">Audit Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  {pilot.dailyLogs.map((log: DailyShiftLog) => (
                    <tr key={log._id} className="hover:bg-surface-container/20 transition-colors">
                      <td className="py-3 px-4 font-bold text-on-surface">Day {log.dayNumber}</td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant">
                        {new Date(log.date).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-container text-on-surface">
                          {log.phase}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">{log.totalOrders}</td>
                      <td className="py-3 px-4 text-xs font-mono">
                        {formatCurrency(log.totalSales)} (₹{log.cashCollected} / ₹{log.digitalCollected})
                      </td>
                      <td className="py-3 px-4 font-mono font-bold">
                        <span className={log.discrepancyAmount === 0 ? "text-emerald-600" : "text-rose-600"}>
                          ₹{log.discrepancyAmount}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono">{log.droppedOrdersCount}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                            log.passedDailyAudit ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                          }`}
                        >
                          {log.passedDailyAudit ? "Balanced" : "Discrepancy"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Log Shift Modal */}
      <Modal isOpen={isLogModalOpen} onClose={() => setIsLogModalOpen(false)} title="Log Daily Shift Reconciliation">
        <form onSubmit={handleLogShift} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Total Orders</label>
              <input
                type="number"
                min="0"
                value={shiftForm.totalOrders}
                onChange={(e) => setShiftForm({ ...shiftForm, totalOrders: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Total Sales (₹)</label>
              <input
                type="number"
                min="0"
                value={shiftForm.totalSales}
                onChange={(e) => setShiftForm({ ...shiftForm, totalSales: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Cash In Till (₹)</label>
              <input
                type="number"
                min="0"
                value={shiftForm.cashCollected}
                onChange={(e) => setShiftForm({ ...shiftForm, cashCollected: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Digital / UPI Collected (₹)</label>
              <input
                type="number"
                min="0"
                value={shiftForm.digitalCollected}
                onChange={(e) => setShiftForm({ ...shiftForm, digitalCollected: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Till Discrepancy (₹)</label>
              <input
                type="number"
                value={shiftForm.discrepancyAmount}
                onChange={(e) => setShiftForm({ ...shiftForm, discrepancyAmount: Number(e.target.value) })}
                placeholder="0 for perfect match"
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-on-surface mb-1">Dropped Orders Count</label>
              <input
                type="number"
                min="0"
                value={shiftForm.droppedOrdersCount}
                onChange={(e) => setShiftForm({ ...shiftForm, droppedOrdersCount: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">Staff Notes & Service Feedback</label>
            <textarea
              value={shiftForm.staffFeedbackNotes}
              onChange={(e) => setShiftForm({ ...shiftForm, staffFeedbackNotes: e.target.value })}
              rows={2}
              placeholder="e.g. Smooth service, zero kitchen ticket printer delays."
              className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsLogModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : "Save Daily Log"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* GA Signoff Modal */}
      <Modal
        isOpen={isSignoffModalOpen}
        onClose={() => setIsSignoffModalOpen(false)}
        title="Sign Off General Availability (GA) Certificate"
      >
        <form onSubmit={handleSignoff} className="space-y-4">
          <p className="text-xs text-on-surface-variant leading-relaxed">
            All pilot exit criteria are satisfied: <strong>zero billing discrepancies</strong>,{" "}
            <strong>zero cross-tenant leakages</strong>, and <strong>zero dropped orders</strong>. Enter the
            restaurant owner&apos;s full legal name to issue the cryptographic General Availability release certificate.
          </p>
          <div>
            <label className="block text-xs font-semibold text-on-surface mb-1">
              Restaurant Owner Full Name (Legal Sign-off)
            </label>
            <input
              type="text"
              value={signoffName}
              onChange={(e) => setSignoffName(e.target.value)}
              placeholder="e.g. Rajeev Singhal"
              className="w-full px-3 py-2 border border-surface-container rounded-lg text-sm"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setIsSignoffModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending || !signoffName.trim()}>
              {isPending ? "Approving..." : "Approve & Issue GA Certificate"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
