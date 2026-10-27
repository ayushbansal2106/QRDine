"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { Shift } from "@/types";
import { revalidatePath } from "next/cache";

// Module #08 — Shift & cash-drawer server actions

export async function getCurrentShift() {
  try {
    const response = await apiClient.get("/shifts/current");
    return { success: true as const, shift: (response.data.shift as Shift) || null };
  } catch (error: unknown) {
    console.error("Failed to get current shift:", error);
    return {
      success: false as const,
      shift: null,
      message: apiErrorMessage(error, "Failed to load current shift."),
    };
  }
}

export async function openShift(openingFloat: number, notes = "") {
  try {
    const response = await apiClient.post("/shifts/open", { openingFloat, notes });
    revalidatePath("/cafe/shift");
    return { success: true as const, shift: response.data.shift as Shift, message: response.data.message };
  } catch (error: unknown) {
    console.error("Failed to open shift:", error);
    throw new Error(apiErrorMessage(error, "Failed to open shift."));
  }
}

export async function closeShift(shiftId: string, closingFloat: number, notes = "") {
  try {
    const response = await apiClient.post(`/shifts/${shiftId}/close`, { closingFloat, notes });
    revalidatePath("/cafe/shift");
    return { success: true as const, shift: response.data.shift as Shift, message: response.data.message };
  } catch (error: unknown) {
    console.error("Failed to close shift:", error);
    throw new Error(apiErrorMessage(error, "Failed to close shift."));
  }
}

export async function getShiftHistory(page = 1, limit = 20) {
  try {
    const response = await apiClient.get("/shifts", { params: { page, limit } });
    return {
      success: true as const,
      shifts: response.data.shifts as Shift[],
      totalCount: response.data.totalCount as number,
      totalPages: response.data.totalPages as number,
    };
  } catch (error: unknown) {
    console.error("Failed to load shift history:", error);
    return {
      success: false as const,
      shifts: [] as Shift[],
      totalCount: 0,
      totalPages: 0,
      message: apiErrorMessage(error, "Failed to load shift history."),
    };
  }
}
