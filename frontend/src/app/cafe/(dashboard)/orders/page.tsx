import React from "react";
import { OrdersClient } from "./OrdersClient";
import { Order } from "@/types";
import { apiClient } from "@/lib/apiClient";
import { getCurrentUserAction } from "@/actions/auth";
import { requirePathAccess } from "@/lib/session";
import { asRawOrders, mapRawOrders } from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams,
}: {
  // Awaited per the Next.js 15+ async `searchParams` contract.
  searchParams: Promise<{ denied?: string }>;
}) {
  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/orders");

  let orders: Order[] = [];
  let cafeId = "";

  try {
    const [ordersRes, userRes] = await Promise.all([
      apiClient.get("/orders", { params: { limit: 100 } }),
      getCurrentUserAction(),
    ]);

    orders = mapRawOrders(asRawOrders(ordersRes.data.orders));
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch admin orders or user details:", error);
  }

  return (
    <OrdersClient
      initialOrders={orders}
      cafeId={cafeId}
      accessDenied={(await searchParams).denied === "1"}
    />
  );
}