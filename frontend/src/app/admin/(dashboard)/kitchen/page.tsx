import React from "react";
import { KitchenClient } from "./KitchenClient";
import { Order, OrderStatus } from "@/types";
import { apiClient } from "@/lib/apiClient";
import { getCurrentUserAction } from "@/actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminKitchenPage() {
  let dbOrders: any[] = [];
  let cafeId = "";

  try {
    const [ordersRes, userRes] = await Promise.all([
      apiClient.get("/orders", { params: { limit: 100 } }),
      getCurrentUserAction(),
    ]);

    dbOrders = ordersRes.data.orders || [];
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch kitchen orders or user details:", error);
  }

  // Transform MongoDB database order objects into frontend Typescript Order structures
  const orders: Order[] = dbOrders.map((order: any) => ({
    id: order._id,
    tableId: order.tableId?._id || "",
    table: order.tableId ? {
      id: order.tableId._id,
      tableNumber: parseInt(order.tableId.tableNumber, 10) || 0,
      qrCodeUrl: order.tableId.qrCodeUrl || `/table/${order.tableId.tableNumber}`,
      status: order.tableId.isActive ? "FREE" : "ASSISTANCE_REQUIRED" as any,
      createdAt: new Date(order.tableId.createdAt),
    } : undefined,
    status: (order.status || "PENDING").toUpperCase() as OrderStatus,
    totalAmount: Number(order.totalAmount),
    notes: order.notes || "",
    createdAt: new Date(order.createdAt),
    orderNumber: order.orderNumber || "",
    items: (order.items || []).map((item: any, idx: number) => ({
      id: String(idx),
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      price: Number(item.price),
      name: item.itemName || "Unknown Item",
      // Include menuItem object for compatibility inside KitchenClient.tsx
      menuItem: {
        id: item.menuItemId,
        name: item.itemName || "Unknown Item",
        price: Number(item.price),
        description: "",
        imageUrl: "",
        available: true,
        gstPercentage: 0,
      }
    })),
  }));

  return <KitchenClient initialOrders={orders} cafeId={cafeId} />;
}

