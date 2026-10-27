"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { TopAppBar } from "@/components/layout/TopAppBar";
import {
  checkoutPosOrder,
  lookupCustomerByPhone,
  previewPosCode,
  fetchReceipt,
  type PosDiscount,
  type PosLineItem,
  type PosPromoPreview,
  type PosTender,
  type PosCatalogResponse,
} from "@/actions/pos";

interface PosVariant {
  _id?: string;
  name: string;
  price: number;
  isDefault?: boolean;
}

interface PosModifierOption {
  _id?: string;
  name: string;
  price: number;
}

interface PosModifierGroup {
  _id?: string;
  name: string;
  selectionType: "single" | "multi";
  isRequired?: boolean;
  min?: number;
  max?: number;
  options: PosModifierOption[];
}

export interface PosMenuItem {
  _id: string;
  name: string;
  price: number;
  categoryId: string;
  gstPercentage?: number;
  variants?: PosVariant[];
  modifierGroups?: PosModifierGroup[];
}

export interface PosCategory {
  _id: string;
  name: string;
}

export interface PosTable {
  _id: string;
  tableNumber: number | string;
}

/**
 * What `/pos/catalog` returns.
 *
 * Aliased to the action's declared response rather than restated, so the till
 * and the fetch it depends on cannot disagree about the shape. Exported because
 * the server page and the waiter handheld both consume the same endpoint.
 */
export type PosCatalog = PosCatalogResponse;

interface CartLine {
  lineId: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  gstPercentage: number;
  quantity: number;
  variantId?: string;
  modifiers: { groupId: string; optionId: string; name: string; price: number }[];
}

interface PosClientProps {
  catalog: PosCatalog;
}

const round2 = (n: number) => Number(n.toFixed(2));

