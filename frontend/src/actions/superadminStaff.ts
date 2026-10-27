"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

/**
 * Platform staff management for the control plane.
 *
 * Server Actions rather than client-side `apiClient` calls: the mutating routes
 * are guarded by `validateCsrfToken`, which needs the double-submit cookie the
 * browser cannot send (`apiClient` refuses to set the `Cookie` header outside
 * Node). Reads go through the same path for consistency — see
 * `actions/superadmin.ts` for the full explanation.
 */

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  failedAttempts: number;
  createdAt: string;
}

export interface StaffResult {
  success: boolean;
  message: string;
}

export interface StaffListResult {
  success: boolean;
  staff: StaffMember[];
  roles: string[];
  currentUserId: string;
  message?: string;
}

export async function listStaff(): Promise<StaffListResult> {
  try {
    const response = await apiClient.get("/superadmin/staff");
    return {
      success: true,
      staff: (response.data.staff || []) as StaffMember[],
      roles: (response.data.roles || []) as string[],
      currentUserId: String(response.data.currentUserId || ""),
    };
  } catch (error: unknown) {
    console.error("Failed to load staff:", error);
    return {
      success: false,
      staff: [],
      roles: [],
      currentUserId: "",
      message: apiErrorMessage(error, "Failed to load platform staff."),
    };
  }
}

const toResult = (error: unknown, fallback: string): StaffResult => ({
  success: false,
  message: apiErrorMessage(error, fallback),
});

export async function createStaff(input: {
  email: string;
  name: string;
  role: string;
  password: string;
}): Promise<StaffResult> {
  if (!input.email || !input.role) {
    return { success: false, message: "Email and role are required." };
  }
  if (!input.password || input.password.length < 12) {
    return { success: false, message: "Password must be at least 12 characters." };
  }

  try {
    const response = await apiClient.post("/superadmin/staff", input);
    return { success: true, message: response.data.message || "Staff created." };
  } catch (error: unknown) {
    console.error("Failed to create staff:", error);
    return toResult(error, "Failed to create staff account.");
  }
}

export async function updateStaff(
  staffId: string,
  changes: { name?: string; role?: string; isActive?: boolean }
): Promise<StaffResult> {
  if (!staffId) return { success: false, message: "Missing staff id." };

  try {
    const response = await apiClient.patch(`/superadmin/staff/${staffId}`, changes);
    return { success: true, message: response.data.message || "Staff updated." };
  } catch (error: unknown) {
    console.error("Failed to update staff:", error);
    return toResult(error, "Failed to update staff account.");
  }
}

export async function resetStaffPassword(
  staffId: string,
  password: string
): Promise<StaffResult> {
  if (!staffId) return { success: false, message: "Missing staff id." };
  if (!password || password.length < 12) {
    return { success: false, message: "Password must be at least 12 characters." };
  }

  try {
    const response = await apiClient.post(`/superadmin/staff/${staffId}/password`, {
      password,
    });
    return { success: true, message: response.data.message || "Password reset." };
  } catch (error: unknown) {
    console.error("Failed to reset password:", error);
    return toResult(error, "Failed to reset password.");
  }
}

export async function unlockStaff(staffId: string): Promise<StaffResult> {
  if (!staffId) return { success: false, message: "Missing staff id." };

  try {
    const response = await apiClient.post(`/superadmin/staff/${staffId}/unlock`);
    return { success: true, message: response.data.message || "Unlocked." };
  } catch (error: unknown) {
    console.error("Failed to unlock staff:", error);
    return toResult(error, "Failed to unlock account.");
  }
}
