import React from "react";
import { SalesHistoryClient } from "@/components/admin/SalesHistoryClient";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminSalesPage() {
  // Sales history reads `GET /api/billing/sales-history`, which is entitled
  // (`analytics`). Gate before the client mounts so it does not fire a request
  // the backend refuses and render an error box on top of a paywall.
  const gate = await planGate("analytics", "Sales history");
  if (gate) return gate;

  return <SalesHistoryClient />;
}
