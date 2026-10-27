import React from "react";
import { notFound } from "next/navigation";
import { getOrderAction } from "@/actions/orders";
import { OrderDetailClient, type OrderForDetail } from "./OrderDetailClient";
import { mapRawOrderForStaff } from "@/lib/mappers";

interface OrderDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = await params;

  let order: OrderForDetail | null = null;

  try {
    const res = await getOrderAction(id);
    if (res.success) {
      order = mapRawOrderForStaff(res.order);
    }
  } catch (error) {
    console.error("Error loading admin order details:", error);
  }

  if (!order) {
    notFound();
  }

  return <OrderDetailClient order={order} />;
}