"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { WaiterMetrics, WaiterTable } from "@/types";
import { PosLineItem } from "@/actions/pos";
import { revalidatePath } from "next/cache";

export async function fetchWaiterTables() {
  try {
    const response = await apiClient.get("/waiter/tables");
    return { success: true as const, tables: response.data.tables as WaiterTable[] };
  } catch (error: unknown) {
    console.error("Failed to fetch waiter tables:", error);
    return {
      success: false as const,
      tables: [] as WaiterTable[],
      message: apiErrorMessage(error, "Failed to load tables."),
    };
  }
}

export async function createWaiterOrder(payload: {
  tableId: string;
  sessionId?: string;
  items: PosLineItem[];
  notes?: string;
  customerPhone?: string;
  customerName?: string;
  clientRequestId?: string;
}) {
  try {
    const response = await apiClient.post("/waiter/orders", payload);
    revalidatePath("/cafe/orders");
    return { success: true as const, order: response.data.order, sessionId: response.data.sessionId };
  } catch (error: unknown) {
    console.error("Failed to create waiter order:", error);
    throw new Error(apiErrorMessage(error, "Failed to fire order."));
  }
}

export async function fetchWaiterMetrics() {
  try {
    const response = await apiClient.get("/waiter/metrics");
    return { success: true as const, metrics: response.data.metrics as WaiterMetrics };
  } catch (error: unknown) {
    console.error("Failed to fetch waiter metrics:", error);
    return {
      success: false as const,
      metrics: null,
      message: apiErrorMessage(error, "Failed to load metrics."),
    };
  }
}
