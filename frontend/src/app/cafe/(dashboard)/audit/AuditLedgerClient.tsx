"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useTransition } from "react";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { formatCurrency } from "@/utils/currency";
import {
  searchBills,
  exportBillsCsv,
  getSettlementReport,
  getAuditEvents,
} from "@/actions/ledger";
import { IncidentRecord } from "@/types";
import { getIncidents, reportIncident, updateIncident } from "@/actions/incidents";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";

export interface BillRow {
  id: string;
  invoiceNumber?: string | null;
  customerName?: string;
  customerEmail?: string;
  paymentMethod?: string;
  subtotal?: number;
  gst?: number;
  totalAmount?: number;
  endedAt?: string;
  tableId?: { tableNumber?: number | string };
  invoice?: { id: string; invoiceNumber: string; pdfUrl: string } | null;
}

export interface AuditRow {
  _id: string;
  type: string;
  entityType: string;
  amount: number;
  staffName: string;
  createdAt: string;
  entryHash: string;
}

interface Settlement {
  date: string;
  totalBills: number;
  totalRevenue: number;
  totalGST: number;
  byMethod: { method: string; count: number; revenue: number }[];
}

const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

export const AuditLedgerClient: React.FC<{
  initialBills: BillRow[];
  initialEntries: AuditRow[];
}> = ({ initialBills, initialEntries }) => {
  const [tab, setTab] = useState<"bills" | "audit" | "incidents">("bills");
  const [isPending, startTransition] = useTransition();

  const [bills, setBills] = useState<BillRow[]>(initialBills);
  const [entries, setEntries] = useState<AuditRow[]>(initialEntries);
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportForm, setReportForm] = useState({
    title: "",
    description: "",
    severity: "SEV-3" as "SEV-1" | "SEV-2" | "SEV-3",
    category: "operational" as "billing" | "data_isolation" | "realtime_outage" | "security_breach" | "operational",
    isPersonalDataInvolved: false,
    affectedOrderId: "",
  });
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState("");

  const [q, setQ] = useState("");
  const [method, setMethod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState({ totalRevenue: 0, totalGST: 0, count: 0 });
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [error, setError] = useState("");

  const runSearch = () => {
    setError("");
    startTransition(async () => {
      const res = await searchBills({ q, method, from, to, limit: 25 });
      if (res.success && "bills" in res) {
        setBills(res.bills as BillRow[]);
        setSummary(res.summary as typeof summary);
      } else {
        setError("Failed to search bills.");
      }
    });
  };

  const handleExport = () => {
    startTransition(async () => {
      try {
        const res = await exportBillsCsv({ q, method, from, to });
        const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = res.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err: unknown) {
        setError(thrownMessage(err, "Export failed"));
      }
    });
  };

  const handleSettlement = () => {
    startTransition(async () => {
      const res = await getSettlementReport(from || undefined);
      if (res.success && "byMethod" in res) {
        setSettlement(res as Settlement);
      }
    });
  };

  const loadAudit = () => {
    startTransition(async () => {
      const res = await getAuditEvents({ limit: 50 });
      if (res.success && "entries" in res) {
        setEntries(res.entries as AuditRow[]);
      }
    });
  };

  const loadIncidents = () => {
    setIncidentLoading(true);
    startTransition(async () => {
      try {
        const res = await getIncidents();
        if (res.success && res.incidents) {
          setIncidents(res.incidents);
        }
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to load incidents"));
      } finally {
        setIncidentLoading(false);
      }
    });
  };

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReportError("");
    setReportSuccess("");

    if (!reportForm.title.trim() || !reportForm.description.trim()) {
      setReportError("Title and description are required");
      return;
    }

    startTransition(async () => {
      try {
        const res = await reportIncident({
          title: reportForm.title.trim(),
          description: reportForm.description.trim(),
          severity: reportForm.severity,
          category: reportForm.category,
          isPersonalDataInvolved: reportForm.isPersonalDataInvolved,
          affectedOrderId: reportForm.affectedOrderId.trim() || undefined,
        });

        if (res.success) {
          setReportSuccess(`Incident ${res.incident.incidentId} submitted successfully.`);
          setReportForm({
            title: "",
            description: "",
            severity: "SEV-3",
            category: "operational",
            isPersonalDataInvolved: false,
            affectedOrderId: "",
          });
          setIsReportModalOpen(false);
          loadIncidents();
        }
      } catch (err: unknown) {
        setReportError(thrownMessage(err, "Failed to report incident"));
      }
    });
  };

  const handleUpdateStatus = (incidentId: string, status: "open" | "investigating" | "mitigated" | "resolved" | "closed") => {
    startTransition(async () => {
      try {
        await updateIncident(incidentId, { status });
        setIncidents((prev) =>
          prev.map((inc) => (inc.incidentId === incidentId ? { ...inc, status } : inc))
        );
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to update incident status"));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Audit & Ledger" iconName="history_edu" />

      <main className="flex-1 p-md overflow-y-auto">
        <div className="max-w-[1280px] mx-auto flex flex-col gap-md">
          {/* Tabs */}
          <div className="flex gap-xs">
            {(
              [
                { id: "bills", label: "Bills History" },
                { id: "audit", label: "Digital Audit Ledger" },
                { id: "incidents", label: "Incident Triage (Form C)" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  if (t.id === "audit") loadAudit();
                  if (t.id === "incidents") loadIncidents();
                }}
                className={`px-md py-xs rounded-full text-body-sm font-semibold ${
                  tab === t.id ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {error && <div className="text-body-sm text-error">{error}</div>}

          {tab === "bills" ? (
            <>
              {/* Search + export */}
              <div className="bg-surface-container-lowest rounded-xl border border-surface-container p-sm flex flex-wrap gap-sm items-end">
                <div className="flex-1 min-w-[200px] flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">Search</label>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Invoice no / customer"
                    className="bg-surface-container-low rounded-lg p-sm text-body-sm outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">Payment</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="bg-surface-container-low rounded-lg p-sm text-body-sm outline-none"
                  >
                    <option value="all">All</option>
                    <option value="paid_counter">Counter</option>
                    <option value="paid_online">Online</option>
                  </select>
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="bg-surface-container-low rounded-lg p-sm text-body-sm outline-none"
                  />
                </div>
                <div className="flex flex-col gap-xs">
                  <label className="text-label-sm text-on-surface-variant">To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="bg-surface-container-low rounded-lg p-sm text-body-sm outline-none"
                  />
                </div>
                <button
                  onClick={runSearch}
                  disabled={isPending}
                  className="h-10 px-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
                >
                  Search
                </button>
                <button
                  onClick={handleExport}
                  disabled={isPending}
                  className="h-10 px-md rounded-lg bg-surface-container text-on-surface font-semibold flex items-center gap-xs disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Tax CSV
                </button>
                <button
                  onClick={handleSettlement}
                  disabled={isPending}
                  className="h-10 px-md rounded-lg bg-surface-container text-on-surface font-semibold disabled:opacity-50"
                >
                  Settlement
                </button>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-3 gap-md">
                <div className="bg-surface-container-lowest rounded-xl border border-surface-container p-md">
                  <div className="text-label-sm text-on-surface-variant">Bills</div>
                  <div className="font-bold text-body-lg">{summary.count}</div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl border border-surface-container p-md">
                  <div className="text-label-sm text-on-surface-variant">Revenue</div>
                  <div className="font-bold text-body-lg text-primary">
                    {formatCurrency(summary.totalRevenue)}
                  </div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl border border-surface-container p-md">
                  <div className="text-label-sm text-on-surface-variant">GST Collected</div>
                  <div className="font-bold text-body-lg">{formatCurrency(summary.totalGST)}</div>
                </div>
              </div>

              {settlement && (
                <div className="bg-surface-container-lowest rounded-xl border border-surface-container p-md">
                  <h3 className="font-semibold text-body-md text-on-surface mb-sm">
                    Settlement · {settlement.date}
                  </h3>
                  <div className="flex flex-wrap gap-md">
                    {settlement.byMethod.map((m) => (
                      <div key={m.method} className="text-body-sm">
                        <span className="capitalize text-on-surface-variant">{m.method.replace("paid_", "")}</span>
                        <span className="ml-xs font-mono font-semibold">{formatCurrency(m.revenue)}</span>
                        <span className="ml-xs text-on-surface-variant">({m.count})</span>
                      </div>
                    ))}
                    {settlement.byMethod.length === 0 && (
                      <span className="text-body-sm text-on-surface-variant/50">No bills for this date.</span>
                    )}
                  </div>
                </div>
              )}

              {/* Bills table */}
              <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low/20 border-b border-surface-container text-on-surface-variant/80 text-label-md">
                      <th className="py-sm px-md font-semibold">Invoice</th>
                      <th className="py-sm px-md font-semibold">Date</th>
                      <th className="py-sm px-md font-semibold">Customer</th>
                      <th className="py-sm px-md font-semibold">Mode</th>
                      <th className="py-sm px-md font-semibold text-right">Subtotal</th>
                      <th className="py-sm px-md font-semibold text-right">GST</th>
                      <th className="py-sm px-md font-semibold text-right">Total</th>
                      <th className="py-sm px-md font-semibold text-right">Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container/60">
                    {bills.map((bill) => (
                      <tr key={bill.id} className="hover:bg-surface-container-low/30">
                        <td className="py-sm px-md font-mono text-body-sm">{bill.invoiceNumber || "—"}</td>
                        <td className="py-sm px-md text-body-sm text-on-surface-variant">{formatDate(bill.endedAt)}</td>
                        <td className="py-sm px-md text-body-sm">{bill.customerName || "Guest"}</td>
                        <td className="py-sm px-md text-body-sm capitalize">
                          {(bill.paymentMethod || "pending").replace("paid_", "")}
                        </td>
                        <td className="py-sm px-md text-right text-body-sm">{formatCurrency(bill.subtotal || 0)}</td>
                        <td className="py-sm px-md text-right text-body-sm">{formatCurrency(bill.gst || 0)}</td>
                        <td className="py-sm px-md text-right font-semibold">{formatCurrency(bill.totalAmount || 0)}</td>
                        <td className="py-sm px-md text-right">
                          {bill.invoice ? (
                            <a
                              href={`${process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api"}/invoices/${bill.invoice.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary text-body-sm font-semibold"
                            >
                              Reprint
                            </a>
                          ) : (
                            <span className="text-on-surface-variant/40 text-body-sm">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {bills.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-xl text-center text-on-surface-variant/40">
                          No bills match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === "audit" ? (
            /* Audit ledger */
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
              <div className="p-sm border-b border-surface-container flex justify-between items-center">
                <span className="font-semibold text-body-md text-on-surface">Immutable Ledger</span>
                <button
                  onClick={loadAudit}
                  disabled={isPending}
                  className="text-primary text-body-sm font-semibold disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/20 border-b border-surface-container text-on-surface-variant/80 text-label-md">
                    <th className="py-sm px-md font-semibold">When</th>
                    <th className="py-sm px-md font-semibold">Event</th>
                    <th className="py-sm px-md font-semibold">Entity</th>
                    <th className="py-sm px-md font-semibold">Staff</th>
                    <th className="py-sm px-md font-semibold text-right">Amount</th>
                    <th className="py-sm px-md font-semibold">Hash</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container/60">
                  {entries.map((entry) => (
                    <tr key={entry._id}>
                      <td className="py-sm px-md text-body-sm text-on-surface-variant">{formatDate(entry.createdAt)}</td>
                      <td className="py-sm px-md text-body-sm font-semibold">{entry.type}</td>
                      <td className="py-sm px-md text-body-sm">{entry.entityType || "—"}</td>
                      <td className="py-sm px-md text-body-sm">{entry.staffName || "—"}</td>
                      <td className="py-sm px-md text-right text-body-sm font-mono">
                        {entry.amount ? formatCurrency(entry.amount) : "—"}
                      </td>
                      <td className="py-sm px-md text-body-sm font-mono text-on-surface-variant/60">
                        {entry.entryHash?.slice(0, 12)}…
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-xl text-center text-on-surface-variant/40">
                        No ledger entries yet. Entries are written when bills close and on discounts/refunds.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* Incident Triage (Form C) */
            <div className="flex flex-col gap-md">
              {/* Statutory Notice */}
              <div className="bg-primary-container/10 border border-primary/20 rounded-xl p-md flex flex-col md:flex-row gap-md items-start md:items-center justify-between">
                <div className="flex gap-sm items-start">
                  <span className="material-symbols-outlined text-primary text-2xl mt-0.5">security</span>
                  <div>
                    <h4 className="font-semibold text-body-md text-on-surface mb-xs">
                      CERT-In & DPDP Act 2023 Statutory Incident Reporting Framework (Form C)
                    </h4>
                    <p className="text-body-sm text-on-surface-variant leading-relaxed">
                      Operational outages, payment timeouts, and potential security leaks are tracked with sanitized telemetry. Incidents involving customer personal data trigger mandatory 6-hour CERT-In notifications.
                    </p>
                  </div>
                </div>
                <Button
                  variant="primary"
                  onClick={() => setIsReportModalOpen(true)}
                  className="flex items-center gap-xs whitespace-nowrap self-stretch md:self-auto justify-center"
                >
                  <span className="material-symbols-outlined text-[18px]">add_alert</span>
                  Report Incident
                </Button>
              </div>

              {reportSuccess && (
                <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 p-sm rounded-xl text-body-sm">
                  {reportSuccess}
                </div>
              )}

              {/* Stat Counters */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <div className="text-label-sm text-on-surface-variant mb-xs">Total Incidents</div>
                  <div className="text-2xl font-bold font-mono text-on-surface">{incidents.length}</div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <div className="text-label-sm text-on-surface-variant mb-xs">Open / Active</div>
                  <div className="text-2xl font-bold font-mono text-amber-400">
                    {incidents.filter((i) => ["open", "investigating"].includes(i.status)).length}
                  </div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <div className="text-label-sm text-on-surface-variant mb-xs">SEV-1 Critical</div>
                  <div className="text-2xl font-bold font-mono text-error">
                    {incidents.filter((i) => i.severity === "SEV-1").length}
                  </div>
                </div>
                <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
                  <div className="text-label-sm text-on-surface-variant mb-xs">Personal Data Triage</div>
                  <div className="text-2xl font-bold font-mono text-primary">
                    {incidents.filter((i) => i.isPersonalDataInvolved).length}
                  </div>
                </div>
              </div>

              {/* Incidents Table */}
              <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
                <div className="p-sm border-b border-surface-container flex justify-between items-center">
                  <span className="font-semibold text-body-md text-on-surface">Recorded Operational & Security Incidents</span>
                  <button
                    onClick={loadIncidents}
                    disabled={isPending || incidentLoading}
                    className="text-primary text-body-sm font-semibold disabled:opacity-50"
                  >
                    Refresh
                  </button>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-surface-container-low/20 border-b border-surface-container text-on-surface-variant/80 text-label-md">
                      <th className="py-sm px-md font-semibold">Incident ID</th>
                      <th className="py-sm px-md font-semibold">Severity</th>
                      <th className="py-sm px-md font-semibold">Category</th>
                      <th className="py-sm px-md font-semibold">Summary</th>
                      <th className="py-sm px-md font-semibold">Data Scope</th>
                      <th className="py-sm px-md font-semibold">Status</th>
                      <th className="py-sm px-md font-semibold">Reported At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container/60">
                    {incidents.map((inc) => (
                      <tr key={inc.incidentId} className="hover:bg-surface-container-low/10 transition-colors">
                        <td className="py-sm px-md font-mono font-semibold text-primary text-body-sm">
                          {inc.incidentId}
                        </td>
                        <td className="py-sm px-md">
                          <span
                            className={`px-xs py-0.5 rounded text-label-sm font-semibold border ${
                              inc.severity === "SEV-1"
                                ? "bg-error/15 text-error border-error/30"
                                : inc.severity === "SEV-2"
                                ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                : "bg-info/15 text-info border-info/30"
                            }`}
                          >
                            {inc.severity}
                          </span>
                        </td>
                        <td className="py-sm px-md text-on-surface-variant capitalize text-body-sm">
                          {inc.category.replace("_", " ")}
                        </td>
                        <td className="py-sm px-md max-w-[20rem]">
                          <p className="font-semibold text-on-surface text-body-sm">{inc.title}</p>
                          <p className="text-on-surface-variant text-body-xs line-clamp-1">{inc.description}</p>
                        </td>
                        <td className="py-sm px-md">
                          {inc.isPersonalDataInvolved ? (
                            <span className="inline-flex items-center gap-1 text-xs text-error font-semibold bg-error/10 px-2 py-0.5 rounded-full border border-error/20">
                              <span className="material-symbols-outlined text-[13px]">warning</span>
                              DPDP Escalated
                            </span>
                          ) : (
                            <span className="text-xs text-on-surface-variant/60">Non-personal</span>
                          )}
                        </td>
                        <td className="py-sm px-md">
                          <select
                            value={inc.status}
                            onChange={(e) =>
                              handleUpdateStatus(
                                inc.incidentId,
                                e.target.value as "open" | "investigating" | "mitigated" | "resolved" | "closed"
                              )
                            }
                            className="bg-surface-container-low rounded px-2 py-1 text-xs font-semibold outline-none cursor-pointer border border-surface-container"
                          >
                            <option value="open">Open</option>
                            <option value="investigating">Investigating</option>
                            <option value="mitigated">Mitigated</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                        </td>
                        <td className="py-sm px-md text-body-xs text-on-surface-variant font-mono">
                          {formatDate(inc.createdAt)}
                        </td>
                      </tr>
                    ))}
                    {incidents.length === 0 && !incidentLoading && (
                      <tr>
                        <td colSpan={7} className="py-xl text-center text-on-surface-variant/50">
                          No production incidents recorded. Telemetry and runtime operations healthy.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Report Incident Modal */}
              <Modal
                isOpen={isReportModalOpen}
                onClose={() => setIsReportModalOpen(false)}
                title="Report Operational or Security Incident (Form C)"
              >
                <form onSubmit={handleReportSubmit} className="flex flex-col gap-md">
                  {reportError && (
                    <div className="bg-error/15 border border-error/30 text-error p-sm rounded-xl text-body-sm">
                      {reportError}
                    </div>
                  )}

                  <div className="flex flex-col gap-xs">
                    <label className="text-label-md font-semibold text-on-surface">Incident Title *</label>
                    <input
                      type="text"
                      value={reportForm.title}
                      onChange={(e) => setReportForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="e.g. Payment Gateway Webhook Timeout or Order Bump Delay"
                      className="w-full h-11 bg-surface-container-low rounded-xl px-md text-body-md text-on-surface outline-none border border-surface-container focus:border-primary"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-sm">
                    <div className="flex flex-col gap-xs">
                      <label className="text-label-md font-semibold text-on-surface">Severity *</label>
                      <select
                        value={reportForm.severity}
                        onChange={(e) =>
                          setReportForm((p) => ({
                            ...p,
                            severity: e.target.value as "SEV-1" | "SEV-2" | "SEV-3",
                          }))
                        }
                        className="w-full h-11 bg-surface-container-low rounded-xl px-md text-body-md text-on-surface outline-none border border-surface-container cursor-pointer"
                      >
                        <option value="SEV-1">SEV-1: Critical Outage / Security Breach</option>
                        <option value="SEV-2">SEV-2: Degradation / Payment Retry Lag</option>
                        <option value="SEV-3">SEV-3: Minor Operational Issue / Display Glitch</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-xs">
                      <label className="text-label-md font-semibold text-on-surface">Category *</label>
                      <select
                        value={reportForm.category}
                        onChange={(e) =>
                          setReportForm((p) => ({
                            ...p,
                            category: e.target.value as "billing" | "data_isolation" | "realtime_outage" | "security_breach" | "operational",
                          }))
                        }
                        className="w-full h-11 bg-surface-container-low rounded-xl px-md text-body-md text-on-surface outline-none border border-surface-container cursor-pointer"
                      >
                        <option value="operational">Operational</option>
                        <option value="billing">Billing & PG</option>
                        <option value="realtime_outage">Realtime / KDS Sync</option>
                        <option value="data_isolation">Data Isolation</option>
                        <option value="security_breach">Security Breach</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label className="text-label-md font-semibold text-on-surface">Affected Order ID (Optional)</label>
                    <input
                      type="text"
                      value={reportForm.affectedOrderId}
                      onChange={(e) => setReportForm((p) => ({ ...p, affectedOrderId: e.target.value }))}
                      placeholder="e.g. 64f123456789abcdef012345"
                      className="w-full h-11 bg-surface-container-low rounded-xl px-md text-body-md text-on-surface outline-none border border-surface-container font-mono"
                    />
                  </div>

                  <div className="flex flex-col gap-xs">
                    <label className="text-label-md font-semibold text-on-surface">Incident Description *</label>
                    <textarea
                      rows={3}
                      value={reportForm.description}
                      onChange={(e) => setReportForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Describe what happened, observed errors, and impact..."
                      className="w-full bg-surface-container-low rounded-xl p-md text-body-md text-on-surface outline-none border border-surface-container resize-none focus:border-primary"
                      required
                    />
                  </div>

                  <label className="flex items-start gap-sm cursor-pointer p-sm bg-surface-container-low rounded-xl">
                    <input
                      type="checkbox"
                      checked={reportForm.isPersonalDataInvolved}
                      onChange={(e) => setReportForm((p) => ({ ...p, isPersonalDataInvolved: e.target.checked }))}
                      className="mt-1 h-4 w-4 rounded accent-primary cursor-pointer"
                    />
                    <div className="text-body-sm text-on-surface">
                      <span className="font-semibold text-error">Personal Data Involved</span>
                      <p className="text-on-surface-variant text-body-xs">
                        Customer phone numbers, identity, or dining data compromised. Triggers CERT-In 6-hour forensic workflow.
                      </p>
                    </div>
                  </label>

                  <div className="flex justify-end gap-sm mt-sm">
                    <Button variant="outline" type="button" onClick={() => setIsReportModalOpen(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" type="submit" disabled={isPending}>
                      Submit Incident
                    </Button>
                  </div>
                </form>
              </Modal>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AuditLedgerClient;
