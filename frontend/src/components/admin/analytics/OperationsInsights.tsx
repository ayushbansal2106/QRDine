"use client";

import React, { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getOutletConsolidation, getPeakHours, getTurnover } from "@/actions/analytics";
import { formatCurrency } from "@/utils/currency";
import type { OutletConsolidation, PeakHoursData, TurnoverData } from "@/types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Module #01 — peak hours, floor turnover and multi-outlet comparison.
 * Everything here is derived from orders and sessions, so the numbers match the
 * bills screen rather than a separate reporting model.
 */
export const OperationsInsights: React.FC = () => {
  const [peak, setPeak] = useState<PeakHoursData | null>(null);
  const [turnover, setTurnover] = useState<TurnoverData | null>(null);
  const [outlets, setOutlets] = useState<OutletConsolidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [peakRes, turnoverRes, outletRes] = await Promise.all([
        getPeakHours(days),
        getTurnover(1),
        getOutletConsolidation(days),
      ]);
      if (cancelled) return;
      if (peakRes.success && peakRes.peakHours) setPeak(peakRes.peakHours);
      if (turnoverRes.success && turnoverRes.turnover) setTurnover(turnoverRes.turnover);
      if (outletRes.success && outletRes.outlets) setOutlets(outletRes.outlets);
      const failure = [!peakRes.success && peakRes.message, !turnoverRes.success && turnoverRes.message]
        .filter(Boolean)
        .join(" ");
      setError(failure || null);
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const hourly = peak?.hourly.filter((h) => h.orderCount > 0 || h.hour >= 6) ?? [];
  const maxHeat = peak ? Math.max(1, ...peak.heatmap.flat()) : 1;

  return (
    <section className="flex flex-col gap-lg">
      {error && <div className="bg-error/10 text-error rounded-xl p-md text-body-md">{error}</div>}

      <div className="flex items-center gap-sm">
        <span className="material-symbols-outlined text-primary text-[28px]">query_stats</span>
        <h2 className="text-title-lg font-inter font-semibold text-on-surface">Operating rhythm</h2>
        <div className="ml-auto flex gap-xs">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded-full px-md py-xs text-body-sm font-semibold ${
                days === d ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
        <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md">
          <p className="text-label-md text-on-surface-variant mb-sm">
            Orders and revenue by hour {peak?.peakHour !== null && peak?.peakHour !== undefined
              ? `· peak ${peak.peakHour}:00 (${peak.peakOrderCount} orders)`
              : ""}
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-container)" />
              <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} yAxisId="orders" width={32} />
              <YAxis tick={{ fontSize: 11 }} yAxisId="revenue" orientation="right" width={56} />
              <Tooltip
                formatter={(value, name) =>
                  name === "paidRevenue" ? formatCurrency(Number(value)) : value
                }
                labelFormatter={(label) => `${label}:00`}
              />
              <Bar yAxisId="orders" dataKey="orderCount" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="revenue" dataKey="paidRevenue" fill="var(--color-secondary)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md">
          <p className="text-label-md text-on-surface-variant mb-sm">Demand heatmap (day × hour)</p>
          {peak ? (
            <div className="overflow-x-auto">
              <table className="text-label-sm border-separate" style={{ borderSpacing: "2px" }}>
                <thead>
                  <tr>
                    <th />
                    {Array.from({ length: 24 }, (_, h) => (
                      <th key={h} className="font-mono text-on-surface-variant">
                        {h % 3 === 0 ? h : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {peak.heatmap.map((row, dayIndex) => (
                    <tr key={dayIndex}>
                      <td className="text-on-surface-variant pr-xs">{DAY_LABELS[dayIndex]}</td>
                      {row.map((count, hour) => (
                        <td key={hour}>
                          <span
                            title={`${DAY_LABELS[dayIndex]} ${hour}:00 — ${count} orders`}
                            className="block w-4 h-4 rounded-sm"
                            style={{
                              backgroundColor:
                                count === 0
                                  ? "var(--color-surface-container)"
                                  : `color-mix(in srgb, var(--color-primary) ${
                                      20 + (count / maxHeat) * 80
                                    }%, var(--color-surface-container))`,
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-body-md text-on-surface-variant">Not enough data yet.</p>
          )}
        </div>
      </div>

      {turnover && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
          {[
            { label: "Active tables", value: turnover.activeTables, icon: "table_restaurant" },
            { label: "Sessions today", value: turnover.totalSessions, icon: "groups" },
            { label: "Avg dwell", value: `${turnover.avgSessionMinutes} min`, icon: "timer" },
            { label: "Sessions / table", value: turnover.avgSessionsPerTable, icon: "repeat" },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md"
            >
              <span className="material-symbols-outlined text-[26px] text-primary">{card.icon}</span>
              <div className="flex flex-col">
                <span className="text-body-sm text-on-surface-variant">{card.label}</span>
                <span className="text-body-lg font-bold text-on-surface font-mono">{card.value}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {outlets && (
        <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md">
          <div className="flex items-center gap-sm mb-md">
            <span className="material-symbols-outlined text-primary text-[22px]">storefront</span>
            <h3 className="text-title-md font-inter font-semibold text-on-surface">Outlet comparison</h3>
            {outlets.scope === "group" ? (
              <span className="text-body-sm text-on-surface-variant">
                group &ldquo;{outlets.outletGroup}&rdquo;
                {outlets.excludedCount
                  ? ` · ${outlets.excludedCount} outlet(s) hidden (no access)`
                  : ""}
              </span>
            ) : (
              <span className="text-body-sm text-on-surface-variant">
                single outlet{outlets.reason === "no_outlet_group_configured"
                  ? " — set an outlet group in Settings to compare branches"
                  : ""}
              </span>
            )}
          </div>

          {outlets.totals && outlets.totals.outlets.length > 0 ? (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-md mb-md">
                <div className="flex flex-col">
                  <span className="text-body-sm text-on-surface-variant">Group revenue</span>
                  <span className="text-headline-md font-bold font-mono">
                    {formatCurrency(outlets.totals.totals.revenue)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-body-sm text-on-surface-variant">Orders</span>
                  <span className="text-headline-md font-bold font-mono">
                    {outlets.totals.totals.orderCount}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-body-sm text-on-surface-variant">Avg ticket</span>
                  <span className="text-headline-md font-bold font-mono">
                    {formatCurrency(outlets.totals.totals.avgTicket)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-body-sm text-on-surface-variant">Best outlet</span>
                  <span className="text-headline-md font-bold">
                    {outlets.totals.totals.bestOutlet ?? "—"}
                  </span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={outlets.totals.outlets.map((o) => ({
                    name: o.outletLabel,
                    revenue: o.revenue,
                    orders: o.orderCount,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-container)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                    {outlets.totals.outlets.map((o, i) => (
                      <Cell key={o.cafeId} fill={i === 0 ? "var(--color-primary)" : "var(--color-secondary)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="text-body-md text-on-surface-variant">No outlet data for this window.</p>
          )}
        </div>
      )}
    </section>
  );
};