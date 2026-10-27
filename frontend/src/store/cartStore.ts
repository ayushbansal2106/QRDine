import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartItem, MenuItem, SelectedModifier } from "@/types";

export interface AddItemOptions {
  variantId?: string;
  variantName?: string;
  modifiers?: SelectedModifier[];
  notes?: string;
  unitPrice?: number;
}

interface CartState {
  items: CartItem[];
  tableId: string | null;
  /**
   * Human table number, kept alongside the id so the cart and review screens
   * can show "T-2" instead of guessing from an ObjectId.
   */
  tableNumber: number | null;
  /**
   * The café this table belongs to. Kept alongside the table because the
   * checkout sign-in gate needs a tenant to request an OTP for, and it renders
   * outside the table page where that value is no longer in scope.
   */
  cafeId: string | null;
  sessionId: string | null;
  lastUpdated: number | null;
  setTableId: (tableId: string | null, tableNumber?: number | null) => void;
  setCafeId: (cafeId: string | null) => void;
  setSessionId: (sessionId: string | null) => void;
  addItem: (item: MenuItem, options?: AddItemOptions) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalItems: () => number;
  getTotalPrice: () => number;
}

/**
 * Two lines of the same dish are different rows when they were configured
 * differently — a large iced with oat milk is not a large iced with none — so the
 * cart is keyed by item + variant + chosen options rather than by item id alone.
 */
export const lineKey = (itemId: string, options?: AddItemOptions | CartItem) => {
  const variantId = options && "variantId" in options ? options.variantId : undefined;
  const modifiers =
    options && "modifiers" in options ? (options as CartItem).modifiers || [] : [];

  return [
    itemId,
    variantId || "base",
    modifiers
      .map((m) => `${m.optionId || m.optionName}`)
      .sort()
      .join("|"),
  ].join("::");
};

export const cartLineKey = (item: CartItem) => lineKey(item.menuItem.id, item);

export const resolveUnitPrice = (item: MenuItem, options?: AddItemOptions) => {
  if (options?.unitPrice !== undefined) return options.unitPrice;
  const base = options?.variantId
    ? item.variants?.find((v) => v._id === options.variantId)?.price ?? item.price
    : item.price;
  const modifiers = (options?.modifiers || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  return Number(base) + modifiers;
};

const CART_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      tableId: null,
      tableNumber: null,
      cafeId: null,
      sessionId: null,
      lastUpdated: null,
      setTableId: (tableId, tableNumber) =>
        set((state) => ({
          tableId,
          tableNumber: tableNumber ?? state.tableNumber,
          lastUpdated: Date.now(),
        })),
      setCafeId: (cafeId) => set({ cafeId, lastUpdated: Date.now() }),
      setSessionId: (sessionId) => set({ sessionId, lastUpdated: Date.now() }),

      addItem: (item, options = {}) => {
        const key = lineKey(item.id, options);
        const unitPrice = resolveUnitPrice(item, options);
        const currentItems = get().items;
        const existingIndex = currentItems.findIndex((i) => cartLineKey(i) === key);

        if (existingIndex >= 0) {
          const next = [...currentItems];
          const newQty = Math.min(50, next[existingIndex].quantity + 1);
          next[existingIndex] = { ...next[existingIndex], quantity: newQty };
          set({ items: next, lastUpdated: Date.now() });
          return;
        }

        set({
          items: [
            ...currentItems,
            {
              menuItem: item,
              quantity: 1,
              variantId: options.variantId,
              variantName: options.variantName,
              modifiers: options.modifiers,
              notes: options.notes,
              unitPrice,
            },
          ],
          lastUpdated: Date.now(),
        });
      },

      removeItem: (lineId) => {
        set({
          items: get().items.filter((i) => cartLineKey(i) !== lineId),
          lastUpdated: Date.now(),
        });
      },

      updateQuantity: (lineId, quantity) => {
        if (quantity <= 0) {
          set({
            items: get().items.filter((i) => cartLineKey(i) !== lineId),
            lastUpdated: Date.now(),
          });
          return;
        }
        const clampedQuantity = Math.min(50, Math.floor(quantity));
        set({
          items: get().items.map((item) =>
            cartLineKey(item) === lineId ? { ...item, quantity: clampedQuantity } : item
          ),
          lastUpdated: Date.now(),
        });
      },

      clearCart: () => set({ items: [], sessionId: null, lastUpdated: null }),
      getTotalItems: () => get().items.reduce((sum, item) => sum + item.quantity, 0),
      getTotalPrice: () =>
        get().items.reduce(
          (sum, item) => sum + Number(item.unitPrice ?? item.menuItem.price) * item.quantity,
          0
        ),
    }),
    {
      name: "qrdine-cart-storage",
      onRehydrateStorage: () => (state) => {
        if (state && state.lastUpdated) {
          if (Date.now() - state.lastUpdated > CART_TTL_MS) {
            // Cart has expired after 24 hours of inactivity
            state.clearCart();
          }
        }
      },
      partialize: (state) => ({
        items: state.items,
        tableId: state.tableId,
        tableNumber: state.tableNumber,
        cafeId: state.cafeId,
        sessionId: state.sessionId,
        lastUpdated: state.lastUpdated,
      }),
    }
  )
);