export const PosClient: React.FC<PosClientProps> = ({ catalog }) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  /** Source of unique cart line ids — see `addToCart`. */
  const lineCounter = useRef(0);

  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<"dine_in" | "takeaway" | "delivery">("dine_in");
  const [tableId, setTableId] = useState<string>(catalog.tables[0]?._id || "");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  /** Whether the number dialled at the till is a profile we already know. */
  const [customerStatus, setCustomerStatus] = useState<"idle" | "checking" | "known" | "new">("idle");
  /**
   * The profile behind that number.
   *
   * A reward voucher belongs to one customer, so the till cannot price it
   * without knowing whose card it is on — which is also why the number has to
   * be dialled *before* the code, not after.
   */
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PosPromoPreview | null>(null);
  const [promoError, setPromoError] = useState("");
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [confirmedOrderTotal, setConfirmedOrderTotal] = useState(0);

  const [discountType, setDiscountType] = useState<"flat" | "percent">("percent");
  const [discountValue, setDiscountValue] = useState("");

  const [detailItem, setDetailItem] = useState<PosMenuItem | null>(null);
  /**
   * The payment dialog opens on "Take Payment" and closes only once the sale is
   * confirmed. While it is open nothing has been written to the server, so
   * dismissing it leaves no order behind at all.
   */
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const [tenders, setTenders] = useState<PosTender[]>([]);
  const [tenderMethod, setTenderMethod] = useState<PosTender["method"]>("cash");
  const [tenderAmount, setTenderAmount] = useState("");
  const [error, setError] = useState("");

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.menuItems.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.categoryId === activeCategory;
      const matchesSearch = !q || item.name.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [catalog.menuItems, activeCategory, search]);

  const subtotal = round2(cart.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));
  const gstTotal = round2(
    cart.reduce((sum, l) => sum + (l.unitPrice * l.quantity * (l.gstPercentage || 0)) / 100, 0)
  );
  const discountAmount = useMemo(() => {
    const value = Number(discountValue) || 0;
    if (!catalog.canDiscount || value <= 0) return 0;
    return round2(discountType === "percent" ? (subtotal * value) / 100 : value);
  }, [discountValue, discountType, subtotal, catalog.canDiscount]);

  // A pasted code and a manual POS discount are two different deductions on the
  // same bill, so they are added together here and both sent at checkout — the
  // server refuses the combination, and the cashier sees the exact figure that
  // will be refused instead of finding out at the till.
  const promoSaving = appliedPromo?.amount || 0;
  const totalDiscount = round2(discountAmount + promoSaving);
  const grandTotal = round2(Math.max(0, subtotal - totalDiscount + gstTotal));

  /**
   * Apply one code against the running cart and name the offer.
   *
   * The cashier is handed `FIRST50` or `RWD-9F2C11` and cannot tell which from
   * the shape, so the till does not ask: one field, and the server answers with
   * what the code is and what it saves. Only one code can be live at a time.
   */
  const handleApplyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;

    setApplyingPromo(true);
    setPromoError("");
    const res = await previewPosCode({
      code,
      subtotal,
      customerId: linkedCustomerId,
    });
    setApplyingPromo(false);

    if (!res.success || !res.promo) {
      setPromoError(res.message || "That code could not be applied.");
      setAppliedPromo(null);
      return;
    }

    setAppliedPromo(res.promo);
    setPromoInput(res.promo.code);
  };

  const clearPromo = () => {
    setAppliedPromo(null);
    setPromoInput("");
    setPromoError("");
  };

  const addToCart = (
    item: PosMenuItem,
    variant: PosVariant | null,
    modifiers: CartLine["modifiers"],
    quantity: number
  ) => {
    const modifierPrice = modifiers.reduce((sum, m) => sum + m.price, 0);
    const unitPrice = (variant ? variant.price : item.price) + modifierPrice;
    // A monotonic counter, not `Date.now()`: the same dish added twice within
    // one millisecond got the same id and the two lines collapsed into one.
    // The counter also keeps this handler pure, so the React Compiler accepts
    // it (reading the clock here was an impure call in the component body).
    const lineId = `${item._id}-${variant?._id || "base"}-${modifiers
      .map((m) => m.optionId)
      .sort()
      .join("_")}-${lineCounter.current++}`;

    setCart((prev) => [
      ...prev,
      {
        lineId,
        menuItemId: item._id,
        name: item.name,
        unitPrice: round2(unitPrice),
        gstPercentage: item.gstPercentage || 0,
        quantity,
        variantId: variant?._id,
        modifiers,
      },
    ]);
  };

  const handleItemClick = (item: PosMenuItem) => {
    const hasOptions = (item.variants?.length || 0) > 0 || (item.modifierGroups?.length || 0) > 0;
    if (hasOptions) {
      setDetailItem(item);
    } else {
      addToCart(item, null, [], 1);
    }
  };

  const changeQty = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const clearCart = () => {
    setCart([]);
    setDiscountValue("");
    setNotes("");
    setCustomerPhone("");
    setCustomerName("");
    setCustomerStatus("idle");
    setLinkedCustomerId(null);
    clearPromo();
    setConfirmedOrderId(null);
    setConfirmedOrderTotal(0);
    setTenders([]);
    setTenderAmount("");
    setIsPaymentOpen(false);
    setError("");
  };

  /**
   * Resolve the dialled number against the CRM.
   *
   * A returning customer gets their name filled in for the cashier so the sale
   * is recognisable on the receipt, and an unknown number is flagged as new
   * rather than silently becoming another blank profile. Editing the number
   * invalidates the previous answer, so a stale name is never attached to the
   * wrong person.
   */
  const handlePhoneLookup = async () => {
    const phone = customerPhone.trim();
    if (!phone) {
      setCustomerStatus("idle");
      return;
    }

    setCustomerStatus("checking");
    try {
      const result = await lookupCustomerByPhone(phone);
      if (result.found && result.customer) {
        setCustomerName(result.customer.name);
        setLinkedCustomerId(result.customer.id);
        setCustomerStatus("known");
      } else {
        setLinkedCustomerId(null);
        setCustomerStatus("new");
      }
    } catch {
      // A failed lookup must not block the sale — the order is still placed,
      // it simply starts a new profile.
      setLinkedCustomerId(null);
      setCustomerStatus("idle");
    }
  };

  /**
   * Open the payment dialog. Nothing is sent to the server here — the order
   * does not exist until the cashier confirms the tender.
   */
  const handleOpenPayment = () => {
    setError("");
    if (cart.length === 0) {
      setError("Add at least one item.");
      return;
    }
    if (orderType === "dine_in" && !tableId) {
      setError("Select a table for dine-in orders.");
      return;
    }

    setConfirmedOrderId(null);
    setConfirmedOrderTotal(0);
    setTenders([]);
    setTenderMethod("cash");
    setTenderAmount(grandTotal.toFixed(2));
    setIsPaymentOpen(true);
  };

  const addTender = () => {
    const amount = Number(tenderAmount) || 0;
    if (amount <= 0) return;
    // Block overpayment here as well as on the server. The backend is the real
    // gate, but catching it now keeps the cashier from discovering it through
    // an error toast after tapping Confirm.
    if (amount - Math.max(remaining, 0) > 0.001) {
      setError(
        `That is more than the ₹${Math.max(remaining, 0).toFixed(2)} still due. ` +
          "Record the exact amount."
      );
      return;
    }
    setError("");
    setTenders((prev) => [...prev, { method: tenderMethod, amount }]);
    // Refill with what is still outstanding so the next tender needs no typing,
    // and clear it entirely once nothing is left due.
    const stillDue = round2(Math.max(remaining - amount, 0));
    setTenderAmount(stillDue > 0 ? stillDue.toFixed(2) : "");
  };

  const tenderedTotal = round2(tenders.reduce((sum, t) => sum + t.amount, 0));
  // Before confirmation the cashier works against the cart total; after it the
  // server's authoritative total takes over.
  const orderTotal = confirmedOrderId ? confirmedOrderTotal || grandTotal : grandTotal;
  const remaining = round2(orderTotal - tenderedTotal);
  // Nothing left to tender: the Amount box is cleared and Add is disabled, so
  // the cashier cannot accidentally add a second tender on top of the full one
  // already recorded.
  const fullyPaid = remaining <= 0.001;

  // Seed the Amount box with whatever is still due. `tenderAmount` is only
  // overwritten while the cashier has not typed anything themselves, so this
  // cannot fight the manual-entry path.
  const lastSeededRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPaymentOpen || confirmedOrderId) return;
    const due = remaining > 0.001 ? remaining.toFixed(2) : "";
    if (tenderAmount === "" || tenderAmount === lastSeededRef.current) {
      setTenderAmount(due);
      lastSeededRef.current = due;
    }
  }, [isPaymentOpen, confirmedOrderId, remaining, tenderAmount]);

  /**
   * Confirm the sale: one request that validates, creates and settles. Until
   * this resolves the cart is still only on the screen.
   */
  const handleConfirmPayment = () => {
    setError("");

    if (!fullyPaid) {
      setError(`₹${Math.max(remaining, 0).toFixed(2)} is still outstanding.`);
      return;
    }

    const items: PosLineItem[] = cart.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      variantId: l.variantId,
      modifiers: l.modifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
    }));

    const discounts: PosDiscount[] =
      discountAmount > 0
        ? [{ type: discountType, value: Number(discountValue) || 0, label: "POS discount" }]
        : [];

    startTransition(async () => {
      try {
        const result = await checkoutPosOrder({
          orderType,
          tableId: orderType === "dine_in" ? tableId : undefined,
          items,
          notes,
          customerPhone: customerPhone.trim() || undefined,
          customerName: customerName.trim() || undefined,
          discounts,
          couponCode: appliedPromo?.kind === "coupon" ? appliedPromo.code : undefined,
          voucherCode: appliedPromo?.kind === "voucher" ? appliedPromo.code : undefined,
          tenders,
          clientRequestId: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        setConfirmedOrderId(result.order._id);
        setConfirmedOrderTotal(Number(result.order.totalAmount) || grandTotal);
        router.refresh();
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to complete the sale."));
      }
    });
  };

  const handlePrint = () => {
    if (!confirmedOrderId) return;
    startTransition(async () => {
      try {
        const receipt = await fetchReceipt(confirmedOrderId, true);
        const win = window.open("", "_blank", "width=380,height=600");
        if (win) {
          win.document.write(`<pre style="font-family:monospace;font-size:12px">${receipt.text}</pre>`);
          win.document.close();
          win.print();
        }
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to build receipt."));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background font-inter h-screen overflow-hidden">
      <TopAppBar title="Counter POS" iconName="point_of_sale" showStatusBadge={false} />

      <main className="flex-1 flex overflow-hidden">
        {/* Catalog */}
        <section className="flex-1 flex flex-col overflow-hidden border-r border-surface-container">
          <div className="p-md flex gap-sm items-center border-b border-surface-container">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="flex-1 px-md py-sm rounded-lg bg-surface-container-low text-body-md outline-none"
            />
          </div>

          <div className="px-md py-sm flex gap-xs overflow-x-auto border-b border-surface-container">
            <button
              onClick={() => setActiveCategory("all")}
              className={`px-md py-xs rounded-full text-body-sm font-semibold whitespace-nowrap ${
                activeCategory === "all" ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"
              }`}
            >
              All
            </button>
            {catalog.categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => setActiveCategory(cat._id)}
                className={`px-md py-xs rounded-full text-body-sm font-semibold whitespace-nowrap ${
                  activeCategory === cat._id ? "bg-primary text-on-primary" : "bg-surface-container-low text-on-surface-variant"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-md grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-sm content-start">
            {filteredItems.map((item) => (
              <button
                key={item._id}
                onClick={() => handleItemClick(item)}
                className="text-left bg-surface-container-lowest border border-surface-container rounded-xl p-sm hover:border-primary transition-colors flex flex-col gap-xs justify-between min-h-[92px]"
              >
                <span className="font-semibold text-body-md text-on-surface line-clamp-2">{item.name}</span>
                <span className="text-body-sm text-primary font-bold font-mono">₹{item.price.toFixed(2)}</span>
              </button>
            ))}
            {filteredItems.length === 0 && (
              <div className="col-span-full text-center py-xl text-on-surface-variant/40">
                No items match your search.
              </div>
            )}
          </div>
        </section>

        {/* Cart */}
        <aside className="w-[380px] shrink-0 flex flex-col bg-surface-container-low">
          <div className="p-md border-b border-surface-container flex flex-col gap-sm">
            <div className="flex gap-xs">
              {(["dine_in", "takeaway", "delivery"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setOrderType(type)}
                  className={`flex-1 px-sm py-xs rounded-lg text-body-sm font-semibold capitalize ${
                    orderType === type ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {type.replace("_", "-")}
                </button>
              ))}
            </div>

            {orderType === "dine_in" && (
              <select
                value={tableId}
                onChange={(e) => setTableId(e.target.value)}
                className="px-md py-sm rounded-lg bg-surface-container-lowest text-body-md outline-none"
              >
                <option value="">Select table…</option>
                {catalog.tables.map((t) => (
                  <option key={t._id} value={t._id}>
                    Table {t.tableNumber}
                  </option>
                ))}
              </select>
            )}

            <div className="flex gap-xs items-center">
              <input
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                  // The previous lookup was for a different number; its name and
                  // its verdict no longer apply.
                  setCustomerStatus("idle");
                }}
                onBlur={handlePhoneLookup}
                placeholder="Phone (CRM)"
                className="flex-1 min-w-0 px-md py-sm rounded-lg bg-surface-container-lowest text-body-sm outline-none"
              />
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Name"
                className="flex-1 min-w-0 px-md py-sm rounded-lg bg-surface-container-lowest text-body-sm outline-none"
              />
            </div>
            {customerStatus !== "idle" && customerStatus !== "checking" && (
              <span className="text-label-sm text-on-surface-variant">
                {customerStatus === "known"
                  ? "Returning customer — this sale will be linked to their profile"
                  : "New number — a profile will be created and this order will appear in their history"}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-md flex flex-col gap-sm">
            {cart.map((line) => (
              <div key={line.lineId} className="bg-surface-container-lowest rounded-lg p-sm flex flex-col gap-xs">
                <div className="flex justify-between items-start">
                  <span className="font-semibold text-body-md text-on-surface">{line.name}</span>
                  <span className="text-body-sm font-mono text-primary">₹{(line.unitPrice * line.quantity).toFixed(2)}</span>
                </div>
                {line.modifiers.length > 0 && (
                  <span className="text-body-sm text-on-surface-variant">
                    {line.modifiers.map((m) => m.name).join(", ")}
                  </span>
                )}
                <div className="flex items-center gap-sm">
                  <button onClick={() => changeQty(line.lineId, -1)} className="w-7 h-7 rounded bg-surface-container font-bold">−</button>
                  <span className="font-mono font-semibold">{line.quantity}</span>
                  <button onClick={() => changeQty(line.lineId, 1)} className="w-7 h-7 rounded bg-surface-container font-bold">+</button>
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <div className="text-center py-xl text-on-surface-variant/40 select-none">Cart is empty</div>
            )}
          </div>

          <div className="p-md border-t border-surface-container flex flex-col gap-sm">
            {catalog.canDiscount && (
              <div className="flex gap-xs items-center">
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "flat" | "percent")}
                  className="px-sm py-xs rounded-lg bg-surface-container-lowest text-body-sm"
                >
                  <option value="percent">%</option>
                  <option value="flat">₹</option>
                </select>
                <input
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="Discount"
                  className="flex-1 px-md py-sm rounded-lg bg-surface-container-lowest text-body-sm outline-none"
                />
              </div>
            )}

            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Order notes…"
              className="px-md py-sm rounded-lg bg-surface-container-lowest text-body-sm outline-none"
            />

            <div className="flex flex-col gap-xs">
              <div className="flex gap-sm">
                <input
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value.toUpperCase());
                    // Editing invalidates the applied offer — the discount on
                    // screen must always describe the code in the box.
                    if (appliedPromo) setAppliedPromo(null);
                    setPromoError("");
                  }}
                  placeholder="Coupon or reward code"
                  aria-label="Coupon or reward code"
                  className="flex-1 px-md py-sm rounded-lg bg-surface-container-lowest text-body-sm font-mono outline-none"
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={applyingPromo || !promoInput.trim()}
                  className="shrink-0 px-md py-sm rounded-lg bg-primary text-on-primary text-body-sm font-semibold disabled:opacity-40"
                >
                  {applyingPromo ? "Checking…" : "Apply"}
                </button>
              </div>

              {promoError && <span className="text-body-sm text-error">{promoError}</span>}

              {appliedPromo && (
                <div className="flex items-start justify-between gap-sm rounded-lg bg-surface-container px-sm py-xs">
                  <div className="min-w-0">
                    <span className="block text-body-sm font-semibold text-on-surface">
                      {appliedPromo.title} applied
                    </span>
                    <span className="block text-[11px] leading-snug text-on-surface-variant">
                      {appliedPromo.message}
                    </span>
                  </div>
                  <button onClick={clearPromo} aria-label="Remove code" className="text-on-surface-variant">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              )}
            </div>

            <div className="text-body-sm text-on-surface-variant flex flex-col gap-xs">
              <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">₹{subtotal.toFixed(2)}</span></div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-green-600"><span>POS discount</span><span className="font-mono">−₹{discountAmount.toFixed(2)}</span></div>
              )}
              {promoSaving > 0 && (
                <div className="flex justify-between text-green-600">
                  <span className="truncate pr-sm">{appliedPromo?.title} · {appliedPromo?.code}</span>
                  <span className="font-mono">−₹{promoSaving.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between"><span>GST</span><span className="font-mono">₹{gstTotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-body-lg font-bold text-on-surface pt-xs border-t border-surface-container">
                <span>Total</span><span className="font-mono">₹{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {error && <div className="text-body-sm text-error">{error}</div>}

            <div className="flex gap-sm">
              <button onClick={clearCart} className="px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-semibold">Clear</button>
              <button
                onClick={handleOpenPayment}
                disabled={isPending || isPaymentOpen}
                className="flex-1 px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
              >
                Take Payment
              </button>
            </div>
          </div>
        </aside>
      </main>

      {detailItem && (
        <ItemDetailModal
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onAdd={(variant, modifiers, qty) => {
            addToCart(detailItem, variant, modifiers, qty);
            setDetailItem(null);
          }}
        />
      )}

      {isPaymentOpen && (
        <PaymentModal
          orderTotal={orderTotal}
          tenders={tenders}
          remaining={remaining}
          tenderMethod={tenderMethod}
          tenderAmount={tenderAmount}
          isPending={isPending}
          isConfirmed={confirmedOrderId !== null}
          onMethodChange={setTenderMethod}
          onAmountChange={setTenderAmount}
          onAddTender={addTender}
          addDisabled={fullyPaid}
          onRemoveTender={(idx) => setTenders((prev) => prev.filter((_, i) => i !== idx))}
          onConfirm={handleConfirmPayment}
          onPrint={handlePrint}
          onDone={clearCart}
          error={error}
        />
      )}
    </div>
  );
};

const ItemDetailModal: React.FC<{
  item: PosMenuItem;
  onClose: () => void;
  onAdd: (
    variant: PosVariant | null,
    modifiers: CartLine["modifiers"],
    qty: number
  ) => void;
}> = ({ item, onClose, onAdd }) => {
  const variants = item.variants || [];
  const [variantId, setVariantId] = useState<string>(
    variants.find((v) => v.isDefault)?._id || variants[0]?._id || ""
  );
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const toggleOption = (group: PosModifierGroup, optionId: string) => {
    const groupId = group._id || group.name;
    setSelected((prev) => {
      const current = prev[groupId] || [];
      if (group.selectionType === "single") {
        return { ...prev, [groupId]: [optionId] };
      }
      return {
        ...prev,
        [groupId]: current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  };

  const buildModifiers = (): CartLine["modifiers"] => {
    const result: CartLine["modifiers"] = [];
    for (const group of item.modifierGroups || []) {
      const groupId = group._id || group.name;
      for (const optionId of selected[groupId] || []) {
        const option = group.options.find((o) => o._id === optionId);
        if (option) {
          result.push({ groupId, optionId, name: option.name, price: option.price || 0 });
        }
      }
    }
    return result;
  };

  const variant = variants.find((v) => v._id === variantId) || null;
  const modifierTotal = buildModifiers().reduce((sum, m) => sum + m.price, 0);
  const unitPrice = (variant ? variant.price : item.price) + modifierTotal;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-md">
      <div className="bg-surface-container-lowest rounded-xl p-lg w-full max-w-[28rem] max-h-[85vh] overflow-y-auto flex flex-col gap-md">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-body-lg text-on-surface">{item.name}</h3>
          <button onClick={onClose} className="text-on-surface-variant text-body-lg">✕</button>
        </div>

        {variants.length > 0 && (
          <div className="flex flex-col gap-xs">
            <span className="font-semibold text-body-sm text-on-surface-variant">Size / Variant</span>
            <div className="flex flex-wrap gap-xs">
              {variants.map((v) => (
                <button
                  key={v._id}
                  onClick={() => setVariantId(v._id || "")}
                  className={`px-md py-xs rounded-full text-body-sm font-semibold ${
                    variantId === v._id ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {v.name} · ₹{v.price.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
        )}

        {(item.modifierGroups || []).map((group) => (
          <div key={group._id || group.name} className="flex flex-col gap-xs">
            <span className="font-semibold text-body-sm text-on-surface-variant">{group.name}</span>
            <div className="flex flex-wrap gap-xs">
              {group.options.map((option) => {
                const groupId = group._id || group.name;
                const isSelected = (selected[groupId] || []).includes(option._id || option.name);
                return (
                  <button
                    key={option._id}
                    onClick={() => toggleOption(group, option._id || "")}
                    className={`px-md py-xs rounded-full text-body-sm ${
                      isSelected ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {option.name}
                    {option.price ? ` +₹${option.price.toFixed(2)}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t border-surface-container pt-md">
          <div className="flex items-center gap-sm">
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 rounded bg-surface-container font-bold">−</button>
            <span className="font-mono font-semibold">{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 rounded bg-surface-container font-bold">+</button>
          </div>
          <span className="font-bold text-primary font-mono">₹{(unitPrice * qty).toFixed(2)}</span>
        </div>

        <button
          onClick={() => onAdd(variant, buildModifiers(), qty)}
          className="w-full px-md py-sm rounded-lg bg-primary text-on-primary font-semibold"
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
};

const PaymentModal: React.FC<{
  orderTotal: number;
  tenders: PosTender[];
  remaining: number;
  tenderMethod: PosTender["method"];
  tenderAmount: string;
  isPending: boolean;
  /** The sale is on the server — the till controls collapse to Print. */
  isConfirmed: boolean;
  onMethodChange: (m: PosTender["method"]) => void;
  onAmountChange: (v: string) => void;
  onAddTender: () => void;
  onRemoveTender: (idx: number) => void;
  /** Nothing left to tender — the Amount/Add controls are inert. */
  addDisabled: boolean;
  onConfirm: () => void;
  onPrint: () => void;
  onDone: () => void;
  error: string;
}> = ({
  orderTotal,
  tenders,
  remaining,
  tenderMethod,
  tenderAmount,
  isPending,
  isConfirmed,
  onMethodChange,
  onAmountChange,
  onAddTender,
  onRemoveTender,
  addDisabled,
  onConfirm,
  onPrint,
  onDone,
  error,
}) => (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-md">
    <div className="bg-surface-container-lowest rounded-xl p-lg w-full max-w-[28rem] flex flex-col gap-md">
      <h3 className="font-bold text-body-lg text-on-surface">
        {isConfirmed ? "Payment Confirmed" : "Take Payment"}
      </h3>

      {isConfirmed ? (
        <>
          <p className="text-body-sm text-on-surface-variant">
            The order is saved and the bill is settled. Print the receipt for the
            customer, then start the next order.
          </p>
          <button
            onClick={onPrint}
            className="w-full px-md py-sm rounded-lg bg-primary text-on-primary font-semibold"
          >
            Print Receipt
          </button>
          <button
            onClick={onDone}
            className="w-full px-md py-sm rounded-lg border border-surface-container text-on-surface-variant font-semibold"
          >
            New Order
          </button>
        </>
      ) : (
        <>
          <p className="text-body-sm text-on-surface-variant">
            No order is created until you confirm. Dismiss this without
            confirming and nothing is saved.
          </p>
          <div className="flex justify-between text-body-md">
            <span>Order Total</span>
            <span className="font-mono font-bold">₹{orderTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-body-md">
            <span>Remaining</span>
            <span className={`font-mono font-bold ${remaining > 0 ? "text-error" : "text-success"}`}>
              {remaining > 0 ? `₹${remaining.toFixed(2)}` : "Fully paid"}
            </span>
          </div>

          <div className="flex gap-xs">
            <select
              value={tenderMethod}
              onChange={(e) => onMethodChange(e.target.value as PosTender["method"])}
              className="shrink-0 w-28 px-sm py-sm rounded-lg bg-surface-container text-body-sm"
            >
              <option value="cash">Cash</option>
              <option value="upi_manual">UPI</option>
              <option value="card_manual">Card</option>
              <option value="wallet">Wallet</option>
            </select>
            <input
              value={tenderAmount}
              onChange={(e) => onAmountChange(e.target.value)}
              placeholder="Amount"
              inputMode="decimal"
              // `min-w-0` is required: a flex item defaults to `min-width:auto`, so
              // the input refuses to shrink below its content and pushes the Add
              // button outside the panel.
              className="flex-1 min-w-0 px-md py-sm rounded-lg bg-surface-container text-body-sm outline-none"
            />
            <button
              onClick={onAddTender}
              disabled={addDisabled}
              className="shrink-0 px-md py-sm rounded-lg bg-surface-container font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-xs">
            {tenders.map((t, idx) => (
              <div key={idx} className="flex justify-between items-center bg-surface-container-low rounded-lg px-sm py-xs text-body-sm">
                <span className="capitalize">{t.method.replace("_manual", "")}</span>
                <span className="font-mono">₹{t.amount.toFixed(2)}</span>
                <button onClick={() => onRemoveTender(idx)} className="text-error">✕</button>
              </div>
            ))}
          </div>

          {error && <div className="text-body-sm text-error">{error}</div>}

          <div className="flex gap-sm">
            <button
              onClick={onConfirm}
              disabled={isPending || !fullyPaidForConfirm(remaining)}
              className="flex-1 px-md py-sm rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50"
            >
              {isPending ? "Processing…" : "Confirm Payment"}
            </button>
            <button
              onClick={onDone}
              className="shrink-0 px-md py-sm rounded-lg bg-surface-container text-on-surface-variant font-semibold"
            >
              Discard
            </button>
          </div>
        </>
      )}
    </div>
  </div>
);

/** Confirm stays disabled until the tender covers the total to the paisa. */
const fullyPaidForConfirm = (remaining: number) => remaining <= 0.001;

export default PosClient;
