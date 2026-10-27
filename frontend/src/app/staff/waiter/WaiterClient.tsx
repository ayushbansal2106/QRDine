"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import { WaiterMetrics, WaiterTable } from "@/types";
import { fetchPosCatalog } from "@/actions/pos";
import { createWaiterOrder, fetchWaiterMetrics, fetchWaiterTables } from "@/actions/waiter";

interface CatalogItem {
  _id: string;
  name: string;
  price: number;
  categoryId: string;
}

interface CartLine {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  seat: string;
}

const SEATS = ["", "1", "2", "3", "4", "5", "6"];

export const WaiterClient: React.FC = () => {
  const [tables, setTables] = useState<WaiterTable[]>([]);
  const [categories, setCategories] = useState<{ _id: string; name: string }[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [metrics, setMetrics] = useState<WaiterMetrics | null>(null);

  const [selectedTable, setSelectedTable] = useState<WaiterTable | null>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [seat, setSeat] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const [tablesRes, catalog, metricsRes] = await Promise.all([
        fetchWaiterTables(),
        fetchPosCatalog(),
        fetchWaiterMetrics(),
      ]);
      if (tablesRes.success) setTables(tablesRes.tables);
      if (catalog.success) {
        // The waiter handheld reads the same `/pos/catalog` endpoint as the till,
        // so `fetchPosCatalog` already types this result — no cast needed.
        setCategories(catalog.categories || []);
        setItems(catalog.menuItems || []);
      }
      if (metricsRes.success && metricsRes.metrics) setMetrics(metricsRes.metrics);
    });
  };

  useEffect(() => {
    load();
  }, []);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (activeCategory === "all" || item.categoryId === activeCategory) &&
        (!q || item.name.toLowerCase().includes(q))
    );
  }, [items, activeCategory, search]);

  const subtotal = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const addItem = (item: CatalogItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menuItemId === item._id && l.seat === seat);
      if (existing) {
        return prev.map((l) =>
          l.menuItemId === item._id && l.seat === seat ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { menuItemId: item._id, name: item.name, price: item.price, quantity: 1, seat }];
    });
  };

  const changeQty = (menuItemId: string, lineSeat: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.menuItemId === menuItemId && l.seat === lineSeat ? { ...l, quantity: l.quantity + delta } : l
        )
        .filter((l) => l.quantity > 0)
    );
  };

  const handleFire = () => {
    setMessage(null);
    if (!selectedTable) {
      setMessage({ type: "error", text: "Select a table first." });
      return;
    }
    if (cart.length === 0) {
      setMessage({ type: "error", text: "Add at least one item." });
      return;
    }

    startTransition(async () => {
      try {
        await createWaiterOrder({
          tableId: selectedTable._id,
          sessionId: selectedTable.sessionId || undefined,
          items: cart.map((l) => ({
            menuItemId: l.menuItemId,
            quantity: l.quantity,
            seat: l.seat || undefined,
          })),
          notes,
          clientRequestId: `waiter-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        });
        setCart([]);
        setNotes("");
        setMessage({ type: "success", text: "Order fired to the kitchen." });
        load();
        setSelectedTable(null);
      } catch (err: unknown) {
        setMessage({ type: "error", text: thrownMessage(err, "Failed to fire order.") });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background text-on-surface font-inter flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-container-lowest border-b border-surface-container px-md py-sm flex items-center justify-between">
        <div className="flex items-center gap-xs">
          <span className="material-symbols-outlined text-primary text-[24px]">restaurant</span>
          <div>
            <p className="font-semibold text-body-md text-on-surface">Waiter Mode</p>
            {metrics && (
              <p className="text-label-sm text-on-surface-variant">
                {metrics.ordersTaken} orders · ₹{metrics.revenue.toFixed(2)} today
              </p>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={isPending}
          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">refresh</span>
        </button>
      </header>

      <main className="flex-1 p-md flex flex-col gap-md pb-32">
        {/* Table grid */}
        <section>
          <p className="font-semibold text-label-md text-on-surface-variant mb-xs">Select a table</p>
          <div className="grid grid-cols-4 gap-xs">
            {tables.map((table) => {
              const selected = selectedTable?._id === table._id;
              return (
                <button
                  key={table._id}
                  onClick={() => setSelectedTable(table)}
                  className={`rounded-xl p-sm flex flex-col items-center gap-0.5 border transition-all ${
                    selected
                      ? "border-primary bg-primary/5"
                      : table.status === "occupied"
                        ? "border-on-warning-container bg-accent-amber-container"
                        : "border-surface-container bg-surface-container-lowest"
                  }`}
                >
                  <span className="font-bold text-body-md text-on-surface">{table.tableNumber}</span>
                  <span className="text-label-sm text-on-surface-variant">
                    {table.status === "occupied" ? `₹${table.runningTotal.toFixed(0)}` : "free"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Menu */}
        <section className="flex flex-col gap-sm">
          <div className="flex items-center gap-xs">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search menu…"
              className="flex-1 h-10 bg-surface-container-low rounded-lg px-sm text-body-sm outline-none"
            />
            <select
              value={seat}
              onChange={(e) => setSeat(e.target.value)}
              className="h-10 bg-surface-container-low rounded-lg px-sm text-body-sm outline-none"
            >
              {SEATS.map((s) => (
                <option key={s} value={s}>
                  {s ? `Seat ${s}` : "No seat"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-xs overflow-x-auto pb-xs">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-sm py-xs rounded-full text-label-sm whitespace-nowrap ${
                activeCategory === "all" ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => setActiveCategory(cat._id)}
                className={`px-sm py-xs rounded-full text-label-sm whitespace-nowrap ${
                  activeCategory === cat._id
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-low text-on-surface-variant"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-xs">
            {filteredItems.map((item) => (
              <button
                key={item._id}
                onClick={() => addItem(item)}
                className="bg-surface-container-lowest rounded-xl p-sm border border-surface-container text-left flex flex-col gap-1 active:scale-[0.98] transition-transform"
              >
                <span className="font-semibold text-body-sm text-on-surface leading-tight">{item.name}</span>
                <span className="text-body-sm text-primary font-mono">₹{Number(item.price).toFixed(2)}</span>
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Cart tray */}
      <div className="fixed bottom-0 left-0 right-0 bg-surface-container-lowest border-t border-surface-container p-md flex flex-col gap-sm max-h-[55vh] overflow-y-auto">
        {message && (
          <div
            className={`px-sm py-xs rounded-lg text-body-sm font-semibold ${
              message.type === "success" ? "bg-success-container text-success" : "bg-error-container text-on-error-container"
            }`}
          >
            {message.text}
          </div>
        )}

        {cart.length > 0 && (
          <div className="flex flex-col gap-xs">
            {cart.map((line) => (
              <div key={`${line.menuItemId}-${line.seat}`} className="flex items-center justify-between">
                <span className="text-body-sm text-on-surface">
                  {line.name}
                  {line.seat ? ` · Seat ${line.seat}` : ""}
                </span>
                <div className="flex items-center gap-sm">
                  <button
                    onClick={() => changeQty(line.menuItemId, line.seat, -1)}
                    className="w-7 h-7 rounded bg-surface-container font-bold"
                  >
                    −
                  </button>
                  <span className="font-mono text-body-sm">{line.quantity}</span>
                  <button
                    onClick={() => changeQty(line.menuItemId, line.seat, 1)}
                    className="w-7 h-7 rounded bg-surface-container font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes for the kitchen…"
          className="h-10 bg-surface-container-low rounded-lg px-sm text-body-sm outline-none"
        />

        <div className="flex items-center justify-between">
          <span className="text-body-sm text-on-surface-variant">
            {selectedTable ? `Table ${selectedTable.tableNumber}` : "No table"} ·{" "}
            <span className="font-mono text-on-surface font-semibold">₹{subtotal.toFixed(2)}</span>
          </span>
          <button
            onClick={handleFire}
            disabled={isPending || cart.length === 0}
            className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold text-body-sm disabled:opacity-50"
          >
            {isPending ? "Firing…" : "Fire to Kitchen"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WaiterClient;
