"use client";

import React, { useState, useEffect } from "react";
import { getItemsAnalytics } from "@/actions/analytics";
import { ItemsAnalyticsData, ItemStat } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "90 Days", value: "90days" },
];

type ViewMode = "quantity" | "revenue" | "worst";

const viewModes = [
  { id: "quantity" as ViewMode, label: "Most Ordered", icon: "shopping_cart" },
  { id: "revenue" as ViewMode, label: "Top Revenue", icon: "payments" },
  { id: "worst" as ViewMode, label: "Worst Performers", icon: "warning" },
];

const RankedItem: React.FC<{
  item: ItemStat;
  rank: number;
  maxValue: number;
  metric: "quantity" | "revenue";
  isWorst?: boolean;
}> = ({ item, rank, maxValue, metric, isWorst = false }) => {
  const value = metric === "quantity" ? item.quantity : item.revenue;
  const widthPercent = maxValue > 0 ? (value / maxValue) * 100 : 0;

  const medalColors: Record<number, string> = {
    1: "#FFD700",
    2: "#C0C0C0",
    3: "#CD7F32",
  };

  return (
    <div className="flex items-center gap-sm py-xs group hover:bg-surface-container-low/50 rounded-lg px-xs transition-colors">
      {/* Rank */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-inter font-bold text-label-sm"
        style={{
          backgroundColor: isWorst
            ? "#ffebee"
            : medalColors[rank]
              ? `${medalColors[rank]}30`
              : "#f5f5f5",
          color: isWorst
            ? "#c62828"
            : medalColors[rank]
              ? "#424242"
              : "#757575",
        }}
      >
        {rank}
      </div>

      {/* Item Name */}
      <div className="flex-1 min-w-0">
        <p className="font-inter font-semibold text-body-sm text-on-surface truncate">
          {item.itemName}
        </p>
        <div className="flex items-center gap-sm mt-[2px]">
          {/* Progress bar */}
          <div className="flex-1 h-[6px] bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${widthPercent}%`,
                backgroundColor: isWorst ? "#ef5350" : "#51604f",
              }}
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="text-right shrink-0">
        <p className="font-inter font-bold text-body-sm text-on-surface">
          {metric === "quantity" ? `${item.quantity} sold` : formatCurrency(item.revenue)}
        </p>
        <p className="font-inter text-label-sm text-on-surface-variant">
          {metric === "quantity" ? formatCurrency(item.revenue) : `${item.quantity} sold`}
        </p>
      </div>
    </div>
  );
};

export const ItemsAnalytics: React.FC = () => {
  const [period, setPeriod] = useState("month");
  const [viewMode, setViewMode] = useState<ViewMode>("quantity");
  const [data, setData] = useState<ItemsAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getItemsAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch items:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  const getItems = (): ItemStat[] => {
    if (!data) return [];
    switch (viewMode) {
      case "quantity":
        return data.bestByQuantity;
      case "revenue":
        return data.bestByRevenue;
      case "worst":
        return data.worstPerformers;
    }
  };

  const items = getItems();
  const metric = viewMode === "revenue" ? "revenue" : "quantity";
  const maxValue =
    items.length > 0
      ? Math.max(...items.map((i) => (metric === "quantity" ? i.quantity : i.revenue)))
      : 1;

  return (
    <div className="space-y-md">
      {/* Period Selector */}
      <div className="flex gap-xs">
        {periods.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-md py-sm rounded-full text-body-sm font-inter font-semibold whitespace-nowrap cursor-pointer transition-colors ${
              period === p.value
                ? "bg-primary text-on-primary"
                : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* View Mode Tabs */}
      <div className="flex gap-xs bg-surface-container rounded-lg p-xs">
        {viewModes.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setViewMode(mode.id)}
            className={`flex items-center gap-xs px-md py-sm rounded-md text-body-sm font-inter font-semibold cursor-pointer transition-all ${
              viewMode === mode.id
                ? "bg-surface-container-lowest text-on-surface shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">
              {mode.icon}
            </span>
            {mode.label}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
        {isLoading ? (
          <div className="space-y-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-sm animate-pulse">
                <div className="w-7 h-7 rounded-full bg-surface-container" />
                <div className="flex-1">
                  <div className="w-32 h-4 rounded bg-surface-container mb-xs" />
                  <div className="w-full h-[6px] rounded bg-surface-container" />
                </div>
                <div className="w-20 h-4 rounded bg-surface-container" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-lg text-center">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
              restaurant_menu
            </span>
            <p className="font-inter text-body-sm text-on-surface-variant">
              No item data for this period
            </p>
          </div>
        ) : (
          <div className="space-y-xs">
            {items.map((item, idx) => (
              <RankedItem
                key={item.menuItemId}
                item={item}
                rank={idx + 1}
                maxValue={maxValue}
                metric={metric}
                isWorst={viewMode === "worst"}
              />
            ))}
          </div>
        )}

        {/* Summary */}
        {data && !isLoading && (
          <div className="mt-md pt-sm border-t border-surface-container">
            <p className="font-inter text-label-sm text-on-surface-variant">
              {data.totalItems} unique items tracked in this period
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
