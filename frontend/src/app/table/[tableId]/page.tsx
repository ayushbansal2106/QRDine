import { apiClient } from "@/lib/apiClient";
import { TableMenuClient } from "@/components/menu/TableMenuClient";
import { notFound } from "next/navigation";
import { MenuItem, MenuCategory, Table } from "@/types";

interface PageProps {
  params: Promise<{ tableId: string }>;
}

export default async function TablePage({ params }: PageProps) {
  const { tableId } = await params;

  let dbTable: any = null;
  let dbCategories: any[] = [];
  let dbItems: any[] = [];

  try {
    // Fetch the specific table publicly
    const tableResponse = await apiClient.get(`/tables/public/${tableId}`);
    dbTable = tableResponse.data.table;

    if (!dbTable) {
      notFound();
    }

    // Fetch categories and menu items publicly scoped to the cafeId
    const [categoriesResponse, menuResponse] = await Promise.all([
      apiClient.get("/categories/public", { params: { cafeId: dbTable.cafeId, limit: 100 } }),
      apiClient.get("/menu/public", { params: { cafeId: dbTable.cafeId, limit: 100 } }),
    ]);

    dbCategories = categoriesResponse.data.categories || [];
    dbItems = menuResponse.data.menuItems || [];
  } catch (error) {
    console.error("Error fetching menu page data:", error);
    notFound();
  }

  // Transform backend MongoDB models into unified frontend types
  const table: Table = {
    id: dbTable._id,
    tableNumber: parseInt(dbTable.tableNumber, 10) || 0,
    qrCodeUrl: dbTable.qrCodeUrl || `/table/${dbTable.tableNumber}`,
    status: dbTable.isActive ? "FREE" : "OCCUPIED" as any,
    createdAt: new Date(dbTable.createdAt),
  };

  const categories: MenuCategory[] = dbCategories.map((c: any) => ({
    id: c._id,
    name: c.name,
    displayOrder: c.displayOrder || 0,
  }));

  const items: MenuItem[] = dbItems
    .filter((item: any) => item.isAvailable)
    .map((item: any) => {
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

  return <TableMenuClient table={table} categories={categories} items={items} cafeId={dbTable.cafeId} />;
}

