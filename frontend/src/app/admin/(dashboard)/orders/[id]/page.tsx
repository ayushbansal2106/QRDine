import React from "react";
import { notFound } from "next/navigation";
import { Order, OrderStatus } from "@/types";
import { getOrderAction } from "@/actions/orders";
import { OrderDetailClient } from "./OrderDetailClient";

interface OrderDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = await params;

  let order: any = null;

  try {
    const res = await getOrderAction(id);
    if (res.success) {
      order = res.order;
    }
  } catch (error) {
    console.error("Error loading admin order details:", error);
  }

  if (!order) {
    notFound();
  }

  // Transform MongoDB database order object into frontend type structure
  const mappedOrder = {
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
    acceptedAt: order.acceptedAt ? new Date(order.acceptedAt) : null,
    preparingAt: order.preparingAt ? new Date(order.preparingAt) : null,
    readyAt: order.readyAt ? new Date(order.readyAt) : null,
    servedAt: order.servedAt ? new Date(order.servedAt) : null,
    cancelledAt: order.cancelledAt ? new Date(order.cancelledAt) : null,
    items: (order.items || []).map((item: any, idx: number) => ({
      id: String(idx),
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      price: Number(item.price),
      name: item.itemName || "Unknown Item",
    })),
  };

  return <OrderDetailClient order={mappedOrder} />;
}
