"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";

export async function fetchKdsOrders(station?: string) {
  try {
    const response = await apiClient.get("/kds/orders", {
      params: station && station !== "all" ? { station } : {},
    });
    return { success: true as const, tickets: response.data.tickets };
  } catch (error: unknown) {
    console.error("Failed to load KDS orders:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to load KDS orders."),
      tickets: [],
    };
  }
}

export async function updateKdsItemStatus(
  orderId: string,
  itemId: string,
  status: "pending" | "preparing" | "ready"
) {
  try {
    const response = await apiClient.patch(`/kds/orders/${orderId}/items/${itemId}/status`, { status });
    revalidatePath("/cafe/orders");
    return { success: true as const, item: response.data.item };
  } catch (error: unknown) {
    console.error("Failed to update item status:", error);
    throw new Error(apiErrorMessage(error, "Failed to update item status."));
  }
}

export async function bumpKdsTicket(orderId: string) {
  try {
    const response = await apiClient.patch(`/kds/orders/${orderId}/bump`);
    revalidatePath("/cafe/orders");
    return { success: true as const, order: response.data.order };
  } catch (error: unknown) {
    console.error("Failed to bump ticket:", error);
    throw new Error(apiErrorMessage(error, "Failed to bump ticket."));
  }
}
