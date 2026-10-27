"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";
import type { GeofenceConfig, GeofenceStats, GeofenceFlag } from "@/types";

/** Module #10 — geo-location fake-order prevention (manager surface). */

export async function getGeofenceConfig(): Promise<{
  success: boolean;
  config?: GeofenceConfig;
  stats?: GeofenceStats;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/geofence/config");
    return { success: true, config: response.data.config, stats: response.data.stats };
  } catch (error: unknown) {
    console.error("Failed to fetch geofence config:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load geofence settings."),
    };
  }
}

export async function updateGeofenceConfig(payload: {
  enabled: boolean;
  lat: number | null;
  lng: number | null;
  radiusMeters: number;
  fallback: "flag" | "reject";
}) {
  try {
    const response = await apiClient.put("/geofence/config", payload);
    revalidatePath("/cafe/geofence");
    return { success: true, config: response.data.config as GeofenceConfig };
  } catch (error: unknown) {
    console.error("Failed to update geofence config:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to save geofence settings."),
    };
  }
}

export async function getGeofenceFlags(params?: {
  page?: number;
  limit?: number;
  outcome?: "pending" | "resolved";
}): Promise<{
  success: boolean;
  flags?: GeofenceFlag[];
  totalCount?: number;
  totalPages?: number;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/geofence/flags", { params });
    return {
      success: true,
      flags: response.data.flags,
      totalCount: response.data.totalCount,
      totalPages: response.data.totalPages,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch flagged orders:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load flagged orders."),
      flags: [],
      totalCount: 0,
      totalPages: 0,
    };
  }
}

export async function resolveGeofenceFlag(
  orderId: string,
  outcome: "confirmed_legit" | "confirmed_fraud",
  note = ""
) {
  try {
    await apiClient.post(`/geofence/flags/${orderId}/resolve`, { outcome, note });
    revalidatePath("/cafe/geofence");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to resolve geofence flag:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to resolve this flag."),
    };
  }
}