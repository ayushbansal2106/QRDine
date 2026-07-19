"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { getRevenueAnalytics } from "@/actions/analytics";
import { RevenueAnalytics, PeakDay } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "7 Days", value: "week" },
  { label: "30 Days", value: "month" },
  { label: "90 Days", value: "90days" },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest rounded-lg shadow-lg border border-surface-container p-sm font-inter">
      <p className="text-label-sm text-on-surface-variant mb-xs">{label}</p>
      <p className="text-body-md font-bold text-on-surface">
        {formatCurrency(payload[0].value)}
      </p>
      {payload[0].payload.orders > 0 && (
        <p className="text-label-sm text-on-surface-variant">
          {payload[0].payload.orders} orders
        </p>
      )}
    </div>
  );
};

export const RevenueChart: React.FC = () => {
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState<RevenueAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getRevenueAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch revenue:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  const chartData =
    data?.dailyData.map((d) => ({
      ...d,
      name: new Date(d.date).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
    })) || [];

  const isGrowthPositive = (data?.growthPercent ?? 0) >= 0;

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

      {/* Growth Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-sm">
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <p className="font-inter text-label-sm text-on-surface-variant mb-xs">
            Current Period
          </p>
          <p className="font-inter font-bold text-headline-sm text-on-surface">
            {isLoading ? "—" : formatCurrency(data?.currentRevenue ?? 0)}
          </p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <p className="font-inter text-label-sm text-on-surface-variant mb-xs">
            Previous Period
          </p>
          <p className="font-inter font-bold text-headline-sm text-on-surface">
            {isLoading ? "—" : formatCurrency(data?.previousRevenue ?? 0)}
          </p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <p className="font-inter text-label-sm text-on-surface-variant mb-xs">
            Growth
          </p>
          <div className="flex items-center gap-xs">
            <p
              className={`font-inter font-bold text-headline-sm ${
                isGrowthPositive ? "text-[#2e7d32]" : "text-[#c62828]"
              }`}
            >
              {isLoading
                ? "—"
                : `${isGrowthPositive ? "+" : ""}${data?.growthPercent ?? 0}%`}
            </p>
            {!isLoading && (
              <span
                className={`material-symbols-outlined text-[20px] ${
                  isGrowthPositive ? "text-[#2e7d32]" : "text-[#c62828]"
                }`}
              >
                {isGrowthPositive ? "trending_up" : "trending_down"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
        <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-md">
          Daily Revenue
        </h3>
        {isLoading ? (
          <div className="h-[300px] flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center">
            <p className="font-inter text-body-sm text-on-surface-variant">
              No revenue data for this period
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e0e0e0"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fontFamily: "Inter", fill: "#444842" }}
                axisLine={{ stroke: "#e0e0e0" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fontFamily: "Inter", fill: "#444842" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) =>
                  v >= 1000 ? `₹${(v / 1000).toFixed(0)}k` : `₹${v}`
                }
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(81, 96, 79, 0.06)" }} />
              <Bar
                dataKey="revenue"
                fill="#51604f"
                radius={[6, 6, 0, 0]}
                maxBarSize={48}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Peak Days */}
      {data?.peakDays && data.peakDays.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
            Peak Days
          </h3>
          <div className="space-y-xs">
            {data.peakDays.map((day: PeakDay, idx: number) => {
              const maxRevenue = data.peakDays[0]?.totalRevenue || 1;
              const widthPercent = (day.totalRevenue / maxRevenue) * 100;
              return (
                <div key={day.day} className="flex items-center gap-sm">
                  <span className="font-inter text-body-sm text-on-surface-variant w-24 shrink-0">
                    {day.day}
                  </span>
                  <div className="flex-1 h-7 bg-surface-container rounded-md overflow-hidden relative">
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: `${widthPercent}%`,
                        backgroundColor:
                          idx === 0 ? "#51604f" : "#51604f88",
                      }}
                    />
                  </div>
                  <span className="font-inter font-semibold text-body-sm text-on-surface w-24 text-right shrink-0">
                    {formatCurrency(day.totalRevenue)}
                  </span>
                  {idx === 0 && (
                    <span className="text-[14px]" title="Peak day">🏆</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
