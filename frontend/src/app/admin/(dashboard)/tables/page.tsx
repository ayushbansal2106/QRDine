import React from "react";
import { apiClient } from "@/lib/apiClient";
import { Table, TableStatus } from "@/types";
import { TableManagementClient } from "./TableManagementClient";

export const dynamic = "force-dynamic";

export default async function AdminTablesPage() {
  let dbTables: any[] = [];

  try {
    const response = await apiClient.get("/tables", { params: { limit: 100 } });
    dbTables = response.data.tables || [];
  } catch (error) {
    console.error("Error fetching admin tables data:", error);
  }

  // Transform database objects to frontend types
  const tables: (Table & { isActive: boolean })[] = dbTables.map((table: any) => ({
    id: table._id,
    tableNumber: parseInt(table.tableNumber, 10) || 0,
    status: (table.isActive ? "FREE" : "ASSISTANCE_REQUIRED") as TableStatus, // use FREE or ASSISTANCE_REQUIRED as map fallback
    qrCodeUrl: table.qrCodeUrl || `/table/${table.tableNumber}`,
    createdAt: new Date(table.createdAt),
    // Attach isActive boolean locally to track enable/disable state
    isActive: table.isActive,
  } as any));

  return <TableManagementClient initialTables={tables} />;
}
