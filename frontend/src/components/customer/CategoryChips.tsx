"use client";

import React from "react";

export interface CategoryChip {
  id: string;
  name: string;
  count: number;
}

interface CategoryChipsProps {
  categories: CategoryChip[];
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Horizontally scrollable category chips with live dish counts.
 *
 * Snaps to one chip per gesture so a thumb swipe lands on a whole category,
 * and keeps the selected chip in view when the list changes underneath it.
 */
export const CategoryChips: React.FC<CategoryChipsProps> = ({
  categories,
  selectedId,
  onSelect,
}) => {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-selected="true"]');
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [selectedId]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Menu categories"
      className="-mx-margin-mobile md:-mx-0 px-margin-mobile md:px-0 flex gap-sm overflow-x-auto scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {categories.map((cat) => {
        const selected = cat.id === selectedId;
        return (
          <button
            key={cat.id}
            type="button"
            role="tab"
            aria-selected={selected}
            data-selected={selected}
            onClick={() => onSelect(cat.id)}
            className={`snap-start shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-body-sm font-medium transition-colors ${
              selected
                ? "bg-on-surface text-on-primary border-on-surface"
                : "bg-surface-container-lowest text-on-surface border-surface-container"
            }`}
          >
            <span className="max-w-[9rem] truncate">{cat.name}</span>
            <span className={selected ? "opacity-70" : "text-on-surface-variant"}>{cat.count}</span>
          </button>
        );
      })}
    </div>
  );
};