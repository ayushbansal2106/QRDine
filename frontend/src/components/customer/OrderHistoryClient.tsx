"use client";

import React, { useEffect, useState } from "react";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import {
  fetchMyOrders,
  type HistoryOrder,
  type OrderHistoryRange,
} from "@/actions/customerApp";
import { formatCurrency } from "@/utils/currency";
import { formatDateTime } from "@/lib/format";
import { useCartStore } from "@/store/cartStore";

const RANGES: { key: OrderHistoryRange; label: string }[] = [
  { key: "3m", label: "3 months" },
  { key: "6m", label: "6 months" },
  { key: "1y", label: "1 year" },
  { key: "all", label: "All" },
];

const OrderCard: React.FC<{ order: HistoryOrder }> = ({ order }) => (
  <div
    className={`rounded-2xl bg-surface-container-lowest border p-md ${
      order.isLive ? "border-primary/40 bg-primary/5" : "border-surface-container"
    }`}
  >
    <div className="flex items-start justify-between gap-sm">
      <div className="min-w-0">
        <p className="font-mono text-body-sm font-semibold text-on-surface">
          {order.orderNumber}
        </p>
        <p className="text-body-sm text-on-surface-variant">
          {formatDateTime(order.placedAt)}
          {order.tableNumber ? ` · Table ${order.tableNumber}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-xs">
        <span className="rounded-full bg-surface-container px-sm py-0.5 text-[11px] font-medium capitalize text-on-surface-variant">
          {order.status}
        </span>
        {order.isLive && (
          <a
            href={`/order/success/${order.id}`}
            className="text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
          >
            Track order
          </a>
        )}
      </div>
    </div>

    <ul className="mt-sm flex flex-col gap-1">
      {order.items.slice(0, 3).map((item, i) => (
        <li key={i} className="flex justify-between text-body-sm text-on-surface-variant">
          <span className="truncate">
            {item.name} ×{item.quantity}
          </span>
          <span className="font-mono">{formatCurrency(item.amount)}</span>
        </li>
      ))}
      {order.items.length > 3 && (
        <li className="text-body-sm text-on-surface-variant/70">
          +{order.items.length - 3} more
        </li>
      )}
    </ul>

    <div className="mt-sm flex items-center justify-between border-t border-dashed border-surface-container pt-sm">
      <span className="text-body-sm text-on-surface-variant">
        {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
      </span>
      {order.discountTotal > 0 ? (
        <span className="flex items-center gap-sm">
          <span className="text-body-sm text-success">
            −{formatCurrency(order.discountTotal)}
          </span>
          <span className="font-mono text-body-md font-semibold text-on-surface">
            {formatCurrency(order.totalAmount)}
          </span>
        </span>
      ) : (
        <span className="font-mono text-body-md font-semibold text-on-surface">
          {formatCurrency(order.totalAmount)}
        </span>
      )}
    </div>
  </div>
);

export const OrderHistoryClient: React.FC = () => {
  const tableId = useCartStore((s) => s.tableId);
  // Never fall back to `/`: that is the staff portal entry point.
  const backHref = tableId ? `/table/${tableId}` : "/welcome";

  const [range, setRange] = useState<OrderHistoryRange>("3m");
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  /** Still in front of the guest — an open table, not part of the spend record. */
  const [active, setActive] = useState<HistoryOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  // Which range the data on screen belongs to. Deriving `loading` from this
  // instead of setting a flag keeps the effect free of synchronous setState.
  const [loadedRange, setLoadedRange] = useState<OrderHistoryRange | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const loading = loadedRange !== range;

  useEffect(() => {
    let cancelled = false;

    fetchMyOrders({ range, page: 1, limit: 10 }).then((res) => {
      if (cancelled) return;
      setLoadedRange(range);
      if (!res.success) {
        setError(res.message || "Could not load your orders.");
        setOrders([]);
        setTotal(0);
        setHasMore(false);
        return;
      }
      setError("");
      setOrders(res.orders);
      setActive(res.active || []);
      setTotal(res.total);
      setPage(1);
      setHasMore(res.hasMore);
    });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const loadMore = async () => {
    setLoadingMore(true);
    const next = page + 1;
    const res = await fetchMyOrders({ range, page: next, limit: 10 });
    setLoadingMore(false);

    if (!res.success) {
      setError(res.message || "Could not load more orders.");
      return;
    }
    // Replace rather than append: if the window moves under us (a new order
    // lands) the server's first page is still the correct one to show.
    setOrders((prev) => [...prev, ...res.orders]);
    setPage(next);
    setHasMore(res.hasMore);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar title="Order history" showBack onBackHref={backHref} />

      <main className="flex-1 w-full max-w-[560px] mx-auto px-margin-mobile py-md">
        {/* Range filter — history is paged by time window rather than by
            scrolling an unbounded collection. */}
        <div className="mb-md flex gap-sm overflow-x-auto pb-1">
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              aria-pressed={range === option.key}
              className={`shrink-0 rounded-full px-md py-sm font-inter text-body-sm font-medium transition-colors ${
                range === option.key
                  ? "bg-primary text-on-primary"
                  : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {!loading && !error && active.length > 0 && (
          <section className="mb-md">
            <h2 className="mb-sm text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              In progress
            </h2>
            <div className="flex flex-col gap-sm">
              {active.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          </section>
        )}

        {!loading && !error && (
          <p className="mb-sm text-body-sm text-on-surface-variant">
            {total} past order{total === 1 ? "" : "s"}
          </p>
        )}

        {loading && (
          <p className="py-lg text-center text-body-md text-on-surface-variant">Loading…</p>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-error/10 p-md text-body-sm text-error">
            {error}
          </p>
        )}

        {!loading && !error && orders.length === 0 && active.length === 0 && (
          <div className="flex flex-col items-center gap-sm py-lg text-center">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/50">
              receipt_long
            </span>
            <p className="text-body-md text-on-surface">No orders in this period</p>
            <p className="text-body-sm text-on-surface-variant">
              Try a wider date range.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-sm">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>

        {hasMore && (
          <Button
            variant="secondary"
            fullWidth
            className="mt-md"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
      </main>
    </div>
  );
};