"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useEffect, useRef } from "react";
import { getAnalyticsOverview } from "@/actions/analytics";
import { AnalyticsOverview } from "@/types";
import { formatCurrency } from "@/utils/currency";

// Animated counter hook
function useAnimatedCounter(target: number, duration: number = 1200) {
  const [count, setCount] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;

    const start = 0;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(start + (target - start) * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setCount(target);
      }
    };

    requestAnimationFrame(animate);
  }, [target, duration]);

  return count;
}

interface KPICardProps {
  label: string;
  value: string;
  icon: string;
  change?: number;
  subtitle?: string;
  accentColor: string;
}

const KPICard: React.FC<KPICardProps> = ({
  label,
  value,
  icon,
  change,
  subtitle,
  accentColor,
}) => {
  const isPositive = change !== undefined && change >= 0;
  const showChange = change !== undefined && change !== 0;

  return (
    <div className="relative bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container overflow-hidden group hover:shadow-[0px_8px_30px_rgba(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-0.5">
      {/* Accent gradient border top */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl"
        style={{
          background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)`,
        }}
      />

      <div className="flex items-start justify-between mb-sm">
        <div className="flex items-center gap-xs">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15` }}
          >
            <span
              className="material-symbols-outlined text-[20px]"
              style={{ color: accentColor }}
            >
              {icon}
            </span>
          </div>
          <span className="font-inter text-label-sm text-on-surface-variant">
            {label}
          </span>
        </div>

        {showChange && (
          <div
            className={`flex items-center gap-[2px] px-xs py-[2px] rounded-full text-[11px] font-inter font-bold ${
              isPositive
                ? "bg-success-container text-success"
                : "bg-error-container text-on-error-container"
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {isPositive ? "trending_up" : "trending_down"}
            </span>
            {isPositive ? "+" : ""}
            {change}%
          </div>
        )}
      </div>

      <div className="font-inter font-bold text-headline-sm text-on-surface">
        {value}
      </div>

      {subtitle && (
        <div className="font-inter text-label-sm text-on-surface-variant mt-xs">
          {subtitle}
        </div>
      )}
    </div>
  );
};

// Shimmer skeleton for loading state
const SkeletonCard: React.FC = () => (
  <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container overflow-hidden animate-pulse">
    <div className="flex items-center gap-xs mb-sm">
      <div className="w-9 h-9 rounded-lg bg-surface-container" />
      <div className="w-20 h-3 rounded bg-surface-container" />
    </div>
    <div className="w-28 h-6 rounded bg-surface-container mb-xs" />
    <div className="w-16 h-3 rounded bg-surface-container" />
  </div>
);

export const OverviewCards: React.FC = () => {
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await getAnalyticsOverview();
        setData(result.overview);
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to load analytics."));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const animatedRevenue = useAnimatedCounter(data?.revenueToday ?? 0);
  const animatedOrders = useAnimatedCounter(data?.ordersToday ?? 0, 800);
  const animatedAvg = useAnimatedCounter(data?.avgOrderValue ?? 0);
  const animatedSessions = useAnimatedCounter(data?.sessionsToday ?? 0, 800);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-xl text-center">
        <span className="material-symbols-outlined text-[48px] text-error/40 mb-sm">
          error
        </span>
        <p className="font-inter text-body-md text-on-surface-variant">
          Failed to load analytics: {error}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const kpis: KPICardProps[] = [
    {
      label: "Revenue Today",
      value: formatCurrency(animatedRevenue),
      icon: "payments",
      change: data.revenueChange,
      subtitle: "vs yesterday",
      accentColor: "#2e7d32",
    },
    {
      label: "Orders Today",
      value: String(Math.round(animatedOrders)),
      icon: "receipt_long",
      change: data.orderChange,
      subtitle: "vs yesterday",
      accentColor: "#1565c0",
    },
    {
      label: "Avg Order Value",
      value: formatCurrency(animatedAvg),
      icon: "trending_up",
      subtitle: "Revenue ÷ Orders",
      accentColor: "#6a1b9a",
    },
    {
      label: "Active Tables",
      value: `${data.activeTables} / ${data.totalTables}`,
      icon: "table_restaurant",
      subtitle: "Currently occupied",
      accentColor: "#e65100",
    },
    {
      label: "Table Turnover",
      value: `${data.tableTurnover}×`,
      icon: "autorenew",
      subtitle: "Sessions ÷ Tables today",
      accentColor: "#00838f",
    },
    {
      label: "Sessions Today",
      value: String(Math.round(animatedSessions)),
      icon: "groups",
      subtitle: "Dining sessions started",
      accentColor: "#4e342e",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-sm">
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
};
