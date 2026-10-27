import React from "react";
import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { NfcTag, NfcStats, Table } from "@/types";
import { NfcManagerClient } from "./NfcManagerClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";
import { mapRawQrTables, RawQrTable } from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminNfcPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/nfc");

  // Plan gate before the fetch — tag management is Pro-only. Public taps on a
  // sticker already in the wild keep resolving; only this console is gated.
  const gate = await planGate("nfc", "NFC tags");
  if (gate) return gate;

  let tags: NfcTag[] = [];
  let stats: NfcStats | null = null;
  let tables: Table[] = [];
  let loadError: string | null = null;

  try {
    const [tagsRes, tablesRes] = await Promise.all([
      apiClient.get("/nfc/manage"),
      apiClient.get("/tables", { params: { limit: 100 } }),
    ]);
    tags = tagsRes.data.tags || [];
    stats = tagsRes.data.stats || null;
    const rawTables: RawQrTable[] = Array.isArray(tablesRes.data.tables)
      ? tablesRes.data.tables
      : [];
    // `GET /tables` returns raw Mongoose documents keyed by `_id`; the shared
    // `Table` type and NfcManagerClient both read `table.id` and
    // `table.tableNumber`. Leaving the raw docs unmapped left `t.id` undefined,
    // so every <option> got key={undefined} — a React list-key collision — and
    // selecting a table never bound the tag. Map once, here, mirroring
    // admin/tables/page.tsx so the values and keys are stable and defined.
    tables = mapRawQrTables(rawTables);
  } catch (error: unknown) {
    console.error("Failed to load NFC data:", error);
    loadError =
      apiErrorMessage(error, "Could not load NFC tags. Make sure your role has the NFC Tags permission.");
  }

  return <NfcManagerClient initialTags={tags} initialStats={stats} tables={tables} loadError={loadError} />;
}