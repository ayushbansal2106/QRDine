"use client";

import React, { useState, useEffect } from "react";
import { getSessionAnalytics } from "@/actions/analytics";
import { SessionAnalyticsData } from "@/types";

const periods = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
];

const formatDuration = (minutes: number) => {
  if (minutes <= 0) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
};

const FunnelBar: React.FC<{
  label: string;
  value: number;
  maxValue: number;
  color: string;
  prevValue?: number;
}> = ({ label, value, maxValue, color, prevValue }) => {
  const widthPercent = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const dropOff =
    prevValue !== undefined && prevValue > 0
      ? (((prevValue - value) / prevValue) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-[4px]">
      <div className="flex items-center justify-between">
        <span className="font-inter text-body-sm text-on-surface">{label}</span>
        <div className="flex items-center gap-sm">
          <span className="font-inter font-bold text-body-sm text-on-surface">
            {value}
          </span>
          {dropOff && Number(dropOff) > 0 && (
            <span className="font-inter text-label-sm text-on-error-container bg-error-container px-xs py-[1px] rounded-full">
              −{dropOff}%
            </span>
          )}
        </div>
      </div>
      <div className="h-8 bg-surface-container rounded-lg overflow-hidden">
        <div
          className="h-full rounded-lg transition-all duration-700 flex items-center justify-end pr-xs"
          style={{ width: `${Math.max(widthPercent, 2)}%`, backgroundColor: color }}
        >
          {widthPercent > 15 && (
            <span className="font-inter text-[11px] font-bold text-white/90">
              {Math.round(widthPercent)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const SessionAnalytics: React.FC = () => {
  const [period, setPeriod] = useState("today");
  const [data, setData] = useState<SessionAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const result = await getSessionAnalytics(period);
        setData(result);
      } catch (err) {
        console.error("Failed to fetch sessions:", err);
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

      {/* Duration Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-sm">
        {[
          {
            label: "Avg Duration",
            value: isLoading ? "—" : formatDuration(data?.avgDuration ?? 0),
            icon: "avg_time",
            color: "#1565c0",
          },
          {
            label: "Longest Session",
            value: isLoading ? "—" : formatDuration(data?.longestSession ?? 0),
            icon: "hourglass_top",
            color: "#e65100",
          },
          {
            label: "Shortest Session",
            value: isLoading ? "—" : formatDuration(data?.shortestSession ?? 0),
            icon: "hourglass_bottom",
            color: "#2e7d32",
          },
          {
            label: "Total Sessions",
            value: isLoading ? "—" : String(data?.totalSessions ?? 0),
            icon: "groups",
            color: "#6a1b9a",
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container"
          >
            <div className="flex items-center gap-xs mb-xs">
              <span
                className="material-symbols-outlined text-[20px]"
                style={{ color: stat.color }}
              >
                {stat.icon}
              </span>
              <span className="font-inter text-label-sm text-on-surface-variant">
                {stat.label}
              </span>
            </div>
            <p className="font-inter font-bold text-headline-sm text-on-surface">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Conversion Funnel */}
      <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] border border-surface-container">
        <div className="flex items-center gap-xs mb-md">
          <span className="material-symbols-outlined text-[20px] text-primary">
            filter_alt
          </span>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface">
            Conversion Funnel
          </h3>
        </div>

        {isLoading ? (
          <div className="space-y-md animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <div className="w-32 h-4 rounded bg-surface-container mb-xs" />
                <div className="h-8 rounded bg-surface-container" />
              </div>
            ))}
          </div>
        ) : data?.funnel ? (
          <div className="space-y-sm">
            <FunnelBar
              label="Sessions Started"
              value={data.funnel.sessionsStarted}
              maxValue={data.funnel.sessionsStarted}
              color="#51604f"
            />
            <FunnelBar
              label="Orders Placed"
              value={data.funnel.ordersPlaced}
              maxValue={data.funnel.sessionsStarted}
              color="#6a7967"
              prevValue={data.funnel.sessionsStarted}
            />
            <FunnelBar
              label="Bills Requested"
              value={data.funnel.billsRequested}
              maxValue={data.funnel.sessionsStarted}
              color="#8a9f87"
              prevValue={data.funnel.ordersPlaced}
            />
            <FunnelBar
              label="Payments Completed"
              value={data.funnel.paymentsCompleted}
              maxValue={data.funnel.sessionsStarted}
              color="#2e7d32"
              prevValue={data.funnel.billsRequested}
            />
          </div>
        ) : (
          <p className="font-inter text-body-sm text-on-surface-variant text-center py-md">
            No session data for this period
          </p>
        )}

        {/* Conversion rate summary */}
        {data?.funnel && data.funnel.sessionsStarted > 0 && (
          <div className="mt-md pt-sm border-t border-surface-container flex items-center gap-xs">
            <span className="material-symbols-outlined text-[16px] text-success">
              check_circle
            </span>
            <p className="font-inter text-label-sm text-on-surface-variant">
              Overall conversion:{" "}
              <span className="font-bold text-on-surface">
                {(
                  (data.funnel.paymentsCompleted / data.funnel.sessionsStarted) *
                  100
                ).toFixed(1)}
                %
              </span>{" "}
              of sessions resulted in payment
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
