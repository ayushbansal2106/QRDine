"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MenuCategory, MenuItem } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { formatCurrency } from "@/utils/currency";
import { uploadImage } from "@/actions/upload";
import {
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/actions/menu";

interface MenuManagementClientProps {
  initialCategories: MenuCategory[];
  initialItems: MenuItem[];
}

export const MenuManagementClient: React.FC<MenuManagementClientProps> = ({
  initialCategories,
  initialItems,
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // State management
  const [categories, setCategories] = useState<MenuCategory[]>(initialCategories);
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortOption, setSortOption] = useState<string>("Custom Order");

  // Modals state
  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [isEditItemOpen, setIsEditItemOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [isEditCategoryOpen, setIsEditCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);

  // Forms state
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editCategoryOrder, setEditCategoryOrder] = useState("0");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryOrder, setNewCategoryOrder] = useState("0");

  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemImage, setItemImage] = useState("");
  const [itemGstPercentage, setItemGstPercentage] = useState<string>("0");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null);

  // Helper to get count of items in a category
  const getItemCount = (catId: string) => {
    if (catId === "All") return items.length;
    return items.filter((item) => item.categoryId === catId).length;
  };

  // Add Category Handler
  const handleAddCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    startTransition(async () => {
      try {
        const order = parseInt(newCategoryOrder, 10) || 0;
        const res = await createCategory(newCategoryName, order);
        if (res.success && res.category) {
          const newCat: MenuCategory = {
            id: res.category._id || res.category.id,
            name: res.category.name,
            displayOrder: res.category.displayOrder,
          };
          setCategories((prev) => [...prev, newCat]);
          setIsAddCategoryOpen(false);
          setNewCategoryName("");
          setNewCategoryOrder("0");
          router.refresh();
        }
      } catch (err: any) {
        alert(err.message || "Failed to create category");
      }
    });
  };

  // Edit Category Submit Handler
  const handleEditCategorySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory || !editCategoryName.trim()) return;

    startTransition(async () => {
      try {
        const order = parseInt(editCategoryOrder, 10) || 0;
        const res = await updateCategory(editingCategory.id, editCategoryName, order);
        if (res.success && res.category) {
          const updatedCat: MenuCategory = {
            id: res.category._id || res.category.id,
            name: res.category.name,
            displayOrder: res.category.displayOrder,
          };
          setCategories((prev) =>
            prev.map((c) => (c.id === editingCategory.id ? updatedCat : c))
          );
          setIsEditCategoryOpen(false);
          setEditingCategory(null);
          setEditCategoryName("");
          setEditCategoryOrder("0");
          router.refresh();
        }
      } catch (err: any) {
        alert(err.message || "Failed to update category");
      }
    });
  };

  // Open Edit Category Modal
  const openEditCategoryModal = (cat: MenuCategory) => {
    setEditingCategory(cat);
    setEditCategoryName(cat.name);
    setEditCategoryOrder(String(cat.displayOrder));
    setIsEditCategoryOpen(true);
  };

  // Delete Category Handler
  const handleDeleteCategory = (catId: string) => {
    if (!confirm("Are you sure you want to delete this category? All items in this category must be deleted first.")) return;

    startTransition(async () => {
      try {
        await deleteCategory(catId);
        setCategories((prev) => prev.filter((c) => c.id !== catId));
        if (selectedCategoryId === catId) {
          setSelectedCategoryId("All");
        }
        router.refresh();
      } catch (err: any) {
        alert(err.message || "Failed to delete category");
      }
    });
  };

  // Add Item Handler
  const handleAddItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !itemCategory || !itemPrice) return;

    startTransition(async () => {
      try {
        const res = await createMenuItem({
          categoryId: itemCategory,
          name: itemName,
          description: itemDescription,
          imageUrl: itemImage || undefined,
          price: parseFloat(itemPrice) || 0,
          gstPercentage: parseFloat(itemGstPercentage) || 0,
          available: itemAvailable,
          featured: false,
          preparationTime: 10,
        });

        if (res.success && res.item) {
          const categoryObj = categories.find((c) => c.id === res.item.categoryId);
          const newItem: MenuItem = {
            id: res.item._id || res.item.id,
            categoryId: res.item.categoryId,
            category: categoryObj,
            name: res.item.name,
            description: res.item.description || "",
            imageUrl: res.item.image || null,
            price: Number(res.item.price),
            gstPercentage: Number(res.item.gstPercentage || 0),
            available: res.item.isAvailable,
            featured: false,
            preparationTime: 10,
          };
          setItems((prev) => [newItem, ...prev]);
          setIsAddItemOpen(false);
          // Reset form
          setItemName("");
          setItemCategory("");
          setItemPrice("");
          setItemDescription("");
          setItemImage("");
          setItemAvailable(true);
          setItemGstPercentage("0");
          router.refresh();
        }
      } catch (err: any) {
        alert(err.message || "Failed to create menu item");
      }
    });
  };

  // Edit Item Handler
  const handleEditItemSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !itemName.trim() || !itemCategory || !itemPrice) return;

    startTransition(async () => {
      try {
        const res = await updateMenuItem(editingItem.id, {
          categoryId: itemCategory,
          name: itemName,
          description: itemDescription,
          imageUrl: itemImage || undefined,
          price: parseFloat(itemPrice) || 0,
          gstPercentage: parseFloat(itemGstPercentage) || 0,
          available: itemAvailable,
        });

        if (res.success && res.item) {
          const categoryObj = categories.find((c) => c.id === res.item.categoryId);
          const updatedItem: MenuItem = {
            id: res.item._id || res.item.id,
            categoryId: res.item.categoryId,
            category: categoryObj,
            name: res.item.name,
            description: res.item.description || "",
            imageUrl: res.item.image || null,
            price: Number(res.item.price),
            gstPercentage: Number(res.item.gstPercentage || 0),
            available: res.item.isAvailable,
            featured: false,
            preparationTime: 10,
          };

          setItems((prev) =>
            prev.map((item) => (item.id === editingItem.id ? updatedItem : item))
          );
          setIsEditItemOpen(false);
          setEditingItem(null);
          router.refresh();
        }
      } catch (err: any) {
        alert(err.message || "Failed to update menu item");
      }
    });
  };

  // Open Edit Dialog
  const openEditModal = (item: MenuItem) => {
    setEditingItem(item);
    setItemName(item.name);
    setItemCategory(item.categoryId);
    setItemPrice(String(item.price));
    setItemDescription(item.description);
    setItemImage(item.imageUrl || "");
    setItemAvailable(item.available);
    setItemGstPercentage(String(item.gstPercentage || 0));
    setIsEditItemOpen(true);
  };

  // Toggle Availability
  const handleToggleAvailable = (item: MenuItem) => {
    startTransition(async () => {
      try {
        const nextState = !item.available;
        // Optimistic UI update
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, available: nextState } : i))
        );

        await updateMenuItem(item.id, { available: nextState });
        router.refresh();
      } catch (err) {
        // Rollback on error
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, available: item.available } : i))
        );
        console.error(err);
      }
    });
  };

  // Delete Item Handler
  const handleDeleteItem = (itemId: string) => {
    if (!confirm("Are you sure you want to delete this menu item?")) return;

    startTransition(async () => {
      try {
        await deleteMenuItem(itemId);
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        router.refresh();
      } catch (err: any) {
        alert(err.message || "Failed to delete item");
      }
    });
  };

  // ─── Image Upload Handler ────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      alert("Invalid file type. Please select a JPEG, PNG, WebP, or GIF image.");
      e.target.value = "";
      return;
    }

    // Validate file size (5 MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large. Maximum size is 5 MB.");
      e.target.value = "";
      return;
    }

    // Show local preview immediately
    const localPreview = URL.createObjectURL(file);
    setUploadPreviewUrl(localPreview);

    // Upload to Cloudinary via backend
    setUploadingFile(true);
    try {
      const url = await uploadImage(file);
      setItemImage(url);
    } catch (err: any) {
      alert(err.message || "Failed to upload image.");
      setUploadPreviewUrl(null);
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  // Filter and Sort Items
  const filteredItems = items
    .filter((item) => {
      const matchesCategory =
        selectedCategoryId === "All" || item.categoryId === selectedCategoryId;

      const matchesSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      if (sortOption === "Name (A-Z)") {
        return a.name.localeCompare(b.name);
      }
      if (sortOption === "Price (High to Low)") {
        return b.price - a.price;
      }
      if (sortOption === "Price (Low to High)") {
        return a.price - b.price;
      }
      // "Custom Order" or default - preserves current list sequence
      return 0;
    });

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Top Header Bar */}
      <TopAppBar title="Menu Management" iconName="restaurant_menu" />

      {/* Main Canvas Area */}
      <main className="flex-1 p-margin-desktop overflow-y-auto">
        <div className="max-w-[1280px] mx-auto">
          {/* Section Heading & Actions */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-md mb-lg">
            <div>
              <h2 className="font-semibold text-headline-lg text-on-surface">Menu Management</h2>
              <p className="text-body-md text-on-surface-variant mt-xs">
                Organize categories, update items, and manage availability.
              </p>
            </div>
            <div className="flex gap-sm">
              <Button
                variant="secondary"
                onClick={() => setIsAddCategoryOpen(true)}
                className="h-10 px-md"
              >
                <span className="material-symbols-outlined text-[18px]">category</span>
                Add Category
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setItemName("");
                  setItemCategory("");
                  setItemPrice("");
                  setItemDescription("");
                  setItemImage("");
                  setItemAvailable(true);
                  setItemGstPercentage("0");
                  setIsAddItemOpen(true);
                }}
                className="h-10 px-md"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add Item
              </Button>
            </div>
          </div>

          {/* Grid Layout */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-gutter items-start">
            {/* Left Column: Categories Panel */}
            <aside className="md:col-span-3 bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container flex flex-col sticky top-20">
              <div className="p-sm border-b border-surface-container bg-surface-container-low/20 flex justify-between items-center">
                <h3 className="font-semibold text-title-sm text-on-surface">Categories</h3>
              </div>
              <div className="flex flex-col py-xs max-h-[400px] overflow-y-auto no-scrollbar">
                {/* All Items Option */}
                <div
                  onClick={() => setSelectedCategoryId("All")}
                  className={`group flex items-center justify-between px-md py-sm cursor-pointer border-l-4 transition-all duration-150 ${
                    selectedCategoryId === "All"
                      ? "bg-surface-container-low border-primary font-semibold text-primary"
                      : "border-transparent text-on-surface-variant hover:bg-surface-container-low/40"
                  }`}
                >
                  <div className="flex items-center gap-sm">
                    <span className="material-symbols-outlined text-[20px] select-none">
                      list_alt
                    </span>
                    <span className="text-body-md">All Items</span>
                  </div>
                  <span className="text-label-sm bg-surface-container-low text-on-surface-variant px-2 py-0.5 rounded-full border border-surface-container">
                    {getItemCount("All")}
                  </span>
                </div>

                {/* Individual Categories */}
                {categories.map((cat) => {
                  const isActive = selectedCategoryId === cat.id;
                  return (
                    <div
                      key={cat.id}
                      className={`group flex items-center justify-between px-md py-sm cursor-pointer border-l-4 transition-all duration-150 ${
                        isActive
                          ? "bg-surface-container-low border-primary font-semibold text-primary"
                          : "border-transparent text-on-surface-variant hover:bg-surface-container-low/40"
                      }`}
                    >
                      <div
                        className="flex items-center gap-sm flex-1 min-w-0"
                        onClick={() => setSelectedCategoryId(cat.id)}
                      >
                        <span className="material-symbols-outlined text-[20px] select-none">
                          label
                        </span>
                        <span className="text-body-md truncate max-w-[100px]">{cat.name}</span>
                      </div>
                      
                      {/* Action buttons (visible on hover) */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity mr-xs shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditCategoryModal(cat);
                          }}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors cursor-pointer"
                          title="Edit Category"
                        >
                          <span className="material-symbols-outlined text-[16px]">edit</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(cat.id);
                          }}
                          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                          title="Delete Category"
                        >
                          <span className="material-symbols-outlined text-[16px]">delete</span>
                        </button>
                      </div>

                      <span className="text-label-sm bg-surface-container-low text-on-surface-variant px-2 py-0.5 rounded-full border border-surface-container shrink-0">
                        {getItemCount(cat.id)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* Right Column: Menu Items Table */}
            <div className="md:col-span-9 flex flex-col gap-sm">
              <div className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container overflow-hidden">
                {/* Table Toolbar */}
                <div className="p-sm border-b border-surface-container flex flex-wrap items-center justify-between gap-sm bg-surface-container-low/10">
                  <div className="relative w-full sm:w-72">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-[18px]">
                      search
                    </span>
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-surface-container-lowest border border-surface-container rounded-lg py-1.5 pl-9 pr-3 text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none transition-all"
                      placeholder="Search menu items..."
                      type="text"
                    />
                  </div>
                  <div className="flex items-center gap-xs">
                    <span className="text-body-sm text-on-surface-variant">Sort by:</span>
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value)}
                      className="bg-surface-container-lowest border border-surface-container rounded-lg py-1.5 px-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none"
                    >
                      <option>Custom Order</option>
                      <option>Name (A-Z)</option>
                      <option>Price (High to Low)</option>
                      <option>Price (Low to High)</option>
                    </select>
                  </div>
                </div>

                {/* Table Data */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-container-low/20 border-b border-surface-container text-on-surface-variant/80 text-label-md">
                        <th className="py-sm px-md font-semibold">Item Details</th>
                        <th className="py-sm px-md font-semibold">Category</th>
                        <th className="py-sm px-md font-semibold text-right">Price</th>
                        <th className="py-sm px-md font-semibold text-right w-24">GST</th>
                        <th className="py-sm px-md font-semibold text-center w-24">Available</th>
                        <th className="py-sm px-md font-semibold text-right w-28">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container/60">
                      {filteredItems.length > 0 ? (
                        filteredItems.map((item) => (
                          <tr
                            key={item.id}
                            className={`hover:bg-surface-container-low/30 transition-colors group ${
                              !item.available ? "opacity-75" : ""
                            }`}
                          >
                            <td className="py-sm px-md">
                              <div className="flex items-center gap-sm">
                                <div className="w-12 h-12 rounded-lg overflow-hidden bg-surface-container-low border border-surface-container flex-shrink-0 flex items-center justify-center">
                                  {item.imageUrl ? (
                                    <img
                                      src={item.imageUrl}
                                      alt={item.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span className="material-symbols-outlined text-[24px] text-on-surface-variant/20 select-none">
                                      local_cafe
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-body-md text-on-surface truncate max-w-[200px] sm:max-w-[300px]">
                                    {item.name}
                                  </div>
                                  <div className="text-body-sm text-on-surface-variant truncate max-w-[200px] sm:max-w-[300px]">
                                    {item.description}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-sm px-md">
                              <span className="inline-flex items-center px-sm py-0.5 rounded-full text-label-sm font-semibold bg-surface-container text-on-surface-variant border border-surface-container">
                                {item.category?.name || "Uncategorized"}
                              </span>
                            </td>
                            <td className="py-sm px-md text-right font-semibold text-body-md text-on-surface">
                              {formatCurrency(item.price)}
                            </td>
                            <td className="py-sm px-md text-right text-body-sm text-on-surface-variant">
                              {item.gstPercentage}%
                            </td>
                            <td className="py-sm px-md text-center">
                              {/* Switch Toggle */}
                              <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={item.available}
                                  onChange={() => handleToggleAvailable(item)}
                                  className="sr-only peer"
                                  disabled={isPending}
                                />
                                <div className="w-9 h-5 bg-surface-container peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-surface-container after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                              </label>
                            </td>
                            <td className="py-sm px-md text-right">
                              <div className="flex items-center justify-end gap-xs opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container hover:text-primary transition-colors cursor-pointer"
                                  title="Edit Item"
                                >
                                  <span className="material-symbols-outlined text-[18px]">edit</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                                  title="Delete Item"
                                >
                                  <span className="material-symbols-outlined text-[18px]">delete</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="text-center py-xl text-on-surface-variant/40">
                            No menu items found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Table Footer / Counter */}
                <div className="p-sm border-t border-surface-container bg-surface-container-low/10 flex items-center justify-between text-body-sm text-on-surface-variant">
                  <span>Showing {filteredItems.length} items</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Add Category Modal */}
      <Modal
        isOpen={isAddCategoryOpen}
        onClose={() => setIsAddCategoryOpen(false)}
        title="Add Category"
      >
        <form onSubmit={handleAddCategorySubmit} className="flex flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Category Name</label>
            <input
              required
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              placeholder="e.g. Desserts"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Display Order</label>
            <input
              type="number"
              value={newCategoryOrder}
              onChange={(e) => setNewCategoryOrder(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              placeholder="0"
            />
          </div>
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsAddCategoryOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Creating..." : "Create Category"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Item Modal */}
      <Modal isOpen={isAddItemOpen} onClose={() => setIsAddItemOpen(false)} title="Add Menu Item">
        <form onSubmit={handleAddItemSubmit} className="flex flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Item Name</label>
            <input
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              placeholder="e.g. Iced Latte"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Category</label>
            <select
              required
              value={itemCategory}
              onChange={(e) => setItemCategory(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="">Select Category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Price (₹)</label>
            <input
              required
              type="number"
              step="0.01"
              value={itemPrice}
              onChange={(e) => setItemPrice(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              placeholder="180.00"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">GST Rate</label>
            <select
              value={itemGstPercentage}
              onChange={(e) => setItemGstPercentage(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="0">0%</option>
              <option value="5">5%</option>
              <option value="12">12%</option>
              <option value="18">18%</option>
              <option value="28">28%</option>
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Description</label>
            <textarea
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none h-20 resize-none"
              placeholder="Description of the menu item..."
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">
              Item Image
            </label>
            <div className="flex flex-col gap-sm">
              {/* Drop zone / preview area */}
              <div
                className={`relative border-2 border-dashed rounded-xl p-md text-center transition-all cursor-pointer ${
                  uploadPreviewUrl || itemImage
                    ? "border-primary bg-primary/5"
                    : "border-surface-container hover:border-primary/40 hover:bg-surface-container-low"
                }`}
                onClick={() => document.getElementById("add-item-image-input")?.click()}
              >
                {uploadingFile ? (
                  <div className="flex flex-col items-center gap-sm py-md">
                    <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
                    <span className="font-inter text-body-sm text-on-surface-variant">
                      Uploading image...
                    </span>
                  </div>
                ) : uploadPreviewUrl || itemImage ? (
                  <div className="relative group">
                    <img
                      src={uploadPreviewUrl || itemImage}
                      alt="Preview"
                      className="w-full h-32 object-cover rounded-lg"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setItemImage("");
                        setUploadPreviewUrl(null);
                      }}
                      className="absolute top-1 right-1 w-7 h-7 rounded-full bg-on-surface/60 text-white flex items-center justify-center hover:bg-error transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-sm py-md">
                    <span className="material-symbols-outlined text-[36px] text-on-surface-variant/30">
                      add_photo_alternate
                    </span>
                    <div>
                      <p className="font-inter font-semibold text-body-sm text-on-surface">
                        Click to upload image
                      </p>
                      <p className="font-inter text-label-sm text-on-surface-variant mt-xs">
                        JPEG, PNG, WebP, GIF · Max 5 MB
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Hidden file input */}
              <input
                id="add-item-image-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleFileSelect}
              />

              {/* OR URL fallback */}
              <div className="flex items-center gap-xs">
                <div className="flex-1 h-px bg-surface-container" />
                <span className="font-inter text-label-sm text-on-surface-variant shrink-0">
                  or paste URL
                </span>
                <div className="flex-1 h-px bg-surface-container" />
              </div>
              <input
                type="url"
                value={itemImage}
                onChange={(e) => {
                  setItemImage(e.target.value);
                  setUploadPreviewUrl(null);
                }}
                placeholder="https://example.com/image.jpg"
                className="w-full bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-sm py-xs">
            <label className="font-semibold text-label-md text-on-surface">Available</label>
            <input
              type="checkbox"
              checked={itemAvailable}
              onChange={(e) => setItemAvailable(e.target.checked)}
              className="w-4 h-4 text-primary focus:ring-primary border-surface-container rounded"
            />
          </div>
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsAddItemOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending || uploadingFile}>
              {isPending ? "Adding..." : "Add Item"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Item Modal */}
      <Modal isOpen={isEditItemOpen} onClose={() => setIsEditItemOpen(false)} title="Edit Menu Item">
        <form onSubmit={handleEditItemSubmit} className="flex flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Item Name</label>
            <input
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Category</label>
            <select
              required
              value={itemCategory}
              onChange={(e) => setItemCategory(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Price (₹)</label>
            <input
              required
              type="number"
              step="0.01"
              value={itemPrice}
              onChange={(e) => setItemPrice(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">GST Rate</label>
            <select
              value={itemGstPercentage}
              onChange={(e) => setItemGstPercentage(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            >
              <option value="0">0%</option>
              <option value="5">5%</option>
              <option value="12">12%</option>
              <option value="18">18%</option>
              <option value="28">28%</option>
            </select>
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Description</label>
            <textarea
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none h-20 resize-none"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Image URL (Optional)</label>
            <input
              value={itemImage}
              onChange={(e) => setItemImage(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex items-center gap-sm py-xs">
            <label className="font-semibold text-label-md text-on-surface">Available</label>
            <input
              type="checkbox"
              checked={itemAvailable}
              onChange={(e) => setItemAvailable(e.target.checked)}
              className="w-4 h-4 text-primary focus:ring-primary border-surface-container rounded"
            />
          </div>
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsEditItemOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Category Modal */}
      <Modal
        isOpen={isEditCategoryOpen}
        onClose={() => setIsEditCategoryOpen(false)}
        title="Edit Category"
      >
        <form onSubmit={handleEditCategorySubmit} className="flex flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Category Name</label>
            <input
              required
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Display Order</label>
            <input
              type="number"
              value={editCategoryOrder}
              onChange={(e) => setEditCategoryOrder(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsEditCategoryOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
export default MenuManagementClient;
