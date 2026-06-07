"use server";

import { apiClient } from "@/lib/apiClient";
import { revalidatePath } from "next/cache";

export async function createWaiterRequest(tableId: string, requestType: string) {
  try {
    const response = await apiClient.post("/requests", {
      tableId,
      requestType,
    });
    
    revalidatePath("/admin/requests");
    revalidatePath("/admin/tables");
    
    return {
      success: true,
      request: response.data.request,
    };
  } catch (error: any) {
    console.error("Failed to create waiter request:", error);
    throw new Error(error.response?.data?.message || "Failed to create waiter request.");
  }
}

export async function resolveWaiterRequest(requestId: string) {
  try {
    const response = await apiClient.put(`/requests/${requestId}`);
    
    revalidatePath("/admin/requests");
    revalidatePath("/admin/tables");
    
    return {
      success: true,
      request: response.data.request,
    };
  } catch (error: any) {
    console.error("Failed to resolve waiter request:", error);
    throw new Error(error.response?.data?.message || "Failed to resolve waiter request.");
  }
}
