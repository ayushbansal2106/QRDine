import React from "react";
import { apiClient } from "@/lib/apiClient";
import { Coupon } from "@/types";
import { CouponsClient } from "./CouponsClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminCouponsPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/coupons");

  // Plan gate before the fetch: `GET /api/coupons` is entitled, so calling it
  // from a Starter cafe only produces a 403 and an empty screen.
  const gate = await planGate("coupons", "Coupons");
  if (gate) return gate;

  let coupons: Coupon[] = [];

  try {
    const res = await apiClient.get("/coupons");
    coupons = res.data.coupons || [];
  } catch (error) {
    console.error("Failed to load coupons:", error);
  }

  return <CouponsClient initialCoupons={coupons} />;
}
