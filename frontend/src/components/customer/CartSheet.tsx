"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { cartLineKey, useCartStore } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";
import { BottomSheet } from "./BottomSheet";

interface CartSheetProps {
  isOpen: boolean;
  onClose: () => void;
  cafeName: string;
  tableNumber: number;
  /**
   * Whether the guest has a customer profile. Browsing and filling the cart
   * never require one, so the call to action is honest about what happens
   * next instead of surprising them at the till.
   */
  isSignedIn?: boolean;
}

/**
 * Cart review sheet.
 *
 * Quantities are read straight from the store and written through
 * updateQuantity/removeItem, so the sheet has no local copy to fall out of sync
 * with the menu behind it.
 */
export const CartSheet: React.FC<CartSheetProps> = ({
  isOpen,
  onClose,
  cafeName,
  tableNumber,
  isSignedIn = false,
}) => {
  const router = useRouter();
  const { items, getTotalItems, getTotalPrice, updateQuantity, removeItem } = useCartStore();

  const totalItems = getTotalItems();
  const total = getTotalPrice();

  const handleReview = () => {
    onClose();
    router.push("/checkout");
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      maxHeight="88vh"
      labelledBy="cart-title"
      footer={
        <div className="flex flex-col gap-sm">
          <button
            type="button"
            onClick={handleReview}
            disabled={items.length === 0}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-md text-on-primary active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-2 text-body-md font-semibold">
              <span className="material-symbols-outlined text-[18px]">
                shopping_bag
              </span>
              Review & place order
            </span>
            <span className="flex items-center gap-1 text-body-md font-semibold">
              {formatCurrency(total)}
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </span>
          </button>

          <p className="flex items-center justify-center gap-1 text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[12px]">lock</span>
            Secure checkout
          </p>
        </div>
      }
    >
      {/* Header */}
      <div className="flex items-start gap-sm px-margin-mobile pt-2 pb-md">
        <div className="min-w-0 flex-1">
          <h2 id="cart-title" className="text-headline-sm md:text-headline-md font-semibold text-on-surface">
            Your order
          </h2>
          <p className="text-body-sm text-on-surface-variant truncate">
            from {cafeName || "the café"} · T-{tableNumber}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cart"
          className="shrink-0 -mr-1 grid h-8 w-8 place-items-center rounded-full text-on-surface-variant active:bg-surface-container"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div className="flex flex-col gap-sm px-margin-mobile pb-md">
        {/* Lines */}
        {items.map((item) => {
          const key = cartLineKey(item);
          const unit = Number(item.unitPrice ?? item.menuItem.price ?? 0);
          const isVeg = item.menuItem.dietaryTags?.[0] === "veg";
          const modifierNames = (item.modifiers || []).map((m) => m.optionName);

          return (
            <div
              key={key}
              className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md"
            >
              <div className="flex items-start gap-sm">
                <span aria-hidden="true" className="mt-1.5 shrink-0 grid h-3 w-3 place-items-center">
                  <span
                    className={`block h-2.5 w-2.5 border-[1.5px] ${
                      isVeg ? "border-success rounded-[2px]" : "border-error"
                    }`}
                  >
                    {isVeg ? (
                      <span className="block m-auto h-1 w-1 rounded-full bg-success" />
                    ) : (
                      <span className="block m-auto h-0 w-0 border-x-[3px] border-x-transparent border-b-[5px] border-b-error" />
                    )}
                  </span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-body-md font-semibold text-on-surface leading-snug">
                    {item.menuItem.name}
                  </p>
                  {item.variantName && (
                    <p className="text-body-sm text-on-surface-variant">{item.variantName}</p>
                  )}
                  {modifierNames.length > 0 && (
                    <p className="text-body-sm text-on-surface-variant">{modifierNames.join(", ")}</p>
                  )}
                  <p className="mt-1 text-body-md font-semibold text-on-surface">
                    {formatCurrency(unit * item.quantity)}
                  </p>
                  <button
                    type="button"
                    onClick={() => removeItem(key)}
                    className="mt-2 inline-flex items-center gap-1 text-body-sm text-on-surface-variant active:text-error"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span>
                    Remove
                  </button>
                </div>

                {/* Stepper */}
                <div className="shrink-0 inline-flex items-center rounded-xl bg-primary text-on-primary">
                  <button
                    type="button"
                    onClick={() =>
                      item.quantity <= 1 ? removeItem(key) : updateQuantity(key, item.quantity - 1)
                    }
                    aria-label={`Remove one ${item.menuItem.name}`}
                    className="grid h-9 w-9 place-items-center rounded-l-xl active:bg-white/10"
                  >
                    <span className="material-symbols-outlined text-[16px]">remove</span>
                  </button>
                  <span className="min-w-6 text-center text-body-md font-semibold tabular-nums">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateQuantity(key, item.quantity + 1)}
                    aria-label={`Add one ${item.menuItem.name}`}
                    className="grid h-9 w-9 place-items-center rounded-r-xl active:bg-white/10"
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Bill summary */}
        <div className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
          <h3 className="mb-sm text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Bill summary
          </h3>

          <div className="flex items-center justify-between text-body-md text-on-surface">
            <span>
              Item total ({totalItems} {totalItems === 1 ? "item" : "items"})
            </span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>

          <div className="my-sm border-t border-dashed border-surface-container-high" />

          <div className="flex items-center justify-between">
            <span className="text-body-lg font-semibold text-on-surface">Grand total</span>
            <span className="text-body-lg font-semibold text-on-surface tabular-nums">
              {formatCurrency(total)}
            </span>
          </div>

          <p className="mt-1 text-[11px] text-on-surface-variant">
            Taxes included. The final amount is calculated at the till.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-1 inline-flex items-center justify-center gap-1.5 py-2 text-body-md font-medium text-primary"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add more items
        </button>
      </div>
    </BottomSheet>
  );
};

export default CartSheet;