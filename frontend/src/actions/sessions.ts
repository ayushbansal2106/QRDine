"use server";

import { apiClient } from "@/lib/apiClient";
import { revalidatePath } from "next/cache";

export async function createSession(
  tableId: string,
  customerName: string,
  customerEmail: string
) {
  try {
    const response = await apiClient.post("/sessions", {
      tableId,
      customerName,
      customerEmail,
    });

    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: any) {
    console.error("Failed to create session:", error);
    const message =
      error.response?.data?.message || "Failed to create dining session.";
    throw new Error(message);
  }
}

export async function getActiveSession(tableId: string) {
  try {
    const response = await apiClient.get(
      `/sessions/table/${tableId}/active`
    );

    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { success: false, session: null };
    }
    console.error("Failed to check active session:", error);
    throw new Error(
      error.response?.data?.message || "Failed to check session."
    );
  }
}

export async function getBillPreview(sessionId: string) {
  try {
    const response = await apiClient.get(
      `/sessions/${sessionId}/bill-preview`
    );
    return {
      success: true,
      bill: response.data.bill,
    };
  } catch (error: any) {
    console.error("Failed to get bill preview:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch bill preview."
    );
  }
}

export async function submitPaymentPreference(
  sessionId: string,
  paymentMethod: "paid_counter" | "paid_online"
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/submit-payment`,
      { paymentMethod }
    );

    revalidatePath("/admin/bills");

    return {
      success: true,
      message: response.data.message,
      session: response.data.session,
    };
  } catch (error: any) {
    console.error("Failed to submit payment preference:", error);
    throw new Error(
      error.response?.data?.message || "Failed to submit payment preference."
    );
  }
}

export async function getSessionsAdmin(filters?: {
  status?: string;
  page?: number;
  limit?: number;
  tableNumber?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/sessions", { params: filters });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get sessions:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch sessions."
    );
  }
}

export async function getSessionDetails(sessionId: string) {
  try {
    const response = await apiClient.get(`/sessions/${sessionId}`);
    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: any) {
    console.error("Failed to get session details:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch session details."
    );
  }
}

export async function markSessionPaid(
  sessionId: string,
  paymentMethod: "paid_counter" | "paid_online"
) {
  try {
    const response = await apiClient.put(
      `/sessions/${sessionId}/mark-paid`,
      { paymentMethod }
    );

    revalidatePath("/admin/bills");
    revalidatePath("/admin/sales");

    return {
      success: true,
      session: response.data.session,
      invoice: response.data.invoice,
      message: response.data.message,
    };
  } catch (error: any) {
    console.error("Failed to mark session paid:", error);
    throw new Error(
      error.response?.data?.message || "Failed to process payment."
    );
  }
}
