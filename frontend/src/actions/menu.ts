"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import type { RawMenuItem } from "@/lib/mappers";
import { revalidatePath } from "next/cache";

export interface MenuVariantInput {
  name: string;
  price: number;
  isDefault?: boolean;
}

export interface MenuModifierGroupInput {
  name: string;
  selectionType: "single" | "multi";
  isRequired?: boolean;
  min?: number;
  max?: number;
  options: { name: string; price: number; isDefault?: boolean }[];
}

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
  variants?: MenuVariantInput[];
  modifierGroups?: MenuModifierGroupInput[];
  dietaryTags?: string[];
  ingredients?: string[];
  allergens?: string[];
  calories?: number;
  prepStation?: "kitchen" | "bar" | "both";
  story?: string;
  media?: { url: string; caption?: string }[];
  allergenNote?: string;
  spiceLevel?: number;
  prepMinutes?: number;
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
      variants: data.variants,
      modifierGroups: data.modifierGroups,
      dietaryTags: data.dietaryTags,
      ingredients: data.ingredients,
      allergens: data.allergens,
      calories: data.calories,
      prepStation: data.prepStation,
      story: data.story,
      media: data.media,
      allergenNote: data.allergenNote,
      spiceLevel: data.spiceLevel,
      prepMinutes: data.prepMinutes,
    });
    const item = response.data.menuItem;
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, item };
  } catch (error: unknown) {
    console.error("Failed to create menu item:", error);
    throw new Error(apiErrorMessage(error, "Failed to create menu item."));
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
    variants?: MenuVariantInput[];
    modifierGroups?: MenuModifierGroupInput[];
    dietaryTags?: string[];
    ingredients?: string[];
    allergens?: string[];
    calories?: number;
    prepStation?: "kitchen" | "bar" | "both";
    story?: string;
    media?: { url: string; caption?: string }[];
    allergenNote?: string;
    spiceLevel?: number;
    prepMinutes?: number;
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
      variants: data.variants,
      modifierGroups: data.modifierGroups,
      dietaryTags: data.dietaryTags,
      ingredients: data.ingredients,
      allergens: data.allergens,
      calories: data.calories,
      prepStation: data.prepStation,
      story: data.story,
      media: data.media,
      allergenNote: data.allergenNote,
      spiceLevel: data.spiceLevel,
      prepMinutes: data.prepMinutes,
    });
    const item = response.data.menuItem;
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, item };
  } catch (error: unknown) {
    console.error("Failed to update menu item:", error);
    throw new Error(apiErrorMessage(error, "Failed to update menu item."));
  }
}

export async function deleteMenuItem(id: string) {
  try {
    await apiClient.delete(`/menu/${id}`);
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to delete menu item:", error);
    throw new Error(apiErrorMessage(error, "Failed to delete menu item."));
  }
}

export async function toggleMenuItemAvailability(id: string, available: boolean) {
  try {
    const response = await apiClient.patch(`/menu/${id}/availability`, {
      isAvailable: available,
    });
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, item: response.data.menuItem };
  } catch (error: unknown) {
    console.error("Failed to toggle menu availability:", error);
    throw new Error(apiErrorMessage(error, "Failed to update availability."));
  }
}

export async function searchMenu(cafeId: string, query: string) {
  try {
    const response = await apiClient.get("/menu/public/search", {
      params: { cafeId, q: query },
    });
    return { success: true, menuItems: response.data.menuItems };
  } catch (error: unknown) {
    console.error("Failed to search menu:", error);
    return { success: false, menuItems: [] };
  }
}

export async function createCategory(name: string, displayOrder: number = 0) {
  try {
    const response = await apiClient.post("/categories", {
      name,
      displayOrder,
    });
    const category = response.data.category;
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, category };
  } catch (error: unknown) {
    console.error("Failed to create category:", error);
    throw new Error(apiErrorMessage(error, "Failed to create category."));
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
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true, category };
  } catch (error: unknown) {
    console.error("Failed to update category:", error);
    throw new Error(apiErrorMessage(error, "Failed to update category."));
  }
}

export async function deleteCategory(id: string) {
  try {
    await apiClient.delete(`/categories/${id}`);
    revalidatePath("/cafe/menu");
    revalidatePath("/table/[tableId]", "layout");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to delete category:", error);
    throw new Error(apiErrorMessage(error, "Failed to delete category."));
  }
}



/**
 * Admin menu list, used by the omnichannel add-to-tab dialog (#03).
 * Returns raw backend items; callers map what they need.
 *
 * Typed as `RawMenuItem` rather than `any[]`, which is what forced the dialog to
 * re-guess that items carry `_id`, `name`, `price` and `isAvailable`.
 */
export async function fetchMenuItems(params?: {
  categoryId?: string;
  limit?: number;
}): Promise<{ success: boolean; items: RawMenuItem[] }> {
  try {
    const response = await apiClient.get<{ menuItems?: RawMenuItem[] }>("/menu", { params });
    return { success: true, items: response.data.menuItems || [] };
  } catch (error: unknown) {
    console.error("Failed to fetch menu items:", error);
    return { success: false, items: [] };
  }
}
