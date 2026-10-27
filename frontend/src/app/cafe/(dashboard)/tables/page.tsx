import React from "react";
import { apiClient } from "@/lib/apiClient";
import { Table } from "@/types";
import { TableManagementClient } from "./TableManagementClient";
import { requirePathAccess } from "@/lib/session";
import { mapRawTable, RawTable } from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminTablesPage() {
  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/tables");

  // `isActive` is not part of `Table` — it is the enable/disable flag the
  // toggle writes, and it is the only place the table's live state lives, so
  // it is intersected on rather than smuggled in with `as any`.
  let dbTables: RawTable[] = [];

  try {
    const response = await apiClient.get("/tables", { params: { limit: 100 } });
    dbTables = Array.isArray(response.data.tables) ? response.data.tables : [];
  } catch (error) {
    console.error("Error fetching admin tables data:", error);
  }

  const tables: (Table & { isActive: boolean })[] = dbTables.map((table) => ({
    ...mapRawTable(table),
    isActive: table.isActive ?? true,
  }));

  return <TableManagementClient initialTables={tables} />;
}