"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useCallback, useState, useTransition } from "react";
import { Coupon } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { createCoupon, deleteCoupon, fetchCoupons, updateCoupon } from "@/actions/coupons";
import { AudienceBuilder } from "./AudienceBuilder";

interface CouponsClientProps {
  initialCoupons: Coupon[];
}

const emptyForm = {
  code: "",
  description: "",
  type: "percent" as "percent" | "flat",
  value: "10",
  minOrder: "0",
  maxDiscount: "0",
  usageLimit: "0",
  perCustomerLimit: "0",
  singleUse: false,
  isActive: true,
  validTo: "",
};

/** Audience is edited through its own builder rather than this flat form. */
const emptyAudience = { mode: "all" as string, rules: [] as { field: string; op: string; value: string | number | boolean }[] };
const emptyAutoIssue = { enabled: false, repeatEveryDays: 0 };

const formatDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

/**
 * Readable summary of an audience, from the rules themselves.
 *
 * The server owns the wording (`segmentService.describeAudience`), so the list
 * cannot drift from the engine; this mirrors the common shapes and falls back to
 * a count when a preset is unrecognised.
 */
const describeAudience = (coupon: Coupon): string => {
  const audience = coupon.audience;
  if (!audience || audience.mode === "all") return "Everyone";
  if (audience.mode === "customers") {
    const count = coupon.appliesTo?.customerIds?.length || 0;
    return `${count} selected customer${count === 1 ? "" : "s"}`;
  }

  const rules = audience.rules || [];
  const presets: Record<string, string> = {
    "visitCount|lte": "New customers",
    "lastVisitAt|not_within_days": "Inactive customers",
    "lifetimeSpend|gte": "Loyal spenders",
    "birthday|month_is": "Birthday this month",
    "tags|contains": "Tagged customers",
  };

  const shapes = rules.map((r) => `${r.field}|${r.op}`);
  if (shapes.length === 1 && presets[shapes[0]]) return presets[shapes[0]];
  if (
    shapes.length === 2 &&
    shapes.includes("lastVisitAt|is_set") &&
    shapes.includes("lastVisitAt|not_within_days")
  ) {
    return "Inactive customers";
  }
  return `${rules.length} condition${rules.length === 1 ? "" : "s"}`;
};

