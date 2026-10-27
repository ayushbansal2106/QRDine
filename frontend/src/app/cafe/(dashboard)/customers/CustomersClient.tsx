"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useCallback, useState, useTransition } from "react";
import { Customer } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { formatCurrency } from "@/utils/currency";
import {
  fetchCustomer,
  fetchCustomers,
  updateCustomerProfile,
  exportCustomersCsv,
} from "@/actions/customers";

interface CustomersClientProps {
  initialCustomers: Customer[];
}

interface CustomerOrder {
  _id: string;
  orderNumber: string;
  orderType: string;
  status: string;
  totalAmount: number;
  createdAt: string;
}

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const CustomersClient: React.FC<CustomersClientProps> = ({ initialCustomers }) => {
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [editNotes, setEditNotes] = useState("");
  const [editDietary, setEditDietary] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(
    (nextSearch: string, nextSort: string) => {
      startTransition(async () => {
        const res = await fetchCustomers({ search: nextSearch, sort: nextSort, limit: 50 });
        if (res.success && "customers" in res) {
          setCustomers(res.customers as Customer[]);
        }
      });
    },
    []
  );

  const openProfile = (customer: Customer) => {
    setSelected(customer);
    setEditNotes(customer.notes);
    setEditDietary((customer.dietary || []).join(", "));
    setDrawerLoading(true);
    startTransition(async () => {
      const res = await fetchCustomer(customer._id);
      if (res.success && "orders" in res) {
        setOrders((res.orders as CustomerOrder[]) || []);
      }
      setDrawerLoading(false);
    });
  };

  const handleSaveProfile = () => {
    if (!selected) return;
    setSaving(true);
    startTransition(async () => {
      try {
        const dietary = editDietary
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean);
        const res = await updateCustomerProfile(selected._id, { notes: editNotes, dietary });
        if (res.success) {
          setCustomers((prev) =>
            prev.map((c) => (c._id === selected._id ? { ...c, notes: editNotes, dietary } : c))
          );
          setSelected({ ...selected, notes: editNotes, dietary });
        }
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to save profile"));
      } finally {
        setSaving(false);
      }
    });
  };

  const handleExport = () => {
    startTransition(async () => {
      try {
        const res = await exportCustomersCsv();
        const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = res.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (err: unknown) {
        alert(thrownMessage(err, "Export failed"));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Customer CRM" iconName="person_search" />

      <main className="flex-1 p-md overflow-y-auto">
        <div className="max-w-[1280px] mx-auto flex flex-col gap-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-sm">
            <div>
              <h2 className="font-semibold text-headline-lg text-on-surface">Customer Directory</h2>
              <p className="text-body-md text-on-surface-variant">
                Lifetime value, visit history, and preferences.
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={isPending}
              className="h-10 px-md rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-xs disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export CSV
            </button>
          </div>

          <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
            <div className="p-sm border-b border-surface-container flex flex-wrap items-center justify-between gap-sm">
              <div className="relative w-full sm:w-80">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-[18px]">
                  search
                </span>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    loadCustomers(e.target.value, sort);
                  }}
                  placeholder="Search by name, phone, or email…"
                  className="w-full bg-surface-container-lowest border border-surface-container rounded-lg py-1.5 pl-9 pr-3 text-body-md outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  loadCustomers(search, e.target.value);
                }}
                className="bg-surface-container-lowest border border-surface-container rounded-lg py-1.5 px-sm text-body-sm outline-none"
              >
                <option value="recent">Recent</option>
                <option value="spend">Lifetime Spend</option>
                <option value="visits">Most Visits</option>
                <option value="name">Name (A-Z)</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low/20 border-b border-surface-container text-on-surface-variant/80 text-label-md">
                    <th className="py-sm px-md font-semibold">Customer</th>
                    <th className="py-sm px-md font-semibold">Phone</th>
                    <th className="py-sm px-md font-semibold text-right">Visits</th>
                    <th className="py-sm px-md font-semibold text-right">Lifetime</th>
                    <th className="py-sm px-md font-semibold text-right">Avg</th>
                    <th className="py-sm px-md font-semibold">Last Visit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container/60">
                  {customers.map((customer) => (
                    <tr
                      key={customer._id}
                      onClick={() => openProfile(customer)}
                      className="hover:bg-surface-container-low/30 cursor-pointer transition-colors"
                    >
                      <td className="py-sm px-md">
                        <div className="font-semibold text-body-md text-on-surface">
                          {customer.name || "Guest"}
                        </div>
                        <div className="text-body-sm text-on-surface-variant">{customer.email || "—"}</div>
                      </td>
                      <td className="py-sm px-md text-body-sm text-on-surface-variant font-mono">
                        {customer.phone || "—"}
                      </td>
                      <td className="py-sm px-md text-right font-semibold text-on-surface">
                        {customer.visitCount}
                      </td>
                      <td className="py-sm px-md text-right font-semibold text-primary">
                        {formatCurrency(customer.lifetimeSpend)}
                      </td>
                      <td className="py-sm px-md text-right text-body-sm text-on-surface-variant">
                        {formatCurrency(customer.avgSpend)}
                      </td>
                      <td className="py-sm px-md text-body-sm text-on-surface-variant">
                        {formatDate(customer.lastVisitAt)}
                      </td>
                    </tr>
                  ))}
                  {customers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-xl text-center text-on-surface-variant/40">
                        No customers yet. Profiles are created automatically on first order.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-sm border-t border-surface-container text-body-sm text-on-surface-variant">
              Showing {customers.length} customers
            </div>
          </div>
        </div>
      </main>

      {/* Profile Drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-[28rem] bg-surface-container-lowest h-full overflow-y-auto p-lg flex flex-col gap-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-headline-md text-on-surface">
                  {selected.name || "Guest"}
                </h3>
                <p className="text-body-sm text-on-surface-variant font-mono">{selected.phone || "No phone"}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-on-surface-variant">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-sm">
              <div className="bg-surface-container-low rounded-lg p-sm">
                <div className="text-label-sm text-on-surface-variant">Visits</div>
                <div className="font-bold text-body-lg">{selected.visitCount}</div>
              </div>
              <div className="bg-surface-container-low rounded-lg p-sm">
                <div className="text-label-sm text-on-surface-variant">Lifetime</div>
                <div className="font-bold text-body-lg text-primary">
                  {formatCurrency(selected.lifetimeSpend)}
                </div>
              </div>
              <div className="bg-surface-container-low rounded-lg p-sm">
                <div className="text-label-sm text-on-surface-variant">Avg</div>
                <div className="font-bold text-body-lg">{formatCurrency(selected.avgSpend)}</div>
              </div>
            </div>

            <div className="flex flex-col gap-xs">
              <label className="font-semibold text-label-md text-on-surface">Dietary preferences</label>
              <input
                value={editDietary}
                onChange={(e) => setEditDietary(e.target.value)}
                placeholder="Vegan, Nut allergy…"
                className="bg-surface-container-low rounded-lg p-sm text-body-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex flex-col gap-xs">
              <label className="font-semibold text-label-md text-on-surface">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Allergies, birthday, preferences…"
                className="bg-surface-container-low rounded-lg p-sm text-body-sm h-24 resize-none outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={saving || isPending}
              className="px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Profile"}
            </button>

            <div className="flex flex-col gap-sm">
              <h4 className="font-semibold text-body-md text-on-surface">Recent Orders</h4>
              {drawerLoading ? (
                <div className="text-body-sm text-on-surface-variant">Loading history…</div>
              ) : orders.length === 0 ? (
                <div className="text-body-sm text-on-surface-variant/50">No linked orders found.</div>
              ) : (
                orders.map((order) => (
                  <div
                    key={order._id}
                    className="flex justify-between items-center bg-surface-container-low rounded-lg px-sm py-xs"
                  >
                    <div className="flex flex-col">
                      <span className="text-body-sm font-semibold text-on-surface">{order.orderNumber}</span>
                      <span className="text-label-sm text-on-surface-variant capitalize">
                        {order.orderType?.replace("_", "-")} · {formatDate(order.createdAt)}
                      </span>
                    </div>
                    <span className="font-mono text-body-sm">{formatCurrency(order.totalAmount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersClient;
