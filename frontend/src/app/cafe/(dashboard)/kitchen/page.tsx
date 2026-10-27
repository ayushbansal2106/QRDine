import React from "react";
import { KitchenClient } from "./KitchenClient";
import { Order } from "@/types";
import { apiClient } from "@/lib/apiClient";
import { getCurrentUserAction } from "@/actions/auth";
import { requirePathAccess } from "@/lib/session";
import { asRawOrders, mapRawOrderForStaff } from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminKitchenPage() {
  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/kitchen");

  // The board reads per-item `status` / `prepStation`, which only
  // `mapRawOrderForStaff` preserves — the plain `Order` mapping drops them.
  let orders: Order[] = [];
  let cafeId = "";

  try {
    const [ordersRes, userRes] = await Promise.all([
      apiClient.get("/orders", { params: { limit: 100 } }),
      getCurrentUserAction(),
    ]);

    orders = asRawOrders(ordersRes.data.orders).map(mapRawOrderForStaff);
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch kitchen orders or user details:", error);
  }

  return <KitchenClient initialOrders={orders} cafeId={cafeId} />;
}