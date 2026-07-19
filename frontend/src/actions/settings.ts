"use server";

import { apiClient } from "@/lib/apiClient";
import { CafeProfile, StaffUser } from "@/types";
import { revalidatePath } from "next/cache";

// ─── Cafe Profile ────────────────────────────────────────

export async function getCafeProfile() {
  try {
    const response = await apiClient.get("/cafe");
    return {
      success: true,
      cafe: response.data.cafe as CafeProfile,
    };
  } catch (error: any) {
    console.error("Failed to get cafe profile:", error);
    throw new Error(error.response?.data?.message || "Failed to load cafe profile.");
  }
}

export async function updateCafeProfile(data: {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: string;
}) {
  try {
    const response = await apiClient.put("/cafe", data);
    revalidatePath("/admin/settings");
    return {
      success: true,
      cafe: response.data.cafe as CafeProfile,
      message: response.data.message,
    };
  } catch (error: any) {
    console.error("Failed to update cafe profile:", error);
    throw new Error(error.response?.data?.message || "Failed to update cafe profile.");
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
  } catch (error: any) {
    console.error("Failed to get staff users:", error);
    throw new Error(error.response?.data?.message || "Failed to load staff users.");
  }
}

export async function createStaffUser(data: {
  name: string;
  email: string;
  password: string;
  role: "manager" | "staff";
}) {
  try {
    const response = await apiClient.post("/users", data);
    revalidatePath("/admin/settings");
    return {
      success: true,
      user: response.data.user as StaffUser,
      message: response.data.message,
    };
  } catch (error: any) {
    console.error("Failed to create staff user:", error);
    throw new Error(error.response?.data?.message || "Failed to create staff user.");
  }
}

export async function deleteStaffUser(id: string) {
  try {
    await apiClient.delete(`/users/${id}`);
    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete staff user:", error);
    throw new Error(error.response?.data?.message || "Failed to delete staff user.");
  }
}
