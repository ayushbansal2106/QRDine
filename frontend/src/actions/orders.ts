"use server";

import { apiClient } from "@/lib/apiClient";
import { OrderStatus } from "@/types";
import { revalidatePath } from "next/cache";

export async function createOrder(
  tableId: string,
  items: { menuItemId: string; quantity: number }[],
  notes?: string,
  sessionId?: string | null,
  participantId?: string | null,
  clientRequestId?: string | null
) {
  try {
    const response = await apiClient.post("/orders", {
      tableId,
      items,
      notes,
      sessionId: sessionId || undefined,
      participantId: participantId || undefined,
      clientRequestId: clientRequestId || undefined,
    });
    
    revalidatePath("/admin/orders");
    revalidatePath("/admin/kitchen");
    
    return {
      success: true,
      orderId: response.data.orderId,
      orderNumber: response.data.orderNumber,
      order: response.data.order,
    };
  } catch (error: any) {
    console.error("Failed to create order:", error);
    throw new Error(error.response?.data?.message || "Failed to create order.");
  }
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  try {
    const response = await apiClient.put(`/orders/${id}/status`, {
      status,
    });

    revalidatePath("/admin/orders");
    revalidatePath("/admin/kitchen");
    revalidatePath(`/admin/orders/${id}`);
    revalidatePath(`/order/${id}`);
    
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: any) {
    console.error("Failed to update order status:", error);
    throw new Error(error.response?.data?.message || "Failed to update order status.");
  }
}

export async function cancelOrderItem(orderId: string, itemId: string, reason: string) {
  try {
    const response = await apiClient.post(`/orders/${orderId}/items/${itemId}/cancel`, {
      cancellationReason: reason,
    });

    revalidatePath("/admin/orders");
    revalidatePath("/admin/kitchen");
    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath(`/order/${orderId}`);
    
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: any) {
    console.error("Failed to cancel order item:", error);
    throw new Error(error.response?.data?.message || "Failed to cancel item.");
  }
}

export async function getOrderAction(id: string) {
  try {
    const response = await apiClient.get(`/orders/${id}`);
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: any) {
    console.error("Failed to get order:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch order details.");
  }
}

export async function getPublicOrderAction(id: string) {
  try {
    const response = await apiClient.get(`/orders/public/${id}`);
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: any) {
    console.error("Failed to get public order:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch order details.");
  }
}

export async function getPublicOrderStatusAction(id: string) {
  try {
    const response = await apiClient.get(`/orders/public/${id}/status`);
    return {
      success: true,
      status: response.data.status as OrderStatus,
    };
  } catch (error: any) {
    console.error("Failed to get public order status:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch order status.");
  }
}
