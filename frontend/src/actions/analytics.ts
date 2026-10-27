"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

export async function getAnalyticsOverview() {
  try {
    const response = await apiClient.get("/analytics/overview");
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get analytics overview:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch analytics overview."));
  }
}

export async function getRevenueAnalytics(period: string = "week") {
  try {
    const response = await apiClient.get("/analytics/revenue", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get revenue analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch revenue analytics."));
  }
}

export async function getGSTAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/gst", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get GST analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch GST analytics."));
  }
}

export async function getItemsAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/items", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get items analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch items analytics."));
  }
}

export async function getTableAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/tables", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get table analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch table analytics."));
  }
}

export async function getSessionAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/sessions", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get session analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch session analytics."));
  }
}

export async function getCustomerAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/customers", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get customer analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch customer analytics."));
  }
}

export async function getLiveTelemetry() {
  try {
    const response = await apiClient.get("/analytics/live");
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to get live telemetry:", error);
    return { success: false as const, message: apiErrorMessage(error, "Failed to fetch telemetry.") };
  }
}

export async function getPaymentAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/payments", { params: { period } });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get payment analytics:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch payment analytics."));
  }
}

// --- Module #01 — peak hours, turnover and outlet consolidation ---------------

export async function getPeakHours(days = 7) {
  try {
    const response = await apiClient.get("/analytics/peak-hours", { params: { days } });
    return { success: true as const, peakHours: response.data.peakHours };
  } catch (error: unknown) {
    console.error("Failed to fetch peak hours:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch peak hours."),
      peakHours: null,
    };
  }
}

export async function getTurnover(days = 1) {
  try {
    const response = await apiClient.get("/analytics/turnover", { params: { days } });
    return { success: true as const, turnover: response.data.turnover };
  } catch (error: unknown) {
    console.error("Failed to fetch turnover:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch turnover."),
      turnover: null,
    };
  }
}

export async function getOutletConsolidation(days = 7) {
  try {
    const response = await apiClient.get("/analytics/outlets", { params: { days } });
    return { success: true as const, outlets: response.data.outlets };
  } catch (error: unknown) {
    console.error("Failed to fetch outlet consolidation:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch outlet data."),
      outlets: null,
    };
  }
}
