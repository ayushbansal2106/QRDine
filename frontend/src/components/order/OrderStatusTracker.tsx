"use client";

import React from "react";
import { OrderStatus } from "@/types";

interface OrderStatusTrackerProps {
  status: OrderStatus;
}

export const OrderStatusTracker: React.FC<OrderStatusTrackerProps> = ({
  status,
}) => {
  const steps: { label: string; statusValue: OrderStatus; icon: string }[] = [
    { label: "Pending", statusValue: "PENDING", icon: "hourglass_empty" },
    { label: "Accepted", statusValue: "ACCEPTED", icon: "check" },
    { label: "Preparing", statusValue: "PREPARING", icon: "cooking" },
    { label: "Ready", statusValue: "READY", icon: "restaurant" },
    { label: "Served", statusValue: "SERVED", icon: "celebration" },
  ];

  const getStepIndex = (s: OrderStatus) => {
    if (s === "CANCELLED") return -1;
    return steps.findIndex((step) => step.statusValue === s);
  };

  const currentIndex = getStepIndex(status);

  if (status === "CANCELLED") {
    return (
      <div className="bg-error/10 border border-error text-error rounded-xl p-md flex items-center gap-sm">
        <span className="material-symbols-outlined text-[24px]">cancel</span>
        <div className="font-inter">
          <h4 className="font-semibold text-body-lg">Order Cancelled</h4>
          <p className="text-body-sm opacity-90">
            This order has been cancelled by the staff.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-md py-md">
      {steps.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isActive = index === currentIndex;
        const isPending = index > currentIndex;

        return (
          <div key={step.label} className="flex items-start gap-md relative">
            {/* Step Node */}
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                  isActive
                    ? "bg-primary text-on-primary border-primary scale-110 shadow-[0px_4px_12px_rgba(81,96,79,0.3)]"
                    : isCompleted
                    ? "bg-primary/20 text-primary border-primary"
                    : "bg-surface-container-low text-on-surface-variant/40 border-surface-container"
                }`}
              >
                <span className="material-symbols-outlined text-[20px] select-none">
                  {step.icon}
                </span>
              </div>
              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={`w-[2px] h-12 my-xs transition-colors duration-300 ${
                    isCompleted ? "bg-primary" : "bg-surface-container"
                  }`}
                />
              )}
            </div>

            {/* Step Label */}
            <div className="pt-2">
              <h4
                className={`font-inter font-semibold text-body-lg transition-colors ${
                  isActive
                    ? "text-primary"
                    : isPending
                    ? "text-on-surface-variant/40"
                    : "text-on-surface"
                }`}
              >
                {step.label}
              </h4>
              <p className="font-inter text-body-sm text-on-surface-variant/60">
                {isActive
                  ? "Current Status"
                  : isCompleted
                  ? "Completed"
                  : "Upcoming Step"}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};
export default OrderStatusTracker;
