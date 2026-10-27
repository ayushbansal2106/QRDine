import React from "react";
import { apiClient } from "@/lib/apiClient";
import { Wallet } from "@/types";
import { WalletsClient } from "./WalletsClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminWalletsPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/wallets");

  // Plan gate before the fetch — wallets are a Growth+ module, and balance data
  // must not be rendered for a cafe that cannot operate them.
  const gate = await planGate("wallet", "Wallets");
  if (gate) return gate;

  let wallets: Wallet[] = [];

  try {
    const res = await apiClient.get("/wallets", { params: { limit: 50 } });
    wallets = res.data.wallets || [];
  } catch (error) {
    console.error("Failed to load wallets:", error);
  }

  return <WalletsClient initialWallets={wallets} />;
}
