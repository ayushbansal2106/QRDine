"use server";

import { apiClient } from "@/lib/apiClient";

export async function getAnalyticsOverview() {
  try {
    const response = await apiClient.get("/analytics/overview");
    return response.data;
  } catch (error: any) {
    console.error("Failed to get analytics overview:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch analytics overview.");
  }
}

export async function getRevenueAnalytics(period: string = "week") {
  try {
    const response = await apiClient.get("/analytics/revenue", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get revenue analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch revenue analytics.");
  }
}

export async function getGSTAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/gst", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get GST analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch GST analytics.");
  }
}

export async function getItemsAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/items", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get items analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch items analytics.");
  }
}

export async function getTableAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/tables", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get table analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch table analytics.");
  }
}

export async function getSessionAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/sessions", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get session analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch session analytics.");
  }
}

export async function getCustomerAnalytics(period: string = "month") {
  try {
    const response = await apiClient.get("/analytics/customers", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get customer analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch customer analytics.");
  }
}

export async function getPaymentAnalytics(period: string = "today") {
  try {
    const response = await apiClient.get("/analytics/payments", { params: { period } });
    return response.data;
  } catch (error: any) {
    console.error("Failed to get payment analytics:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch payment analytics.");
  }
}
