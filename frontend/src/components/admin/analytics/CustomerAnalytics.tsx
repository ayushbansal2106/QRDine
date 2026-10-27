"use client";

import React, { useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { getCustomerAnalytics } from "@/actions/analytics";
import { CustomerAnalyticsData, TopCustomer } from "@/types";
import { formatCurrency } from "@/utils/currency";

const periods = [
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "90 Days", value: "90days" },
];

const CHART_COLORS = ["#51604f", "#8a9f87"];

/**
 * Passed as `content={<CustomPieTooltip />}`, so Recharts clones the element and
 * injects the tooltip props; the component declares the subset it reads.
 */
interface PieTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{
    name?: string | number;
    value?: number | string;
    payload?: unknown;
  }>;
}

const CustomPieTooltip = ({ active, payload }: PieTooltipProps) => {
  if (!active || !payload?.length) return null;
  const first = payload[0];
  const value = Number(first?.value ?? 0);
  // The slice's own row carries `total`, which is the denominator for the
  // share-of-total line below.
  const row = first?.payload as { total?: number } | undefined;
  return (
    <div className="bg-surface-container-lowest rounded-lg shadow-lg border border-surface-container p-sm font-inter">
      <p className="text-body-sm font-semibold text-on-surface">
        {first?.name}: {value}
      </p>
      <p className="text-label-sm text-on-surface-variant">
        {((value / (Number(row?.total ?? 0) || 1)) * 100).toFixed(1)}%
      </p>
    </div>
  );
};

export const CustomerAnalytics: React.FC = () => {
  const [period, setPeriod] = useState("month");
  const [data, setData] = useState<CustomerAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getCustomerAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch customers:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [period]);

  const pieData = data
    ? [
        {
          name: "New",
          value: data.newCustomers,
          total: data.totalCustomers,
        },
        {
          name: "Returning",
          value: data.returningCustomers,
          total: data.totalCustomers,
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

      {/* Ratio Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-sm">
        {/* Donut Chart */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
            Customer Distribution
          </h3>
          {isLoading ? (
            <div className="h-[200px] flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : data && data.totalCustomers > 0 ? (
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
                    {pieData.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomPieTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-sm">
                <div className="flex items-center gap-xs">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[0] }}
                  />
                  <div>
                    <p className="font-inter font-semibold text-body-sm text-on-surface">
                      New Customers
                    </p>
                    <p className="font-inter text-label-sm text-on-surface-variant">
                      {data.newCustomers} ({data.newPercent}%)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-xs">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[1] }}
                  />
                  <div>
                    <p className="font-inter font-semibold text-body-sm text-on-surface">
                      Returning
                    </p>
                    <p className="font-inter text-label-sm text-on-surface-variant">
                      {data.returningCustomers} ({data.returningPercent}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center">
              <p className="font-inter text-body-sm text-on-surface-variant">
                No customer data for this period
              </p>
            </div>
          )}
        </div>

        {/* Summary Stats */}
        <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
            Summary
          </h3>
          {isLoading ? (
            <div className="space-y-sm animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex justify-between">
                  <div className="w-24 h-4 rounded bg-surface-container" />
                  <div className="w-12 h-4 rounded bg-surface-container" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-sm">
              <div className="flex items-center justify-between py-xs border-b border-surface-container">
                <span className="font-inter text-body-sm text-on-surface-variant">
                  Total Unique Customers
                </span>
                <span className="font-inter font-bold text-body-md text-on-surface">
                  {data?.totalCustomers ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between py-xs border-b border-surface-container">
                <span className="font-inter text-body-sm text-on-surface-variant">
                  Return Rate
                </span>
                <span className="font-inter font-bold text-body-md text-on-surface">
                  {data?.returningPercent ?? 0}%
                </span>
              </div>
              <div className="flex items-center justify-between py-xs">
                <span className="font-inter text-body-sm text-on-surface-variant">
                  New Customer Rate
                </span>
                <span className="font-inter font-bold text-body-md text-on-surface">
                  {data?.newPercent ?? 0}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Customers */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
        <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">
          Top Customers
        </h3>

        {isLoading ? (
          <div className="space-y-sm animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-sm">
                <div className="w-8 h-8 rounded-full bg-surface-container" />
                <div className="flex-1">
                  <div className="w-40 h-4 rounded bg-surface-container mb-xs" />
                  <div className="w-24 h-3 rounded bg-surface-container" />
                </div>
              </div>
            ))}
          </div>
        ) : data?.topCustomers && data.topCustomers.length > 0 ? (
          <div className="space-y-xs">
            {data.topCustomers.map((customer: TopCustomer) => (
              <div
                key={customer.email}
                className="flex items-center gap-sm py-sm px-xs rounded-lg hover:bg-surface-container-low/50 transition-colors"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="font-inter font-bold text-label-sm text-primary">
                    {customer.name.charAt(0).toUpperCase()}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-xs">
                    <p className="font-inter font-semibold text-body-sm text-on-surface truncate">
                      {customer.name}
                    </p>
                    {customer.isReturning && (
                      <span className="font-inter text-[10px] font-bold text-success bg-success-container px-xs py-[1px] rounded-full">
                        Returning
                      </span>
                    )}
                  </div>
                  <p className="font-inter text-label-sm text-on-surface-variant truncate">
                    {customer.email}
                  </p>
                </div>

                {/* Stats */}
                <div className="text-right shrink-0">
                  <p className="font-inter font-bold text-body-sm text-on-surface">
                    {formatCurrency(customer.totalRevenue)}
                  </p>
                  <p className="font-inter text-label-sm text-on-surface-variant">
                    {customer.visits} visit{customer.visits !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="font-inter text-body-sm text-on-surface-variant text-center py-md">
            No customer data for this period
          </p>
        )}
      </div>
    </div>
  );
};
