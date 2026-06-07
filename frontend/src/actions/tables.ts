"use server";

import { apiClient } from "@/lib/apiClient";
import { TableStatus } from "@/types";
import { revalidatePath } from "next/cache";

export async function createTable(tableNumber: number) {
  try {
    const response = await apiClient.post("/tables", {
      tableNumber: String(tableNumber),
      isActive: true,
    });
    const table = response.data.table;
    revalidatePath("/admin/tables");
    revalidatePath("/admin/qr");
    return {
      success: true,
      table: {
        id: table._id,
        tableNumber: parseInt(table.tableNumber, 10),
        status: "FREE" as TableStatus,
        qrCodeUrl: table.qrCodeUrl || `/table/${table.tableNumber}`,
        createdAt: new Date(table.createdAt),
      },
    };
  } catch (error: any) {
    console.error("Failed to create table:", error);
    throw new Error(error.response?.data?.message || "Failed to create table.");
  }
}

export async function deleteTable(id: string) {
  try {
    await apiClient.delete(`/tables/${id}`);
    revalidatePath("/admin/tables");
    revalidatePath("/admin/qr");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete table:", error);
    throw new Error(error.response?.data?.message || "Failed to delete table.");
  }
}

export async function updateTableStatus(id: string, status: TableStatus) {
  try {
    const response = await apiClient.put(`/tables/${id}`, {
      isActive: status !== "FREE",
    });
    const table = response.data.table;
    revalidatePath("/admin/tables");
    return {
      success: true,
      table: {
        id: table._id,
        tableNumber: parseInt(table.tableNumber, 10),
        status,
        qrCodeUrl: table.qrCodeUrl || `/table/${table.tableNumber}`,
        createdAt: new Date(table.createdAt),
      },
    };
  } catch (error: any) {
    console.error("Failed to update table status:", error);
    throw new Error(error.response?.data?.message || "Failed to update table status.");
  }
}

export async function toggleTableActive(id: string, isActive: boolean) {
  try {
    const response = await apiClient.put(`/tables/${id}`, {
      isActive,
    });
    revalidatePath("/admin/tables");
    revalidatePath("/admin/qr");
    return { success: true, table: response.data.table };
  } catch (error: any) {
    console.error("Failed to toggle table state:", error);
    throw new Error(error.response?.data?.message || "Failed to toggle table state.");
  }
}

export async function getTableQrAction(id: string) {
  try {
    const response = await apiClient.get(`/tables/${id}/qr`);
    return { success: true, qrDataUrl: response.data.qrDataUrl };
  } catch (error: any) {
    console.error("Failed to fetch table QR code:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch table QR code.");
  }
}

export async function getTablesAction(page: number = 1, limit: number = 12) {
  try {
    const response = await apiClient.get("/tables", {
      params: { page, limit },
    });
    return {
      success: true,
      tables: response.data.tables || [],
      totalPages: response.data.totalPages || 1,
      totalCount: response.data.totalCount || 0,
    };
  } catch (error: any) {
    console.error("Failed to fetch tables page:", error);
    throw new Error(error.response?.data?.message || "Failed to fetch tables.");
  }
}




