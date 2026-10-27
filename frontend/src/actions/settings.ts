"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { CafeProfile, PermissionCatalog, StaffUser } from "@/types";
import { revalidatePath } from "next/cache";

// ─── Cafe Profile ────────────────────────────────────────

export async function getCafeProfile() {
  try {
    const response = await apiClient.get("/cafe");
    return {
      success: true,
      cafe: response.data.cafe as CafeProfile,
    };
  } catch (error: unknown) {
    console.error("Failed to get cafe profile:", error);
    throw new Error(apiErrorMessage(error, "Failed to load cafe profile."));
  }
}

export async function updateCafeProfile(data: {
  name?: string;
  legalName?: string;
  tradeName?: string;
  gstin?: string;
  fssaiNumber?: string;
  taxMode?: "composite_5" | "regular_18" | "exempt";
  address?: string;
  phone?: string;
  email?: string;
  logo?: string;
  isOrderingPaused?: boolean;
  orderingPausedReason?: string;
  operatingHours?: {
    enabled?: boolean;
    openTime?: string;
    closeTime?: string;
    days?: number[];
  };
}) {
  try {
    const response = await apiClient.put("/cafe", data);
    revalidatePath("/cafe/settings");
    return {
      success: true,
      cafe: response.data.cafe as CafeProfile,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to update cafe profile:", error);
    throw new Error(apiErrorMessage(error, "Failed to update cafe profile."));
  }
}

// ─── Staff Management ────────────────────────────────────

export async function getStaffUsers() {
  try {
    const response = await apiClient.get("/users");
    return {
      success: true,
      users: response.data.users as StaffUser[],
    };
  } catch (error: unknown) {
    console.error("Failed to get staff users:", error);
    throw new Error(apiErrorMessage(error, "Failed to load staff users."));
  }
}

export async function createStaffUser(data: {
  name: string;
  email: string;
  password: string;
  role: string;
  permissions?: string[];
}) {
  try {
    const response = await apiClient.post("/users", data);
    revalidatePath("/cafe/settings");
    return {
      success: true,
      user: response.data.user as StaffUser,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to create staff user:", error);
    throw new Error(apiErrorMessage(error, "Failed to create staff user."));
  }
}

export async function deleteStaffUser(id: string) {
  try {
    await apiClient.delete(`/users/${id}`);
    revalidatePath("/cafe/settings");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to delete staff user:", error);
    throw new Error(apiErrorMessage(error, "Failed to delete staff user."));
  }
}

// ─── Module #08 — Roles, Permissions & PIN ───────────────

export async function getPermissionCatalog() {
  try {
    const response = await apiClient.get("/users/permissions");
    return {
      success: true as const,
      catalog: response.data as PermissionCatalog,
    };
  } catch (error: unknown) {
    console.error("Failed to get permission catalog:", error);
    throw new Error(apiErrorMessage(error, "Failed to load permissions."));
  }
}

export async function updateStaffUser(
  id: string,
  data: {
    name?: string;
    role?: string;
    permissions?: string[];
    isActive?: boolean;
  }
) {
  try {
    const response = await apiClient.patch(`/users/${id}`, data);
    revalidatePath("/cafe/settings");
    return {
      success: true as const,
      user: response.data.user as StaffUser,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to update staff user:", error);
    throw new Error(apiErrorMessage(error, "Failed to update staff user."));
  }
}

export async function setStaffPin(id: string, pin: string) {
  try {
    const response = await apiClient.post(`/users/${id}/pin`, { pin });
    revalidatePath("/cafe/settings");
    return {
      success: true as const,
      user: response.data.user as StaffUser,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to set PIN:", error);
    throw new Error(apiErrorMessage(error, "Failed to set PIN."));
  }
}

export async function removeStaffPin(id: string) {
  try {
    const response = await apiClient.delete(`/users/${id}/pin`);
    revalidatePath("/cafe/settings");
    return {
      success: true as const,
      user: response.data.user as StaffUser,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to remove PIN:", error);
    throw new Error(apiErrorMessage(error, "Failed to remove PIN."));
  }
}

// ─── Payment Gateway (BYO-PG) ────────────────────────────

export interface PGSettings {
  enabled: boolean;
  provider: "razorpay" | "cashfree" | "paytm" | "stripe";
  keyId?: string;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  webhookUrl?: string;
}

export async function getPGSettings() {
  try {
    const response = await apiClient.get("/billing/pg/settings");
    return {
      success: true as const,
      settings: response.data.settings as PGSettings,
    };
  } catch (error: unknown) {
    console.error("Failed to get PG settings:", error);
    throw new Error(apiErrorMessage(error, "Failed to load payment gateway settings."));
  }
}

export async function updatePGSettings(data: {
  enabled: boolean;
  provider: string;
  keyId: string;
  keySecret?: string;
  webhookSecret?: string;
}) {
  try {
    const response = await apiClient.put("/billing/pg/settings", data);
    revalidatePath("/cafe/settings");
    return {
      success: true as const,
      settings: response.data.settings as PGSettings,
      message: response.data.message as string,
    };
  } catch (error: unknown) {
    console.error("Failed to update PG settings:", error);
    throw new Error(apiErrorMessage(error, "Failed to update payment gateway settings."));
  }
}

