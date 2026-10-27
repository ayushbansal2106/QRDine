import React from "react";
import { apiClient } from "@/lib/apiClient";
import { MenuCategory, MenuItem } from "@/types";
import { MenuManagementClient } from "./MenuManagementClient";
import { requirePathAccess } from "@/lib/session";
import {
  asRawCategories,
  asRawMenuItems,
  mapRawCategory,
  mapRawMenuItem,
} from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/menu");

  let categories: MenuCategory[] = [];
  let items: MenuItem[] = [];

  try {
    const [categoriesResponse, menuResponse] = await Promise.all([
      apiClient.get("/categories", { params: { limit: 100 } }),
      apiClient.get("/menu", { params: { limit: 100 } }),
    ]);

    categories = asRawCategories(categoriesResponse.data.categories).map(mapRawCategory);
    items = asRawMenuItems(menuResponse.data.menuItems).map((raw) =>
      // The endpoint does not populate `categoryId`, so each item is linked to
      // its already-fetched category here — the only place that join can happen.
      mapRawMenuItem(raw, categories.find((c) => c.id === raw.categoryId))
    );
  } catch (error) {
    console.error("Error fetching admin menu data:", error);
  }

  return (
    <MenuManagementClient initialCategories={categories} initialItems={items} />
  );
}