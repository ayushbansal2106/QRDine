"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { TableStatus } from "@/types";
import { revalidatePath } from "next/cache";

export async function createTable(tableNumber: number) {
  try {
    const response = await apiClient.post("/tables", {
      tableNumber: String(tableNumber),
      isActive: true,
    });
    const table = response.data.table;
    revalidatePath("/cafe/tables");
    revalidatePath("/cafe/qr");
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
  } catch (error: unknown) {
    console.error("Failed to create table:", error);
    throw new Error(apiErrorMessage(error, "Failed to create table."));
  }
}

export async function deleteTable(id: string) {
  try {
    await apiClient.delete(`/tables/${id}`);
    revalidatePath("/cafe/tables");
    revalidatePath("/cafe/qr");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to delete table:", error);
    throw new Error(apiErrorMessage(error, "Failed to delete table."));
  }
}

export async function updateTableStatus(id: string, status: TableStatus) {
  try {
    const response = await apiClient.put(`/tables/${id}`, {
      isActive: status !== "FREE",
    });
    const table = response.data.table;
    revalidatePath("/cafe/tables");
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
  } catch (error: unknown) {
    console.error("Failed to update table status:", error);
    throw new Error(apiErrorMessage(error, "Failed to update table status."));
  }
}

export async function toggleTableActive(id: string, isActive: boolean) {
  try {
    const response = await apiClient.put(`/tables/${id}`, {
      isActive,
    });
    revalidatePath("/cafe/tables");
    revalidatePath("/cafe/qr");
    return { success: true, table: response.data.table };
  } catch (error: unknown) {
    console.error("Failed to toggle table state:", error);
    throw new Error(apiErrorMessage(error, "Failed to toggle table state."));
  }
}

export async function getTableQrAction(id: string) {
  try {
    const response = await apiClient.get(`/tables/${id}/qr`);
    return { success: true, qrDataUrl: response.data.qrDataUrl };
  } catch (error: unknown) {
    console.error("Failed to fetch table QR code:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch table QR code."));
  }
}

/**
 * Public, unauthenticated lookup of a single table.
 *
 * The guest cart persists `tableId` but the table *number* only ever arrives
 * from the menu screen. A guest who opens the checkout directly (deep link,
 * refresh, or a cart saved before the number was persisted) would otherwise
 * see a placeholder, so checkout resolves it from the same public endpoint the
 * menu uses.
 */
export async function getPublicTableAction(id: string) {
  try {
    const response = await apiClient.get(`/tables/public/${id}`);
    const table = response.data.table;
    if (!table) return { success: false as const, tableNumber: null as number | null };

    const tableNumber = parseInt(String(table.tableNumber), 10);
    return {
      success: true as const,
      // A table with no parseable number is reported as unknown rather than 0,
      // so callers never render a misleading "T-0".
      tableNumber: Number.isFinite(tableNumber) ? tableNumber : null,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch public table:", error);
    return { success: false as const, tableNumber: null as number | null };
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
  } catch (error: unknown) {
    console.error("Failed to fetch tables page:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch tables."));
  }
}




