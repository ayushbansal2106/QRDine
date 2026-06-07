import React from "react";
import { apiClient } from "@/lib/apiClient";
import { MenuCategory, MenuItem } from "@/types";
import { MenuManagementClient } from "./MenuManagementClient";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  let dbCategories: any[] = [];
  let dbItems: any[] = [];

  try {
    const [categoriesResponse, menuResponse] = await Promise.all([
      apiClient.get("/categories", { params: { limit: 100 } }),
      apiClient.get("/menu", { params: { limit: 100 } }),
    ]);

    dbCategories = categoriesResponse.data.categories || [];
    dbItems = menuResponse.data.menuItems || [];
  } catch (error) {
    console.error("Error fetching admin menu data:", error);
  }

  // Transform database objects to frontend types
  const categories: MenuCategory[] = dbCategories.map((c: any) => ({
    id: c._id,
    name: c.name,
    displayOrder: c.displayOrder || 0,
  }));

  const items: MenuItem[] = dbItems.map((item: any) => {
    const categoryObj = categories.find((c) => c.id === item.categoryId);
    return {
      id: item._id,
      categoryId: item.categoryId,
      category: categoryObj ? {
        id: categoryObj.id,
        name: categoryObj.name,
        displayOrder: categoryObj.displayOrder,
      } : undefined,
      name: item.name,
      description: item.description || "",
      imageUrl: item.image || null,
      price: Number(item.price),
      gstPercentage: Number(item.gstPercentage || 0),
      available: item.isAvailable,
      featured: false,
      preparationTime: 10,
    };
  });

  return (
    <MenuManagementClient initialCategories={categories} initialItems={items} />
  );
}
