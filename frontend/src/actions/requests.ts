"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";

export async function createWaiterRequest(tableId: string, requestType: string) {
  try {
    const response = await apiClient.post("/requests", {
      tableId,
      requestType,
    });
    
    revalidatePath("/cafe/requests");
    revalidatePath("/cafe/tables");
    
    return {
      success: true,
      request: response.data.request,
    };
  } catch (error: unknown) {
    console.error("Failed to create waiter request:", error);
    throw new Error(apiErrorMessage(error, "Failed to create waiter request."));
  }
}

export async function resolveWaiterRequest(requestId: string) {
  try {
    const response = await apiClient.put(`/requests/${requestId}`);
    
    revalidatePath("/cafe/requests");
    revalidatePath("/cafe/tables");
    
    return {
      success: true,
      request: response.data.request,
    };
  } catch (error: unknown) {
    console.error("Failed to resolve waiter request:", error);
    throw new Error(apiErrorMessage(error, "Failed to resolve waiter request."));
  }
}
