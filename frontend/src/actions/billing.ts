"use server";

import { apiClient } from "@/lib/apiClient";

export async function getBills(filters?: { status?: string }) {
  try {
    const response = await apiClient.get("/billing/bills", {
      params: filters,
    });
    return {
      success: true,
      bills: response.data.bills,
    };
  } catch (error: any) {
    console.error("Failed to get bills:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch bills.");
  }
}

export async function getSalesHistory(filters?: {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/billing/sales-history", {
      params: filters,
    });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get sales history:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch sales history."
    );
  }
}

export async function getAnalytics(filters?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/billing/analytics", {
      params: filters,
    });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get analytics:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch analytics."
    );
  }
}

export async function downloadInvoice(invoiceId: string) {
  try {
    const response = await apiClient.get(`/invoices/${invoiceId}/pdf`, {
      responseType: "blob",
    });
    return response.data;
  } catch (error: any) {
    console.error("Failed to download invoice:", error);
    throw new Error(
      error.response?.data?.message || "Failed to download invoice."
    );
  }
}

export async function resendInvoiceEmail(invoiceId: string) {
  try {
    const response = await apiClient.post(
      `/invoices/${invoiceId}/resend-email`
    );
    return {
      success: true,
      message: response.data.message,
      emailSent: response.data.emailSent,
    };
  } catch (error: any) {
    console.error("Failed to resend invoice email:", error);
    throw new Error(
      error.response?.data?.message || "Failed to resend invoice email."
    );
  }
}
