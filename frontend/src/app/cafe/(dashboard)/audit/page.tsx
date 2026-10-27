import React from "react";
import { apiClient } from "@/lib/apiClient";
import { AuditLedgerClient } from "./AuditLedgerClient";
import type { AuditRow, BillRow } from "./AuditLedgerClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/audit");

  // The ledger is a paid reporting surface. Checked before the fetch so a cafe
  // without `reports.export` gets the upgrade message instead of an empty table
  // and a 403 in the server log.
  const gate = await planGate("reports.export", "Audit & ledger");
  if (gate) return gate;

  let bills: BillRow[] = [];
  let entries: AuditRow[] = [];

  try {
    const [billsRes, auditRes] = await Promise.all([
      apiClient.get("/billing/bills/search", { params: { limit: 20 } }),
      apiClient.get("/audit", { params: { limit: 50 } }),
    ]);
    bills = billsRes.data.bills || [];
    entries = auditRes.data.entries || [];
  } catch (error) {
    console.error("Failed to load audit & ledger data:", error);
  }

  return <AuditLedgerClient initialBills={bills} initialEntries={entries} />;
}
