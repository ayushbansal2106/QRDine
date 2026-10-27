"use client";

import React from "react";
import Image from "next/image";
import { CartItem as CartItemType } from "@/types";
import { QuantityStepper } from "@/components/menu/QuantityStepper";
import { useCartStore, cartLineKey } from "@/store/cartStore";
import { formatCurrency } from "@/utils/currency";

interface CartItemProps {
  item: CartItemType;
}

export const CartItem: React.FC<CartItemProps> = ({ item }) => {
  const { updateQuantity, removeItem } = useCartStore();

  // Lines are keyed by configuration, not just the dish, so a large-with-extra
  // line is edited without touching the plain one.
  const lineId = cartLineKey(item);

  const handleIncrease = () => {
    if (item.quantity >= 50) return;
    updateQuantity(lineId, item.quantity + 1);
  };

  const handleDecrease = () => {
    updateQuantity(lineId, item.quantity - 1);
  };

  const handleRemove = () => {
    removeItem(lineId);
  };

  return (
    <div className="flex items-center gap-md py-md border-b border-surface-container last:border-none">
      {/* Item Image */}
      <div className="w-20 h-20 rounded-lg bg-surface-container-high overflow-hidden shrink-0">
        <Image
          alt={item.menuItem.name}
          className="w-full h-full object-cover"
          src={item.menuItem.imageUrl || "https://images.unsplash.com/photo-1541167760496-1628856ab772?w=120&auto=format&fit=crop&q=60"}
          width={80}
          height={80}
        />
      </div>

      {/* Item Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-inter font-semibold text-body-lg text-on-surface truncate">
          {item.menuItem.name}
        </h4>
        {(item.variantName || item.modifiers?.length || item.notes) && (
          <p className="font-inter text-body-sm text-on-surface-variant">
            {[item.variantName, (item.modifiers || []).map((m) => m.optionName).join(", "), item.notes]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <span className="font-inter font-semibold text-body-md text-primary block mt-xs">
          {formatCurrency(Number(item.unitPrice ?? item.menuItem.price))}
        </span>
      </div>

      {/* Stepper & Delete */}
      <div className="flex flex-col items-end gap-sm">
        <button
          onClick={handleRemove}
          className="text-on-surface-variant hover:text-error transition-colors p-xs"
          aria-label={`Remove ${item.menuItem.name}`}
        >
          <span className="material-symbols-outlined text-[20px] select-none">
            delete
          </span>
        </button>
        <QuantityStepper
          quantity={item.quantity}
          onIncrease={handleIncrease}
          onDecrease={handleDecrease}
          size="sm"
        />
      </div>
    </div>
  );
};
export default CartItem;
