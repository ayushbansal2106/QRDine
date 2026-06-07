import React from "react";
import { getTablesAction } from "@/actions/tables";
import { Table, TableStatus } from "@/types";
import { QrManagementClient } from "./QrManagementClient";

export const dynamic = "force-dynamic";

export default async function AdminQrPage() {
  let initialTables: any[] = [];
  let totalPages = 1;
  let totalCount = 0;

  try {
    const res = await getTablesAction(1, 12);
    if (res.success) {
      initialTables = res.tables || [];
      totalPages = res.totalPages || 1;
      totalCount = res.totalCount || 0;
    }
  } catch (error) {
    console.error("Error fetching initial QR tables data:", error);
  }

  // Transform database objects to frontend structures
  const mappedTables = initialTables.map((table: any) => ({
    id: table._id,
    tableNumber: parseInt(table.tableNumber, 10) || 0,
    status: (table.isActive ? "FREE" : "ASSISTANCE_REQUIRED") as TableStatus,
    qrCodeUrl: table.qrCodeUrl || `/table/${table.tableNumber}`,
    guestUrl: table.guestUrl || `https://qrdine.local/guest/${table._id}`,
    createdAt: new Date(table.createdAt),
    isActive: table.isActive !== false, // default to true
  }));

  return (
    <QrManagementClient
      initialTables={mappedTables}
      initialTotalPages={totalPages}
      initialTotalCount={totalCount}
    />
  );
}
