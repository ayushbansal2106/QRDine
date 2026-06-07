"use server";

import { apiClient } from "@/lib/apiClient";
import { revalidatePath } from "next/cache";

export async function createMenuItem(data: {
  categoryId: string;
  name: string;
  description: string;
  imageUrl?: string;
  price: number;
  gstPercentage?: number;
  available: boolean;
  featured: boolean;
  preparationTime: number;
}) {
  try {
    const response = await apiClient.post("/menu", {
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      price: data.price,
      image: data.imageUrl || "",
      isAvailable: data.available,
      gstPercentage: data.gstPercentage || 0,
    });
    const item = response.data.menuItem;
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, item };
  } catch (error: any) {
    console.error("Failed to create menu item:", error);
    throw new Error(error.response?.data?.message || "Failed to create menu item.");
  }
}

export async function updateMenuItem(
  id: string,
  data: {
    categoryId?: string;
    name?: string;
    description?: string;
    imageUrl?: string;
    price?: number;
    gstPercentage?: number;
    available?: boolean;
    featured?: boolean;
    preparationTime?: number;
  }
) {
  try {
    const response = await apiClient.put(`/menu/${id}`, {
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      price: data.price,
      image: data.imageUrl,
      isAvailable: data.available,
      gstPercentage: data.gstPercentage,
    });
    const item = response.data.menuItem;
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, item };
  } catch (error: any) {
    console.error("Failed to update menu item:", error);
    throw new Error(error.response?.data?.message || "Failed to update menu item.");
  }
}

export async function deleteMenuItem(id: string) {
  try {
    await apiClient.delete(`/menu/${id}`);
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete menu item:", error);
    throw new Error(error.response?.data?.message || "Failed to delete menu item.");
  }
}

export async function createCategory(name: string, displayOrder: number = 0) {
  try {
    const response = await apiClient.post("/categories", {
      name,
      displayOrder,
    });
    const category = response.data.category;
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, category };
  } catch (error: any) {
    console.error("Failed to create category:", error);
    throw new Error(error.response?.data?.message || "Failed to create category.");
  }
}

export async function updateCategory(
  id: string,
  name: string,
  displayOrder: number = 0
) {
  try {
    const response = await apiClient.put(`/categories/${id}`, {
      name,
      displayOrder,
    });
    const category = response.data.category;
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, category };
  } catch (error: any) {
    console.error("Failed to update category:", error);
    throw new Error(error.response?.data?.message || "Failed to update category.");
  }
}

export async function deleteCategory(id: string) {
  try {
    await apiClient.delete(`/categories/${id}`);
    revalidatePath("/admin/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete category:", error);
    throw new Error(error.response?.data?.message || "Failed to delete category.");
  }
}


