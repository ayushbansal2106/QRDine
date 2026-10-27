"use client";

import React from "react";

interface QuantityStepperProps {
  quantity: number;
  onIncrease: () => void;
  onDecrease: () => void;
  size?: "sm" | "md";
  max?: number;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  quantity,
  onIncrease,
  onDecrease,
  size = "md",
  max = 50,
}) => {
  const buttonClass =
    size === "sm"
      ? "w-8 h-8 text-[16px] rounded-full flex items-center justify-center bg-surface-container text-on-surface hover:bg-primary hover:text-on-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-container disabled:hover:text-on-surface transition-colors shadow-[0px_2px_8px_rgba(0,0,0,0.04)] cursor-pointer"
      : "w-10 h-10 text-[20px] rounded-full flex items-center justify-center bg-surface-container text-on-surface hover:bg-primary hover:text-on-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-container disabled:hover:text-on-surface transition-colors shadow-[0px_4px_20px_rgba(0,0,0,0.04)] cursor-pointer";

  return (
    <div className="flex items-center gap-sm">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDecrease();
        }}
        aria-label="Decrease quantity"
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-[inherit] select-none">remove</span>
      </button>
      <span className="font-inter font-semibold text-body-lg text-on-surface min-w-[24px] text-center select-none">
        {quantity}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (quantity < max) {
            onIncrease();
          }
        }}
        disabled={quantity >= max}
        aria-label="Increase quantity"
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-[inherit] select-none">add</span>
      </button>
    </div>
  );
};
