import React from "react";
import { notFound } from "next/navigation";
import { Order } from "@/types";
import { OrderTrackingClient } from "@/components/order/OrderTrackingClient";
import { getPublicOrderAction } from "@/actions/orders";
import { mapRawOrder } from "@/lib/mappers";

interface TrackingPageProps {
  params: Promise<{ orderId: string }>;
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { orderId } = await params;

  let order: Order | null = null;

  try {
    const res = await getPublicOrderAction(orderId);
    if (res.success) {
      order = mapRawOrder(res.order);
    }
  } catch (error) {
    console.error("Error loading order tracking details:", error);
  }

  if (!order) {
    notFound();
  }

  return <OrderTrackingClient initialOrder={order} />;
}