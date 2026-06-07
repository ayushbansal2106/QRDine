import React from "react";
import { notFound } from "next/navigation";
import { OrderTrackingClient } from "@/components/order/OrderTrackingClient";
import { getPublicOrderAction } from "@/actions/orders";

interface TrackingPageProps {
  params: Promise<{ orderId: string }>;
}

export default async function TrackingPage({ params }: TrackingPageProps) {
  const { orderId } = await params;

  let order: any = null;

  try {
    const res = await getPublicOrderAction(orderId);
    if (res.success) {
      order = res.order;
    }
  } catch (error) {
    console.error("Error loading order tracking details:", error);
  }

  if (!order) {
    notFound();
  }

  return <OrderTrackingClient initialOrder={order} />;
}
