"use client";

import React, { useState, useEffect } from "react";
import { getTableAnalytics } from "@/actions/analytics";
import { TableAnalyticsData, TableStat } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "90 Days", value: "90days" },
];

export const TableAnalytics: React.FC = () => {
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<TableAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getTableAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch table analytics:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  const tables = data?.tables || [];
  const topTable = tables.length > 0 ? tables[0] : null;
  const leastUsedTable =
    tables.length > 0
      ? [...tables].sort((a, b) => a.orderCount - b.orderCount)[0]
      : null;

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  };

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

      {/* Highlights */}
      {!isLoading && topTable && leastUsedTable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-sm">
          <div className="bg-[#e8f5e9] border-2 border-[#66bb6a] rounded-xl p-md">
            <div className="flex items-center gap-xs mb-xs">
              <span className="text-[18px]">🏆</span>
              <span className="font-inter font-semibold text-body-sm text-[#2e7d32]">
                Most Profitable
              </span>
            </div>
            <p className="font-inter font-bold text-headline-sm text-[#1b5e20]">
              Table {topTable.tableNumber}
            </p>
            <p className="font-inter text-label-sm text-[#2e7d32]">
              {formatCurrency(topTable.revenue)} · {topTable.orderCount} orders
            </p>
          </div>
          <div className="bg-[#fff8e1] border-2 border-[#ffca28] rounded-xl p-md">
            <div className="flex items-center gap-xs mb-xs">
              <span className="text-[18px]">⚠️</span>
              <span className="font-inter font-semibold text-body-sm text-[#f57f17]">
                Least Used
              </span>
            </div>
            <p className="font-inter font-bold text-headline-sm text-[#e65100]">
              Table {leastUsedTable.tableNumber}
            </p>
            <p className="font-inter text-label-sm text-[#f57f17]">
              {formatCurrency(leastUsedTable.revenue)} ·{" "}
              {leastUsedTable.orderCount} orders
            </p>
          </div>
        </div>
      )}

      {/* Table Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-container-lowest rounded-xl p-md border border-surface-container animate-pulse"
            >
              <div className="w-20 h-5 rounded bg-surface-container mb-sm" />
              <div className="space-y-xs">
                <div className="w-full h-4 rounded bg-surface-container" />
                <div className="w-3/4 h-4 rounded bg-surface-container" />
                <div className="w-1/2 h-4 rounded bg-surface-container" />
              </div>
            </div>
          ))}
        </div>
      ) : tables.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-xl text-center">
          <span className="material-symbols-outlined text-[48px] text-on-surface-variant/40 mb-sm">
            table_restaurant
          </span>
          <p className="font-inter text-body-sm text-on-surface-variant">
            No table data for this period
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
          {tables.map((table: TableStat) => (
            <div
              key={table.tableId}
              className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-0.5"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-sm">
                <h4 className="font-inter font-bold text-body-lg text-on-surface">
                  Table {table.tableNumber}
                </h4>
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    table.isOccupied ? "bg-[#2e7d32] animate-pulse" : "bg-surface-container-high"
                  }`}
                  title={table.isOccupied ? "Occupied" : "Free"}
                />
              </div>

              {/* Stats */}
              <div className="space-y-xs">
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Revenue
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {formatCurrency(table.revenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Orders
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {table.orderCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Sessions
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {table.sessionCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Avg Duration
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {formatDuration(table.avgSessionDuration)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Turnover
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {table.turnoverRate}×
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
