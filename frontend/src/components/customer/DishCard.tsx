"use client";

import React from "react";
import { MenuItem } from "@/types";
import { cartLineKey, useCartStore } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { formatCurrency } from "@/utils/currency";
import { DishPlaceholder } from "./DishPlaceholder";

interface DishCardProps {
  item: MenuItem;
  onOpenDetail?: (item: MenuItem) => void;
  /**
   * False until the persisted cart and session have rehydrated on the client.
   * Supplied by the parent rather than read here, so forty cards do not each
   * subscribe to the same hydration event.
   */
  hydrated?: boolean;
}

/**
 * Horizontal dish card: text on the left, photo on the right, add control
 * overlapping the image's lower edge.
 *
 * Layout is built mobile-first with min-w-0 on the text column — without it a
 * long dish name forces the card wider than the viewport and the whole page
 * scrolls sideways, which is the classic failure of this card pattern.
 */
export const DishCard: React.FC<DishCardProps> = ({
  item,
  onOpenDetail,
  hydrated = false,
}) => {
  const { items, addItem, updateQuantity, removeItem, getTotalItems } = useCartStore();
  const { sessionStatus } = useSessionStore();

  const isLocked =
    hydrated &&
    (sessionStatus === "bill_requested" || sessionStatus === "awaiting_payment");

  // Derived during render rather than mirrored into state through an effect:
  // an effect that copies cart state into local state causes a cascading
  // render every time the cart changes, and can briefly show a stale count.
  // A configured line (with variants/modifiers) is tracked separately from the
  // plain base line.
  // The cart is persisted, so on the first client pass its contents are still
  // unknown. Reading them immediately would render a qty stepper where the
  // server rendered an ADD button, which React reports as a hydration mismatch.
  const baseLine = hydrated
    ? items.find(
        (i) => i.menuItem.id === item.id && !i.variantId && !(i.modifiers || []).length
      )
    : undefined;
  const quantity = baseLine?.quantity ?? 0;
  const lineKey = baseLine ? cartLineKey(baseLine) : "";

  const handleAdd = () => {
    // Anything configurable opens the detail sheet — a silent default order is
    // how wrong items get made.
    if (item.variants?.length || item.modifierGroups?.length) {
      onOpenDetail?.(item);
      return;
    }
    addItem(item);
  };

  const handleIncrease = () => {
    if (quantity >= 50) return;
    if (lineKey) updateQuantity(lineKey, quantity + 1);
    else addItem(item);
  };

  const handleDecrease = () => {
    if (!lineKey) return;
    if (quantity <= 1) removeItem(lineKey);
    else updateQuantity(lineKey, quantity - 1);
  };

  const gallery = [item.imageUrl, ...(item.media || []).map((m) => m.url)].filter(
    Boolean
  ) as string[];
  const photo = gallery[0];
  const isVeg = item.dietaryTags?.[0] === "veg";
  const hasVariants = (item.variants?.length ?? 0) > 0;
  const cartCount = hydrated ? getTotalItems() : 0;

  return (
    <article className="relative flex gap-sm rounded-2xl border border-surface-container bg-surface-container-lowest p-sm transition-shadow active:shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      {/* Text column */}
      <button
        type="button"
        onClick={() => onOpenDetail?.(item)}
        className="flex-1 min-w-0 flex flex-col gap-xs text-left"
        aria-label={`View ${item.name}`}
      >
        <span className="flex items-start gap-1.5">
          {/* Indian veg / non-veg mark: green square-dot vs red triangle */}
          <span aria-hidden="true" className="mt-1 shrink-0 grid h-3 w-3 place-items-center">
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

          <span className="min-w-0">
            <span className="block font-semibold text-body-md text-on-surface leading-snug">
              {item.name}
            </span>
          </span>
        </span>

        <span className="flex items-baseline gap-1.5 pl-5">
          <span className="text-body-md font-semibold text-on-surface">
            {formatCurrency(item.price)}
          </span>
          {hasVariants && <span className="text-[11px] text-on-surface-variant">onwards</span>}
        </span>

        {item.description && (
          <span className="pl-5 text-body-sm text-on-surface-variant leading-snug line-clamp-2">
            {item.description}
          </span>
        )}
      </button>

      {/* Photo column */}
      <div className="relative shrink-0">
        <div className="h-24 w-24 md:h-28 md:w-28 overflow-hidden rounded-xl">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={item.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <DishPlaceholder name={item.name} className="h-full w-full" />
          )}
        </div>

        {/* Add control sits on the image's lower edge, as in the reference. */}
        {!isLocked &&
          (quantity > 0 ? (
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center rounded-full bg-on-surface text-on-primary shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
              <button
                type="button"
                onClick={handleDecrease}
                aria-label={`Remove one ${item.name}`}
                className="grid h-8 w-8 place-items-center rounded-full active:bg-white/10"
              >
                <span className="material-symbols-outlined text-[16px]">remove</span>
              </button>
              <span className="min-w-5 text-center text-body-sm font-semibold tabular-nums">
                {quantity}
              </span>
              <button
                type="button"
                onClick={handleIncrease}
                disabled={quantity >= 50}
                aria-label={`Add one ${item.name}`}
                className="grid h-8 w-8 place-items-center rounded-full active:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              aria-label={`Add ${item.name} to cart`}
              className="absolute -bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-0.5 h-8 px-3 rounded-full bg-primary text-on-primary text-[11px] font-bold uppercase tracking-wider shadow-[0_2px_10px_rgba(0,0,0,0.18)] active:scale-[0.96] transition-transform"
            >
              Add
              <span className="material-symbols-outlined text-[14px]">add</span>
            </button>
          ))}

        {isLocked && cartCount > 0 && (
          <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-semibold px-2 py-1">
            Bill raised
          </span>
        )}
      </div>
    </article>
  );
};