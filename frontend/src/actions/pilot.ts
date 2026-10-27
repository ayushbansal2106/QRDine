"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

export interface DailyShiftLog {
  _id: string;
  dayNumber: number;
  date: string;
  phase: "phase_1_shadow" | "phase_2_limited_qr" | "phase_3_full_venue";
  totalOrders: number;
  totalSales: number;
  cashCollected: number;
  digitalCollected: number;
  discrepancyAmount: number;
  droppedOrdersCount: number;
  kitchenLatencyAvgMinutes: number;
  staffFeedbackNotes: string;
  passedDailyAudit: boolean;
}

export interface PilotRunData {
  _id: string;
  cafeId: string;
  status: "active" | "paused" | "completed" | "aborted";
  currentPhase: "phase_1_shadow" | "phase_2_limited_qr" | "phase_3_full_venue" | "completed";
  currentDay: number;
  startDate: string;
  completedAt?: string;
  activeTables: string[];
  dailyLogs: DailyShiftLog[];
  metrics: {
    totalOrdersHandled: number;
    totalSalesRupees: number;
    cumulativeDiscrepancy: number;
    totalDroppedOrders: number;
    averageRating: number;
  };
  exitCriteria: {
    zeroBillingDiscrepancies: boolean;
    zeroCrossTenantLeaks: boolean;
    zeroDroppedOrders: boolean;
    ownerSignoff: boolean;
    ownerSignoffName: string;
    ownerSignoffDate?: string;
    gaCertificateNumber: string;
  };
}

export interface PilotAuditData {
  cafeId: string;
  cafeName: string;
  currentPhase: string;
  daysLogged: number;
  totalOrders: number;
  totalSales: number;
  cumulativeDiscrepancy: number;
  totalDroppedOrders: number;
  criteria: {
    zeroBillingDiscrepancies: boolean;
    zeroCrossTenantLeaks: boolean;
    zeroDroppedOrders: boolean;
    minimumShiftsCompleted: boolean;
  };
  isEligibleForGaSignoff: boolean;
}

export async function getPilotStatus() {
  try {
    const { data } = await apiClient.get("/pilot/status");
    return {
      success: true,
      pilot: data.pilot as PilotRunData,
      audit: data.audit as PilotAuditData,
    };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to load pilot status.") };
  }
}

export async function startPilot() {
  try {
    const { data } = await apiClient.post("/pilot/start", {});
    return { success: true, message: data.message, pilot: data.pilot as PilotRunData };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to initialize pilot.") };
  }
}

export async function logPilotShift(shiftData: {
  totalOrders: number;
  totalSales: number;
  cashCollected: number;
  digitalCollected: number;
  discrepancyAmount: number;
  droppedOrdersCount: number;
  kitchenLatencyAvgMinutes?: number;
  staffFeedbackNotes?: string;
}) {
  try {
    const { data } = await apiClient.post("/pilot/log-shift", shiftData);
    return { success: true, message: data.message, pilot: data.pilot as PilotRunData };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to record daily shift log.") };
  }
}

export async function advancePilotPhase() {
  try {
    const { data } = await apiClient.post("/pilot/advance-phase", {});
    return { success: true, message: data.message, pilot: data.pilot as PilotRunData };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to advance pilot phase.") };
  }
}

export async function issueGaSignoffCertificate(ownerSignoffName: string) {
  try {
    const { data } = await apiClient.post("/pilot/signoff", { ownerSignoffName });
    return {
      success: true,
      message: data.message,
      certificate: data.certificate,
    };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to issue GA sign-off certificate.") };
  }
}
