"use client";

import React, { useEffect, useState } from "react";
import { MenuItem } from "@/types";
import { useCartStore } from "@/store/cartStore";
import { QuantityStepper } from "./QuantityStepper";
import { formatCurrency } from "@/utils/currency";

import { useSessionStore } from "@/store/sessionStore";

interface FoodCardProps {
  item: MenuItem;
}

export const FoodCard: React.FC<FoodCardProps> = ({ item }) => {
  const { items, addItem, updateQuantity, removeItem } = useCartStore();
  const { sessionStatus } = useSessionStore();
  const [cartQuantity, setCartQuantity] = useState(0);

  const isSessionLocked = sessionStatus === 'bill_requested' || sessionStatus === 'awaiting_payment';

  useEffect(() => {
    const matched = items.find((i) => i.menuItem.id === item.id);
    setCartQuantity(matched ? matched.quantity : 0);
  }, [items, item.id]);

  const handleAdd = () => {
    addItem(item);
  };

  const handleIncrease = () => {
    updateQuantity(item.id, cartQuantity + 1);
  };

  const handleDecrease = () => {
    updateQuantity(item.id, cartQuantity - 1);
  };

  return (
    <article className="bg-surface-container-lowest rounded-xl shadow-[0px_4px_20px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden transition-all duration-300 hover:shadow-[0px_8px_32px_rgba(0,0,0,0.08)]">
      <div className="image-container h-48 w-full bg-surface-container-high relative">
        <img
          alt={item.name}
          className="w-full h-full object-cover card-image-hover transition-transform duration-500 ease-in-out"
          src={item.imageUrl || "https://images.unsplash.com/photo-1541167760496-1628856ab772?w=500&auto=format&fit=crop&q=60"}
        />
        {item.featured && (
          <div className="absolute top-sm right-sm bg-surface-container-lowest/90 backdrop-blur-sm px-sm py-xs rounded-full border border-primary text-primary font-inter font-medium text-label-sm select-none">
            Popular
          </div>
        )}
      </div>
      <div className="p-md flex flex-col justify-between flex-1">
        <div>
          <h3 className="font-inter font-semibold text-headline-md text-on-surface mb-xs truncate">
            {item.name}
          </h3>
          <p className="font-inter font-normal text-body-sm text-on-surface-variant mb-md line-clamp-2 min-h-[40px]">
            {item.description}
          </p>
        </div>
        <div className="flex items-center justify-between mt-auto pt-sm">
          <span className="font-inter font-semibold text-body-lg text-primary">
            {formatCurrency(item.price)}
          </span>

          {cartQuantity > 0 ? (
            <QuantityStepper
              quantity={cartQuantity}
              onIncrease={handleIncrease}
              onDecrease={handleDecrease}
              size="sm"
            />
          ) : (
            <button
              onClick={handleAdd}
              disabled={!item.available || isSessionLocked}
              aria-label={`Add ${item.name} to cart`}
              className={`bg-surface-container text-on-surface p-base rounded-full hover:bg-primary hover:text-on-primary active:scale-95 transition-all flex items-center justify-center w-10 h-10 shadow-[0px_4px_20px_rgba(0,0,0,0.04)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <span className="material-symbols-outlined text-[20px] select-none">
                {item.available && !isSessionLocked ? "add" : "block"}
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
