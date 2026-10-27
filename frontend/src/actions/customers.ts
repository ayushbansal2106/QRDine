"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";

export async function fetchCustomers(params: {
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
}) {
  try {
    const response = await apiClient.get("/customers", { params });
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to fetch customers:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch customers."),
      customers: [],
      totalCount: 0,
      totalPages: 0,
    };
  }
}

export async function fetchCustomer(id: string) {
  try {
    const response = await apiClient.get(`/customers/${id}`);
    return { success: true as const, customer: response.data.customer, orders: response.data.orders };
  } catch (error: unknown) {
    console.error("Failed to fetch customer:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to fetch customer."),
    };
  }
}

export async function updateCustomerProfile(
  id: string,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    notes?: string;
    dietary?: string[];
    tags?: string[];
    birthday?: string | null;
  }
) {
  try {
    const response = await apiClient.patch(`/customers/${id}`, data);
    revalidatePath("/cafe/customers");
    return { success: true as const, customer: response.data.customer };
  } catch (error: unknown) {
    console.error("Failed to update customer:", error);
    throw new Error(apiErrorMessage(error, "Failed to update customer."));
  }
}

export async function exportCustomersCsv() {
  try {
    const response = await apiClient.get("/customers/export", { responseType: "text" });
    const filename = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    return { success: true as const, csv: response.data as string, filename };
  } catch (error: unknown) {
    console.error("Failed to export customers:", error);
    throw new Error(apiErrorMessage(error, "Failed to export customers."));
  }
}
