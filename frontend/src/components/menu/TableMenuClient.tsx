"use client";

import React, { useState, useEffect } from "react";
import { MenuItem, MenuCategory, Table } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { SearchBar } from "@/components/navigation/SearchBar";
import { CategoryTabs } from "@/components/navigation/CategoryTabs";
import { FoodCard } from "@/components/menu/FoodCard";
import { SessionGate } from "@/components/menu/SessionGate";
import { StickyActionBar } from "@/components/layout/StickyActionBar";
import { useCartStore } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { EmptyState } from "@/components/common/EmptyState";

interface TableMenuClientProps {
  table: Table;
  categories: MenuCategory[];
  items: MenuItem[];
  cafeId?: string;
}

export const TableMenuClient: React.FC<TableMenuClientProps> = ({
  table,
  categories,
  items,
  cafeId,
}) => {
  const { setTableId } = useCartStore();
  const { savedCustomerName } = useSessionStore();
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setTableId(table.id);
  }, [table.id, setTableId]);

  // Handle unique list of categories including "All"
  const categoryNames = ["All", ...categories.map((c) => c.name)];

  // Filter items based on category and search query
  const filteredItems = items.filter((item) => {
    const categoryName = item.category?.name || "";
    const matchesCategory =
      selectedCategory === "All" || categoryName === selectedCategory;

    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const headerTitle = savedCustomerName
    ? `Table ${table.tableNumber} · ${savedCustomerName}`
    : `Table ${table.tableNumber}`;

  return (
    <SessionGate tableId={table.id} cafeId={cafeId || ""}>
      <div className="min-h-screen flex flex-col pb-32">
        {/* Header */}
        <TopAppBar title={headerTitle} showSearch={false} />

        {/* Main Content */}
        <main className="flex-1 w-full max-w-[1280px] mx-auto md:px-margin-desktop">
          {/* Search */}
          <SearchBar value={searchQuery} onChange={setSearchQuery} />

          {/* Categories */}
          <CategoryTabs
            categories={categoryNames}
            selectedCategory={selectedCategory}
            onSelectCategory={setSelectedCategory}
          />

          {/* Menu Grid */}
          {filteredItems.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-gutter px-margin-mobile md:px-0 pb-xl">
              {filteredItems.map((item) => (
                <FoodCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No Items Found"
              description="We couldn't find any menu items matching your request. Try adjusting your search or category."
              icon="search_off"
            />
          )}
        </main>

        {/* Sticky Action Bar */}
        <StickyActionBar tableId={table.id} />
      </div>
    </SessionGate>
  );
};
export default TableMenuClient;
