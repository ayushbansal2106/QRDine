"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

export async function searchBills(params: {
  q?: string;
  method?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  try {
    const response = await apiClient.get("/billing/bills/search", { params });
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to search bills:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to search bills."),
      bills: [],
      summary: { totalRevenue: 0, totalGST: 0, count: 0 },
      totalPages: 0,
    };
  }
}

export async function exportBillsCsv(params: {
  q?: string;
  method?: string;
  from?: string;
  to?: string;
}) {
  try {
    const response = await apiClient.get("/billing/bills/export", {
      params,
      responseType: "text",
    });
    const filename = `bills-${new Date().toISOString().slice(0, 10)}.csv`;
    return { success: true as const, csv: response.data as string, filename };
  } catch (error: unknown) {
    console.error("Failed to export bills:", error);
    throw new Error(apiErrorMessage(error, "Failed to export bills."));
  }
}

export async function getSettlementReport(date?: string) {
  try {
    const response = await apiClient.get("/billing/settlement", { params: date ? { date } : {} });
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to get settlement report:", error);
    return { success: false as const, message: apiErrorMessage(error, "Failed.") };
  }
}

export async function getAuditEvents(params: {
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  try {
    const response = await apiClient.get("/audit", { params });
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to fetch audit ledger:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch audit ledger."),
      entries: [],
      totalCount: 0,
    };
  }
}
