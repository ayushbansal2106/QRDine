"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getLiveTelemetry } from "@/actions/analytics";
import { useSocketStore } from "@/store/socketStore";
import { formatCurrency } from "@/utils/currency";
import { LOCALE } from "@/lib/format";
import type { LiveTelemetry as Telemetry } from "@/types";

interface Props {
  cafeId?: string;
}

interface Point {
  time: string;
  revenue: number;
  activeTickets: number;
}

const MAX_POINTS = 40;

const StatCard: React.FC<{ label: string; value: string; icon: string; accent?: string }> = ({
  label,
  value,
  icon,
  accent = "text-primary",
}) => (
  <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md">
    <span className={`material-symbols-outlined text-[28px] ${accent}`}>{icon}</span>
    <div className="flex flex-col">
      <span className="text-body-sm text-on-surface-variant">{label}</span>
      <span className="text-body-lg font-bold text-on-surface font-mono">{value}</span>
    </div>
  </div>
);

/**
 * Module #01 — live operations board.
 *
 * The board refreshes on the `metrics-updated` socket ping (throttled to 1/sec
 * server-side) and keeps a 30s poll as a backstop for dropped connections. The
 * chart is a rolling in-session window, not a time series from the database, so
 * it stays cheap enough to redraw on every event.
 */
export const LiveTelemetry: React.FC<Props> = ({ cafeId }) => {
  const [data, setData] = useState<Telemetry | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [series, setSeries] = useState<Point[]>([]);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);

  const { connect, joinRoom, socket } = useSocketStore();

  /** Pull the current counters and fold them into state.
   *
   * The `mounted` ref, not a `cancelled` local, is what guards the writes here:
   * this function is shared by the 30s poll, the coalesced socket ping, and the
   * "Refresh now" button, and only the effect can install a teardown. Without it
   * a poll that resolves after unmount sets state on a dead component.
   */
  const refresh = useCallback(async () => {
    const res = await getLiveTelemetry();
    if (!res.success || !("telemetry" in res)) return;
    const telemetry = res.telemetry as Telemetry;
    if (!mounted.current) return;
    setData(telemetry);
    setLastUpdated(new Date());
    setSeries((prev) => {
      const next = [
        ...prev,
        {
          time: new Date().toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          revenue: telemetry.grossRevenue,
          activeTickets: telemetry.activeTickets,
        },
      ];
      return next.slice(-MAX_POINTS);
    });
  }, []);

  useEffect(() => {
    // The board is a subscriber, not a mirror of its own effect: it registers
    // the poll and then steps out of the way. Calling `refresh` from the effect
    // body wrote state synchronously before the first `await`, which is the
    // cascading render `react-hooks/set-state-in-effect` rejects.
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 30000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  // Socket-driven refreshes, coalesced so a burst of orders triggers one fetch.
  useEffect(() => {
    connect();
    if (cafeId) joinRoom(`cafe-${cafeId}`);
  }, [cafeId, connect, joinRoom]);

  useEffect(() => {
    if (!socket) return;
    const handleMetrics = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        void refresh();
      }, 600);
    };
    socket.on("metrics-updated", handleMetrics);
    socket.on("new-order", handleMetrics);
    socket.on("session-paid", handleMetrics);
    return () => {
      socket.off("metrics-updated", handleMetrics);
      socket.off("new-order", handleMetrics);
      socket.off("session-paid", handleMetrics);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [socket, refresh]);

  const channelTotal = useMemo(() => {
    if (!data?.channelCounts) return [];
    return Object.entries(data.channelCounts).map(([channel, count]) => ({ channel, count }));
  }, [data]);

  if (!data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-surface-container animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-md mb-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-sm">
          <span className="material-symbols-outlined text-primary text-[28px]">sensors</span>
          <h2 className="text-title-lg font-inter font-semibold text-on-surface">Live operations</h2>
          {lastUpdated && (
            <span className="text-body-sm text-on-surface-variant">
              updated {lastUpdated.toLocaleTimeString(LOCALE)}
            </span>
          )}
        </div>
        <button
          onClick={() => {
            void refresh();
          }}
          className="text-body-sm text-primary font-semibold hover:underline"
        >
          Refresh now
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-md">
        <StatCard
          label="Revenue today"
          value={formatCurrency(data.grossRevenue)}
          icon="payments"
        />
        <StatCard
          label="Active tickets"
          value={String(data.activeTickets)}
          icon="pending_actions"
          accent="text-warning"
        />
        <StatCard
          label="Tables occupied"
          value={String(data.customerInflux)}
          icon="table_restaurant"
        />
        <StatCard
          label="Avg fulfilment"
          value={`${data.avgFulfillmentMinutes} min`}
          icon="timer"
          accent="text-secondary"
        />
        <StatCard
          label="Paid orders"
          value={String(data.paidOrderCount)}
          icon="task_alt"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-md">
        <div className="lg:col-span-2 bg-surface-container-lowest border border-surface-container rounded-xl p-md">
          <p className="text-label-md text-on-surface-variant mb-sm">
            Revenue and open tickets (this session)
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="liveRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-container)" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={56} />
              <Tooltip
                formatter={(value, name) =>
                  name === "revenue" ? formatCurrency(Number(value)) : value
                }
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="var(--color-primary)"
                fill="url(#liveRevenue)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="activeTickets"
                stroke="var(--color-secondary)"
                fill="transparent"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md">
          <p className="text-label-md text-on-surface-variant mb-sm">Orders by channel today</p>
          <ul className="flex flex-col gap-xs">
            {channelTotal.map(({ channel, count }) => (
              <li key={channel} className="flex items-center justify-between text-body-md">
                <span className="capitalize">{channel}</span>
                <span className="font-mono font-semibold">{count}</span>
              </li>
            ))}
            {channelTotal.length === 0 && (
              <li className="text-body-sm text-on-surface-variant">No orders yet today.</li>
            )}
          </ul>

          <p className="text-label-md text-on-surface-variant mt-md mb-sm">Live ticket states</p>
          <ul className="flex flex-col gap-xs">
            {Object.entries(data.statusCounts).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-body-md">
                <span className="capitalize">{status}</span>
                <span className="font-mono font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
};