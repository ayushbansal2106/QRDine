import React from "react";
import { apiClient } from "@/lib/apiClient";
import { PosClient, type PosCatalog } from "./PosClient";
import { requirePathAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminPosPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/pos");

  // An empty catalog rather than a failed fetch: the till still renders and
  // explains itself, instead of the page erroring out on a permission blip.
  const emptyCatalog: PosCatalog = {
    categories: [],
    menuItems: [],
    tables: [],
    canDiscount: false,
    canRefund: false,
  };

  let catalog: PosCatalog = emptyCatalog;

  try {
    const res = await apiClient.get<PosCatalog>("/pos/catalog");
    catalog = res.data;
  } catch (error) {
    console.error("Failed to load POS catalog:", error);
  }

  return <PosClient catalog={catalog} />;
}