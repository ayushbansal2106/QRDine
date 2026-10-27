import React from "react";
import { getTablesAction } from "@/actions/tables";
import { mapRawQrTables, type RawQrTable } from "@/lib/mappers";
import { QrManagementClient } from "./QrManagementClient";
import { requirePathAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminQrPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/qr");
  let initialTables: RawQrTable[] = [];
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

  const mappedTables = mapRawQrTables(initialTables);

  return (
    <QrManagementClient
      initialTables={mappedTables}
      initialTotalPages={totalPages}
      initialTotalCount={totalCount}
    />
  );
}
