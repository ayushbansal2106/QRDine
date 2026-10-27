"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { IncidentRecord } from "@/types";
import { revalidatePath } from "next/cache";

export async function getIncidents(params?: {
  status?: string;
  severity?: string;
  category?: string;
  limit?: number;
}) {
  try {
    const response = await apiClient.get("/incidents", { params });
    return {
      success: true as const,
      incidents: response.data.incidents as IncidentRecord[],
      count: response.data.count as number,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch incidents:", error);
    return {
      success: false as const,
      incidents: [] as IncidentRecord[],
      count: 0,
      message: apiErrorMessage(error, "Failed to fetch incidents"),
    };
  }
}

export async function reportIncident(data: {
  title: string;
  description: string;
  severity?: "SEV-1" | "SEV-2" | "SEV-3";
  category?: "billing" | "data_isolation" | "realtime_outage" | "security_breach" | "operational";
  affectedOrderId?: string;
  isPersonalDataInvolved?: boolean;
  logs?: Record<string, unknown>;
}) {
  try {
    const response = await apiClient.post("/incidents", data);
    revalidatePath("/cafe/audit");
    return {
      success: true as const,
      incident: response.data.incident as IncidentRecord,
      message: response.data.message as string,
    };
  } catch (error: unknown) {
    console.error("Failed to report incident:", error);
    throw new Error(apiErrorMessage(error, "Failed to submit incident report"));
  }
}

export async function updateIncident(
  incidentId: string,
  data: {
    status?: "open" | "investigating" | "mitigated" | "resolved" | "closed";
    remediationNotes?: string;
    certInReported?: boolean;
  }
) {
  try {
    const response = await apiClient.patch(`/incidents/${incidentId}`, data);
    revalidatePath("/cafe/audit");
    return {
      success: true as const,
      incident: response.data.incident as IncidentRecord,
      message: response.data.message as string,
    };
  } catch (error: unknown) {
    console.error("Failed to update incident:", error);
    throw new Error(apiErrorMessage(error, "Failed to update incident record"));
  }
}

export async function triggerIncidentContainment(
  incidentId: string,
  options?: { quarantineTenant?: boolean; reason?: string }
) {
  try {
    const response = await apiClient.post(`/incidents/${incidentId}/containment`, options || {});
    revalidatePath("/cafe/audit");
    return {
      success: true as const,
      result: response.data.result,
      message: response.data.message as string,
    };
  } catch (error: unknown) {
    console.error("Failed to execute emergency containment:", error);
    throw new Error(apiErrorMessage(error, "Failed to execute emergency containment"));
  }
}

export async function getCertInDossier(incidentId: string) {
  try {
    const response = await apiClient.get(`/incidents/${incidentId}/certin-dossier`);
    return {
      success: true as const,
      dossier: response.data.dossier,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch CERT-In dossier:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch CERT-In dossier"));
  }
}

export async function getForensicAudit(incidentId: string, lookbackHours?: number) {
  try {
    const response = await apiClient.get(`/incidents/${incidentId}/forensic-audit`, {
      params: { lookbackHours },
    });
    return {
      success: true as const,
      audit: response.data.audit,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch forensic audit:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch forensic audit"));
  }
}
