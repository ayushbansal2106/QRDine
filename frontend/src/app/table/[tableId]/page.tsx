import { apiClient } from "@/lib/apiClient";
import { TableMenuClient } from "@/components/menu/TableMenuClient";
import { CustomerCafe } from "@/components/customer/CustomerHeader";
import { notFound } from "next/navigation";
import { MenuItem, MenuCategory, Table, PrepStation } from "@/types";

interface PageProps {
  params: Promise<{ tableId: string }>;
}

/** Shapes of the public (unauthenticated) API responses used below. */
interface PublicTable {
  _id: string;
  cafeId: string;
  tableNumber: string | number;
  qrCodeUrl?: string;
  isActive?: boolean;
  createdAt?: string;
}

interface PublicCategory {
  _id: string;
  name: string;
  displayOrder?: number;
}

interface PublicMenuItem {
  _id: string;
  categoryId: string;
  name: string;
  description?: string;
  image?: string | null;
  price?: number | string;
  gstPercentage?: number;
  isAvailable?: boolean;
  prepMinutes?: number;
  variants?: MenuItem["variants"];
  modifierGroups?: MenuItem["modifierGroups"];
  dietaryTags?: string[];
  ingredients?: string[];
  allergens?: string[];
  calories?: number;
  prepStation?: PrepStation;
  story?: string;
  media?: MenuItem["media"];
  allergenNote?: string;
  spiceLevel?: number;
}

export default async function TablePage({ params }: PageProps) {
  const { tableId } = await params;

  let dbTable: PublicTable | null = null;
  let dbCategories: PublicCategory[] = [];
  let dbItems: PublicMenuItem[] = [];
  let dbCafe: CustomerCafe | null = null;

  try {
    // Fetch the specific table publicly
    const tableResponse = await apiClient.get<{ table: PublicTable }>(
      `/tables/public/${tableId}`
    );
    dbTable = tableResponse.data.table;

    if (!dbTable) {
      notFound();
    }

    // Fetch categories and menu items publicly scoped to the cafeId
    const [categoriesResponse, menuResponse] = await Promise.all([
      apiClient.get<{ categories: PublicCategory[] }>("/categories/public", {
        params: { cafeId: dbTable.cafeId, limit: 100 },
      }),
      apiClient.get<{ menuItems: PublicMenuItem[] }>("/menu/public", {
        params: { cafeId: dbTable.cafeId, limit: 100 },
      }),
    ]);

    dbCategories = categoriesResponse.data.categories || [];
    dbItems = menuResponse.data.menuItems || [];

    // Public display fields and live operational status
    try {
      const [cafeRes, statusRes] = await Promise.allSettled([
        apiClient.get<{ cafe: { name: string; logo: string; address: string } }>(
          `/cafe/public/${dbTable.cafeId}`
        ),
        apiClient.get<{
          isOrderingPaused?: boolean;
          orderingPausedReason?: string;
          isOpen?: boolean;
          reason?: string;
          operatingHours?: CustomerCafe["operatingHours"];
        }>(`/cafe/public/${dbTable.cafeId}/operational-status`),
      ]);

      const cafeData = cafeRes.status === "fulfilled" ? cafeRes.value.data.cafe : null;
      const statusData = statusRes.status === "fulfilled" ? statusRes.value.data : null;

      if (cafeData) {
        dbCafe = {
          name: cafeData.name || "",
          logo: cafeData.logo || "",
          address: cafeData.address || "",
          isOrderingPaused: statusData?.isOrderingPaused,
          orderingPausedReason: statusData?.orderingPausedReason,
          operatingHours: statusData?.operatingHours,
        };
      }
    } catch {
      dbCafe = null;
    }
  } catch (error) {
    console.error("Error fetching menu page data:", error);
    notFound();
  }

  // Transform backend MongoDB models into unified frontend types
  const table: Table = {
    id: dbTable!._id,
    tableNumber: parseInt(String(dbTable!.tableNumber), 10) || 0,
    qrCodeUrl: dbTable!.qrCodeUrl || `/table/${dbTable!.tableNumber}`,
    status: dbTable!.isActive ? "FREE" : ("OCCUPIED" as Table["status"]),
    // `createdAt` is required by the shared Table type but unused by the guest
// menu; a table without one falls back to the epoch rather than calling
// Date.now() during render (an impure call the React compiler rejects).
    createdAt: dbTable!.createdAt ? new Date(dbTable!.createdAt) : new Date(0),
  };

  const categories: MenuCategory[] = dbCategories.map((c) => ({
    id: c._id,
    name: c.name,
    displayOrder: c.displayOrder || 0,
  }));

  const items: MenuItem[] = dbItems
    .filter((item) => item.isAvailable)
    .map((item) => {
      const categoryObj = categories.find((c) => c.id === item.categoryId);
      return {
        id: item._id,
        categoryId: item.categoryId,
        category: categoryObj
          ? {
              id: categoryObj.id,
              name: categoryObj.name,
              displayOrder: categoryObj.displayOrder,
            }
          : undefined,
        name: item.name,
        description: item.description || "",
        imageUrl: item.image || null,
        price: Number(item.price),
        gstPercentage: Number(item.gstPercentage || 0),
        available: item.isAvailable ?? true,
        featured: false,
        preparationTime: item.prepMinutes || 10,
        // Module #05/#06 — the guest menu needs the full catalog definition,
        // not just name/price, or the picker and badges render empty.
        variants: item.variants || [],
        modifierGroups: item.modifierGroups || [],
        dietaryTags: item.dietaryTags || [],
        ingredients: item.ingredients || [],
        allergens: item.allergens || [],
        calories: Number(item.calories || 0),
        prepStation: item.prepStation || "kitchen",
        story: item.story || "",
        media: item.media || [],
        allergenNote: item.allergenNote || "",
        spiceLevel: Number(item.spiceLevel || 0),
        prepMinutes: Number(item.prepMinutes || 0),
      };
    });

  return (
    <TableMenuClient
      table={table}
      categories={categories}
      items={items}
      cafeId={dbTable!.cafeId}
      cafe={dbCafe ?? undefined}
    />
  );
}