export const CouponsClient: React.FC<CouponsClientProps> = ({ initialCoupons }) => {
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [audience, setAudience] = useState(emptyAudience);
  const [autoIssue, setAutoIssue] = useState(emptyAutoIssue);
  const [error, setError] = useState("");

  const reload = useCallback((term: string) => {
    startTransition(async () => {
      const res = await fetchCoupons({ search: term });
      if (res.success) setCoupons(res.coupons);
    });
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setAudience({ ...emptyAudience, rules: [] });
    setAutoIssue({ ...emptyAutoIssue });
    setError("");
    setIsModalOpen(true);
  };

  const openEdit = (coupon: Coupon) => {
    setEditing(coupon);
    setForm({
      code: coupon.code,
      description: coupon.description || "",
      type: coupon.type,
      value: String(coupon.value),
      minOrder: String(coupon.minOrder || 0),
      maxDiscount: String(coupon.maxDiscount || 0),
      usageLimit: String(coupon.usageLimit || 0),
      perCustomerLimit: String(coupon.perCustomerLimit || 0),
      singleUse: Boolean(coupon.singleUse),
      isActive: coupon.isActive !== false,
      validTo: coupon.validTo ? coupon.validTo.slice(0, 10) : "",
    });
    setAudience(coupon.audience || { ...emptyAudience, rules: [] });
    setAutoIssue(coupon.autoIssue || { ...emptyAutoIssue });
    setError("");
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!form.code.trim()) {
      setError("A coupon code is required.");
      return;
    }
    if (!(Number(form.value) > 0)) {
      setError("Discount value must be greater than 0.");
      return;
    }

    const payload: Partial<Coupon> = {
      code: form.code.trim().toUpperCase(),
      description: form.description.trim(),
      type: form.type,
      value: Number(form.value),
      minOrder: Number(form.minOrder) || 0,
      maxDiscount: Number(form.maxDiscount) || 0,
      usageLimit: Number(form.usageLimit) || 0,
      perCustomerLimit: Number(form.perCustomerLimit) || 0,
      singleUse: form.singleUse,
      isActive: form.isActive,
      validTo: form.validTo ? new Date(form.validTo).toISOString() : null,
      // A segment with no rules is stored as "everyone" server-side, so an
      // untouched builder cannot accidentally publish an unusable offer.
      audience: audience.mode === "segment" && audience.rules.length > 0
        ? { mode: "segment", rules: audience.rules }
        : { mode: "all", rules: [] },
      autoIssue: audience.mode === "segment" ? autoIssue : { enabled: false, repeatEveryDays: 0 },
    };

    startTransition(async () => {
      try {
        if (editing) {
          const res = await updateCoupon(editing._id, payload);
          setCoupons((prev) => prev.map((c) => (c._id === res.coupon._id ? res.coupon : c)));
        } else {
          const res = await createCoupon(payload);
          setCoupons((prev) => [res.coupon, ...prev]);
        }
        setIsModalOpen(false);
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to save coupon."));
      }
    });
  };

  const handleToggle = (coupon: Coupon) => {
    startTransition(async () => {
      try {
        const res = await updateCoupon(coupon._id, { isActive: !coupon.isActive });
        setCoupons((prev) => prev.map((c) => (c._id === res.coupon._id ? res.coupon : c)));
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to update coupon."));
      }
    });
  };

  const handleDelete = (coupon: Coupon) => {
    if (!confirm(`Delete coupon ${coupon.code}? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteCoupon(coupon._id);
        setCoupons((prev) => prev.filter((c) => c._id !== coupon._id));
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to delete coupon."));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Coupons" iconName="local_offer" />

      <main className="flex-1 p-md lg:p-lg max-w-[1100px] w-full mx-auto flex flex-col gap-md">
        <div className="flex items-center justify-between gap-sm flex-wrap">
          <div className="flex items-center gap-sm bg-surface-container-low rounded-xl px-md h-11 flex-1 max-w-[360px]">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                reload(e.target.value);
              }}
              placeholder="Search by code"
              className="flex-1 bg-transparent border-none outline-none font-inter text-body-md text-on-surface placeholder-on-surface-variant/50"
            />
          </div>
          <Button variant="primary" onClick={openCreate} className="h-11 px-md">
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Coupon
          </Button>
        </div>

        {coupons.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container py-xl text-center">
            <span className="material-symbols-outlined text-[44px] text-on-surface-variant/40">local_offer</span>
            <h3 className="font-inter font-semibold text-body-lg text-on-surface mt-xs">No coupons yet</h3>
            <p className="font-inter text-body-sm text-on-surface-variant">
              Create a promo code to offer percentage or flat discounts.
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.2fr_1.4fr_1fr_1fr_1.2fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
              {["Code", "Discount", "Min Order", "Usage", "Actions"].map((h) => (
                <span key={h} className="font-inter font-semibold text-label-sm text-on-surface-variant">
                  {h}
                </span>
              ))}
            </div>

            {coupons.map((coupon) => (
              <div
                key={coupon._id}
                className="grid grid-cols-1 md:grid-cols-[1.2fr_1.4fr_1fr_1fr_1.2fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
              >
                <div className="flex flex-col">
                  <span className="font-inter font-bold text-body-md text-primary font-mono">{coupon.code}</span>
                  <span className="font-inter text-label-sm text-on-surface-variant truncate">
                    {coupon.description || "—"}
                  </span>
                  {/* Who it reaches, so a targeted offer never looks like a
                      café-wide one from the list alone. */}
                  {coupon.audience && coupon.audience.mode !== "all" && (
                    <span className="mt-xs inline-flex w-fit items-center gap-xs rounded-full bg-surface-container px-sm py-[2px] font-inter text-label-sm text-on-surface-variant">
                      <span className="material-symbols-outlined text-[12px]">groups</span>
                      {describeAudience(coupon)}
                      {coupon.autoIssue?.enabled && (
                        <span className="text-primary">· sent</span>
                      )}
                    </span>
                  )}
                </div>
                <div className="flex flex-col">
                  <span className="font-inter text-body-sm text-on-surface">
                    {coupon.type === "percent" ? `${coupon.value}% off` : `₹${coupon.value} off`}
                    {coupon.type === "percent" && coupon.maxDiscount > 0 ? ` (max ₹${coupon.maxDiscount})` : ""}
                  </span>
                  <span className="font-inter text-label-sm text-on-surface-variant">
                    {coupon.singleUse ? "Single use" : coupon.validTo ? `Until ${formatDate(coupon.validTo)}` : "No expiry"}
                  </span>
                </div>
                <span className="font-inter text-body-sm text-on-surface-variant">
                  {coupon.minOrder > 0 ? `₹${coupon.minOrder}` : "None"}
                </span>
                <span className="font-inter text-body-sm text-on-surface-variant">
                  {coupon.usageCount}
                  {coupon.usageLimit > 0 ? ` / ${coupon.usageLimit}` : ""}
                </span>
                <div className="flex items-center gap-xs justify-end">
                  <button
                    onClick={() => handleToggle(coupon)}
                    disabled={isPending}
                    className={`px-sm py-1 rounded-full font-inter font-semibold text-label-sm cursor-pointer transition-colors disabled:opacity-40 ${
                      coupon.isActive ? "bg-success-container text-success" : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {coupon.isActive ? "Active" : "Inactive"}
                  </button>
                  <button
                    onClick={() => openEdit(coupon)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(coupon)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editing ? `Edit ${editing.code}` : "New Coupon"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <div className="grid grid-cols-2 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Code</label>
              <input
                required
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="SAVE10"
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md font-mono text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Type</label>
              <div className="flex gap-sm">
                {(["percent", "flat"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, type: t }))}
                    className={`flex-1 h-11 rounded-xl font-inter font-semibold text-body-sm capitalize cursor-pointer ${
                      form.type === t ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"
                    }`}
                  >
                    {t === "percent" ? "Percent" : "Flat"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="e.g. Weekend happy hour"
              className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">
                {form.type === "percent" ? "Percent off" : "Amount off (₹)"}
              </label>
              <input
                type="number"
                min="0"
                value={form.value}
                onChange={(e) => setForm((p) => ({ ...p, value: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            {form.type === "percent" && (
              <div className="flex flex-col gap-xs">
                <label className="font-inter font-semibold text-label-md text-on-surface">Max discount (₹, 0=off)</label>
                <input
                  type="number"
                  min="0"
                  value={form.maxDiscount}
                  onChange={(e) => setForm((p) => ({ ...p, maxDiscount: e.target.value }))}
                  className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Min order (₹)</label>
              <input
                type="number"
                min="0"
                value={form.minOrder}
                onChange={(e) => setForm((p) => ({ ...p, minOrder: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Total limit (0=∞)</label>
              <input
                type="number"
                min="0"
                value={form.usageLimit}
                onChange={(e) => setForm((p) => ({ ...p, usageLimit: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Per customer (0=∞)</label>
              <input
                type="number"
                min="0"
                value={form.perCustomerLimit}
                onChange={(e) => setForm((p) => ({ ...p, perCustomerLimit: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Valid until (optional)</label>
              <input
                type="date"
                value={form.validTo}
                onChange={(e) => setForm((p) => ({ ...p, validTo: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex items-end gap-md">
              <label className="flex items-center gap-xs font-inter text-body-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.singleUse}
                  onChange={(e) => setForm((p) => ({ ...p, singleUse: e.target.checked }))}
                  className="w-4 h-4 accent-primary"
                />
                Single use
              </label>
              <label className="flex items-center gap-xs font-inter text-body-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                  className="w-4 h-4 accent-primary"
                />
                Active
              </label>
            </div>
          </div>

          {/* Who it is for — its own section because it answers a different
              question from “how much off”, and because the rule builder brings
              its own reach preview. */}
          <div className="flex flex-col gap-md">
            <AudienceBuilder
              audience={audience}
              autoIssue={autoIssue}
              onChange={(next) => setAudience(next)}
              onAutoIssueChange={setAutoIssue}
            />
          </div>

          {error && (
            <div className="bg-error-container text-on-error-container text-body-sm font-inter font-semibold rounded-lg px-md py-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {error}
            </div>
          )}

          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : editing ? "Save Changes" : "Create Coupon"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default CouponsClient;
