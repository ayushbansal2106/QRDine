"use client";

import React, { useState, useEffect } from "react";
import { getGSTAnalytics } from "@/actions/analytics";
import { GSTAnalytics, GSTSlab } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
];

// Color mapping per GST slab
const slabColors: Record<number, { bg: string; text: string; border: string }> = {
  5: { bg: "#e8f5e9", text: "#2e7d32", border: "#66bb6a" },
  12: { bg: "#e3f2fd", text: "#1565c0", border: "#42a5f5" },
  18: { bg: "#f3e5f5", text: "#7b1fa2", border: "#ab47bc" },
  28: { bg: "#fce4ec", text: "#c62828", border: "#ef5350" },
};

const getSlabStyle = (pct: number) =>
  slabColors[pct] || { bg: "#f5f5f5", text: "#424242", border: "#bdbdbd" };

export const GSTBreakdown: React.FC = () => {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState<GSTAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getGSTAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch GST:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

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

      {/* Total GST Card */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
        <div className="flex items-center gap-xs mb-xs">
          <span className="material-symbols-outlined text-[20px] text-primary">
            account_balance
          </span>
          <span className="font-inter text-label-sm text-on-surface-variant">
            Total GST Collected
          </span>
        </div>
        <p className="font-inter font-bold text-headline-md text-on-surface">
          {isLoading ? "—" : formatCurrency(data?.totalGST ?? 0)}
        </p>
      </div>

      {/* GST Slab Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-sm">
          {[5, 12, 18, 28].map((pct) => (
            <div
              key={pct}
              className="rounded-xl p-md border animate-pulse bg-surface-container-lowest border-surface-container"
            >
              <div className="w-16 h-4 rounded bg-surface-container mb-sm" />
              <div className="w-24 h-6 rounded bg-surface-container" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-sm">
          {[5, 12, 18, 28].map((pct) => {
            const slab = data?.slabs.find((s: GSTSlab) => s.percentage === pct);
            const style = getSlabStyle(pct);
            const amount = slab?.amount ?? 0;
            const totalGST = data?.totalGST || 1;
            const percent =
              totalGST > 0 ? ((amount / totalGST) * 100).toFixed(1) : "0.0";

            return (
              <div
                key={pct}
                className="rounded-xl p-md border-2 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
                style={{
                  backgroundColor: style.bg,
                  borderColor: style.border,
                }}
              >
                <div className="flex items-center justify-between mb-sm">
                  <span
                    className="font-inter font-bold text-body-lg"
                    style={{ color: style.text }}
                  >
                    {pct}% GST
                  </span>
                  <span
                    className="font-inter text-label-sm font-semibold px-xs py-[1px] rounded-full"
                    style={{
                      color: style.text,
                      backgroundColor: `${style.border}30`,
                    }}
                  >
                    {percent}%
                  </span>
                </div>
                <p
                  className="font-inter font-bold text-headline-sm"
                  style={{ color: style.text }}
                >
                  {formatCurrency(amount)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Accounting Note */}
      <div className="flex items-start gap-xs p-sm bg-surface-container rounded-lg">
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-[1px]">
          info
        </span>
        <p className="font-inter text-label-sm text-on-surface-variant">
          GST breakdown can be shared with your CA or accountant for filing
          purposes. Use the Sales History export for detailed per-invoice data.
        </p>
      </div>
    </div>
  );
};
