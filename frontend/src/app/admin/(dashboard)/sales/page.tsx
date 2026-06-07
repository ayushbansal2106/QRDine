import React from "react";
import { SalesHistoryClient } from "@/components/admin/SalesHistoryClient";

export const dynamic = "force-dynamic";

export default async function AdminSalesPage() {
  return <SalesHistoryClient />;
}
