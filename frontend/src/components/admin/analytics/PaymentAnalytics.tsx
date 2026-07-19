"use client";

import React, { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { getPaymentAnalytics } from "@/actions/analytics";
import { PaymentAnalyticsData } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
];

const COLORS = {
  online: "#1565c0",
  counter: "#e65100",
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-container-lowest rounded-lg shadow-lg border border-surface-container p-sm font-inter">
      <p className="text-body-sm font-semibold text-on-surface">
        {payload[0].name}
      </p>
      <p className="text-label-sm text-on-surface-variant">
        {payload[0].value} payments ({payload[0].payload.percent}%)
      </p>
    </div>
  );
};

export const PaymentAnalytics: React.FC = () => {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState<PaymentAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getPaymentAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch payments:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  const total = (data?.onlineCount ?? 0) + (data?.counterCount ?? 0);

  const pieData = data
    ? [
        {
          name: "Online",
          value: data.onlineCount,
          percent: data.onlinePercent,
        },
        {
          name: "Counter",
          value: data.counterCount,
          percent: data.counterPercent,
        },
      ]
    : [];

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-sm">
        {/* Donut Chart */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
            Payment Method Split
          </h3>

          {isLoading ? (
            <div className="h-[200px] flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : total > 0 ? (
            <div className="flex items-center gap-md">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    <Cell fill={COLORS.online} />
                    <Cell fill={COLORS.counter} />
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-sm">
                <div className="flex items-center gap-xs">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS.online }}
                  />
                  <div>
                    <p className="font-inter font-semibold text-body-sm text-on-surface">
                      Online
                    </p>
                    <p className="font-inter text-label-sm text-on-surface-variant">
                      {data?.onlineCount ?? 0} ({data?.onlinePercent ?? 0}%)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-xs">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS.counter }}
                  />
                  <div>
                    <p className="font-inter font-semibold text-body-sm text-on-surface">
                      Counter
                    </p>
                    <p className="font-inter text-label-sm text-on-surface-variant">
                      {data?.counterCount ?? 0} ({data?.counterPercent ?? 0}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center">
              <p className="font-inter text-body-sm text-on-surface-variant">
                No payment data for this period
              </p>
            </div>
          )}
        </div>

        {/* Revenue & Avg Ticket */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
            Revenue by Method
          </h3>

          {isLoading ? (
            <div className="space-y-md animate-pulse">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="w-28 h-4 rounded bg-surface-container" />
                  <div className="w-20 h-4 rounded bg-surface-container" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-sm">
              {/* Online */}
              <div className="p-sm rounded-lg border-l-4" style={{ borderColor: COLORS.online, backgroundColor: "#e3f2fd" }}>
                <div className="flex items-center justify-between mb-xs">
                  <span className="font-inter font-semibold text-body-sm" style={{ color: COLORS.online }}>
                    Online Payments
                  </span>
                  <span className="font-inter font-bold text-body-md" style={{ color: COLORS.online }}>
                    {formatCurrency(data?.onlineRevenue ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Avg Ticket
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {formatCurrency(data?.avgOnlineTicket ?? 0)}
                  </span>
                </div>
              </div>

              {/* Counter */}
              <div className="p-sm rounded-lg border-l-4" style={{ borderColor: COLORS.counter, backgroundColor: "#fff3e0" }}>
                <div className="flex items-center justify-between mb-xs">
                  <span className="font-inter font-semibold text-body-sm" style={{ color: COLORS.counter }}>
                    Counter Payments
                  </span>
                  <span className="font-inter font-bold text-body-md" style={{ color: COLORS.counter }}>
                    {formatCurrency(data?.counterRevenue ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    Avg Ticket
                  </span>
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    {formatCurrency(data?.avgCounterTicket ?? 0)}
                  </span>
                </div>
              </div>

              {/* Total */}
              <div className="pt-sm border-t border-surface-container">
                <div className="flex items-center justify-between">
                  <span className="font-inter font-semibold text-body-sm text-on-surface">
                    Total
                  </span>
                  <span className="font-inter font-bold text-body-lg text-on-surface">
                    {formatCurrency(
                      (data?.onlineRevenue ?? 0) + (data?.counterRevenue ?? 0)
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Insight */}
      {!isLoading && total > 0 && data && (
        <div className="flex items-start gap-xs p-sm bg-surface-container rounded-lg">
          <span className="material-symbols-outlined text-[18px] text-on-surface-variant mt-[1px]">
            lightbulb
          </span>
          <p className="font-inter text-label-sm text-on-surface-variant">
            {data.onlinePercent > data.counterPercent
              ? `${data.onlinePercent}% of customers prefer online payments. Consider promoting online-first offers to increase digital adoption.`
              : `${data.counterPercent}% of customers pay at the counter. Consider adding UPI QR codes at tables to boost online payments.`}
          </p>
        </div>
      )}
    </div>
  );
};
