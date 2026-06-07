import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MenuItem, CartItem } from "@/types";

interface CartState {
  items: CartItem[];
  tableId: string | null;
  sessionId: string | null;
  setTableId: (tableId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  addItem: (item: MenuItem) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      tableId: null,
      sessionId: null,
      setTableId: (tableId) => set({ tableId }),
      setSessionId: (sessionId) => set({ sessionId }),
      addItem: (item) => {
        const currentItems = get().items;
        const existingItem = currentItems.find((i) => i.menuItem.id === item.id);
        if (existingItem) {
          set({
            items: currentItems.map((i) =>
              i.menuItem.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
            ),
          });
        } else {
          set({ items: [...currentItems, { menuItem: item, quantity: 1 }] });
        }
      },
      removeItem: (itemId) => {
        set({
          items: get().items.filter((i) => i.menuItem.id !== itemId),
        });
      },
      updateQuantity: (itemId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return;
        }
        set({
          items: get().items.map((i) =>
            i.menuItem.id === itemId ? { ...i, quantity } : i
          ),
        });
      },
      clearCart: () => set({ items: [], sessionId: null }),
      getTotalItems: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },
      getTotalPrice: () => {
        return get().items.reduce(
          (sum, item) => sum + Number(item.menuItem.price) * item.quantity,
          0
        );
      },
    }),
    {
      name: "qrdine-cart-storage",
      partialize: (state) => ({ items: state.items, tableId: state.tableId, sessionId: state.sessionId }),
    }
  )
);
