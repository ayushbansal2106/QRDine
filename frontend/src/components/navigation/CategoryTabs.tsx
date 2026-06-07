"use client";

import React from "react";

interface CategoryTabsProps {
  categories: string[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="w-full overflow-x-auto no-scrollbar px-margin-mobile md:px-0 py-md flex gap-sm items-center">
      {categories.map((category) => {
        const isActive = selectedCategory === category;
        return (
          <button
            key={category}
            onClick={() => onSelectCategory(category)}
            className={`px-md py-base rounded-full font-inter font-semibold text-label-md whitespace-nowrap shadow-[0px_4px_20px_rgba(0,0,0,0.04)] cursor-pointer transition-colors duration-200 ${
              isActive
                ? "bg-primary text-on-primary"
                : "border border-primary text-primary bg-surface-container-lowest hover:bg-surface-container-low"
            }`}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
};
