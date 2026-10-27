"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/common/Button";
import { useCartStore, cartLineKey } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { createOrder, previewOrderCode, type PromoPreview } from "@/actions/orders";
import { getPublicTableAction } from "@/actions/tables";
import { SessionGate, useSessionGate } from "@/components/menu/SessionGate";
import { useStoresHydrated } from "@/store/useStoresHydrated";
import { formatCurrency } from "@/utils/currency";
import { requestCustomerLocation } from "@/lib/geolocation";

export default function CheckoutPage() {
  return <CheckoutPageShell />;
}

/**
 * Shell for the checkout screen.
 *
 * The menu is fully browsable without an identity, so sign-in lives here: the
 * gate is mounted around the review screen and only interrupts if there is no
 * dining session yet. A guest who already signed in at the table walks straight
 * through to reviewing their order.
 */
function CheckoutPageShell() {
  const tableId = useCartStore((s) => s.tableId);
  const cafeId = useCartStore((s) => s.cafeId);
  // `useCartStore.persist` does not exist during server rendering, and seeding
  // the initial state from it would make the first client render disagree with
  // the server. This hook handles both.
  const hydrated = useStoresHydrated();

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="font-inter text-body-md text-on-surface-variant">Loading checkout…</span>
      </div>
    );
  }if (!tableId) {
    // The review screen owns the "nothing to review" empty state.
    return <CheckoutReview />;
  }

  return (
    <SessionGate tableId={tableId} cafeId={cafeId ?? ""}>
      <CheckoutReview />
    </SessionGate>
  );
}

function CheckoutReview() {
  const router = useRouter();
  const { ensureSession } = useSessionGate();
  const { items, getTotalPrice, tableId, tableNumber, sessionId, clearCart, setTableId, setSessionId } =
    useCartStore();
  const hydrated = useStoresHydrated();
  const { sessionStatus, savedCustomerName, savedCustomerEmail } = useSessionStore();
  const isSessionLocked =
    sessionStatus === "bill_requested" || sessionStatus === "awaiting_payment";

  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [clientRequestId] = useState(() =>
    crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15)
  );
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<PromoPreview | null>(null);
  const [promoError, setPromoError] = useState("");
  const [applyingPromo, setApplyingPromo] = useState(false);
  const [showCoupon, setShowCoupon] = useState(false);
  // Ordering needs a dining session; the gate creates one (prompting for
  // sign-in) so the guest is never left staring at a disabled button.
  const [sessionReady, setSessionReady] = useState(false);
  /**
   * The session this screen actually verified.
   *
   * Kept from `ensureSession()`'s answer rather than re-read from a store at
   * submit time: the value that was checked is the value that must be sent.
   */
  const [ensuredSession, setEnsuredSession] = useState<{
    sessionId: string;
    participantId?: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureSession()
      .then((session) => {
        if (cancelled) return;
        setEnsuredSession(session);
        setSessionReady(Boolean(session));
      })
      .catch(() => {
        if (!cancelled) {
          setEnsuredSession(null);
          setSessionReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ensureSession]);

  // The table number is only ever written by the menu screen. Recover it here
  // when checkout is opened directly, so the seat shown is never a placeholder.
  useEffect(() => {
    if (!hydrated || !tableId) return;
    if (tableNumber !== null && tableNumber !== 0) return;

    let cancelled = false;
    getPublicTableAction(tableId).then((res) => {
      if (cancelled || !res.success || res.tableNumber === null) return;
      setTableId(tableId, res.tableNumber);
    });

    return () => {
      cancelled = true;
    };
  }, [hydrated, tableId, tableNumber, setTableId]);

  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <span className="font-inter text-body-md text-on-surface-variant">Loading checkout…</span>
      </div>
    );
  }

  if (items.length === 0 || !tableId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-md text-center bg-background">
        <h3 className="font-inter font-semibold text-headline-md text-on-surface mb-xs">
          Nothing to review
        </h3>
        <p className="font-inter text-body-sm text-on-surface-variant mb-md">
          Add a few dishes to your table before placing an order.
        </p>
        <Link href={tableId ? `/table/${tableId}` : "/welcome"} passHref>
          <Button variant="primary">Back to menu</Button>
        </Link>
      </div>
    );
  }

  const subtotal = items.reduce(
    (acc, item) => acc + (Number(item.unitPrice ?? item.menuItem.price) * item.quantity),
    0
  );
  const totalGST = items.reduce(
    (acc, item) =>
      acc +
      (Number(item.unitPrice ?? item.menuItem.price) *
        item.quantity *
        (item.menuItem.gstPercentage || 0)) /
        100,
    0
  );
  const total = getTotalPrice() || subtotal + totalGST;
  const itemCount = items.reduce((acc, item) => acc + item.quantity, 0);
  // GST is charged on the pre-discount value, exactly as the server does, so the
  // total on this screen matches the bill.
  const promoSaving = appliedPromo?.amount || 0;
  const payableTotal = Math.max(0, subtotal - promoSaving + totalGST);

  /**
   * Apply one code and say what it is worth.
   *
   * The guest does not choose between a coupon and a voucher — they paste what
   * they were given. The server resolves it, and the answer replaces the raw
   * input with the actual offer, so nobody is left guessing whether the code
   * took. Only one code can be live at a time: applying another replaces this.
   */
  const handleApplyPromo = async () => {
    const code = promoInput.trim();
    if (!code) return;

    setApplyingPromo(true);
    setPromoError("");
    const res = await previewOrderCode({ code, subtotal, tableId });
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

  const handlePlaceOrder = async () => {
    setIsLoading(true);
    setLocationNote(null);
    try {
      // The guest's variant/modifier choices travel with the line.
      // Prices are NOT sent: the server re-prices from the live menu.
      const mappedItems = items.map((i) => ({
        menuItemId: i.menuItem.id,
        quantity: i.quantity,
        variantId: i.variantId,
        modifiers: (i.modifiers || []).map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
        notes: i.notes,
      }));

      // Ask once, before the order goes out. A denial is not fatal.
      const locationOutcome = await requestCustomerLocation();
      const location = locationOutcome.location;
      const { participantId } = useSessionStore.getState();

      /**
       * Send the order, opening a fresh session if this one has ended.
       *
       * The session actually sent is the one `ensureSession` verified, not a
       * second copy read from the cart store — the two could disagree, and the
       * stale one produced "a valid dining session is required to place an
       * order" for a guest who had done nothing wrong. If the server still says
       * the session is over, the remembered one is dropped and the whole thing
       * is retried once against a session opened on the spot.
       */
      const submit = async (sessionForOrder: string | null | undefined) =>
        createOrder(
          tableId,
          mappedItems,
          notes,
          sessionForOrder ?? undefined,
          participantId,
          clientRequestId,
          location,
          appliedPromo?.kind === "coupon" ? appliedPromo.code : null,
          appliedPromo?.kind === "voucher" ? appliedPromo.code : null
        );

      let res: Awaited<ReturnType<typeof submit>>;
      try {
        res = await submit(ensuredSession?.sessionId || sessionId);
      } catch (firstError: unknown) {
        const err = firstError as { response?: { status?: number; data?: { message?: string } }; message?: string };
        const isEndedSession =
          err.response?.status === 409 ||
          /session has ended|dining session is required/i.test(thrownMessage(err, ""));

        if (!isEndedSession) throw firstError;

        useSessionStore.getState().clearActiveSession();
        setSessionId(null);
        const fresh = await ensureSession();
        if (!fresh) {
          throw new Error("This table is not ready for orders yet. Please try again.");
        }
        setEnsuredSession(fresh);
        res = await submit(fresh.sessionId);
      }

      if (res.success) {
        clearCart();
        // A rejected code is a warning, not a failure: keep it visible on the
        // confirmation screen instead of silently dropping the guest's code.
        const notice = res.voucherNotice || res.couponNotice;
        const noticeParam = notice
          ? `&couponNotice=${encodeURIComponent(notice)}`
          : "";
        router.push(`/order/success/${res.orderId}${noticeParam}`);
      }
    } catch (err: unknown) {
      console.error(err);
      const anyErr = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
      if (anyErr.response?.status === 403) {
        setLocationNote(
          anyErr.response?.data?.message ||
            "This order looks like it was placed away from the cafe. Please ask a staff member."
        );
      } else {
        setLocationNote(anyErr.message || "Failed to place order. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const disabled = isLoading || isSessionLocked || !sessionReady;

  // A guest who landed here directly has no history to pop, so prefer the table
  // menu they came from and only fall back to history when that is unknown.
  const goBack = () => {
    if (tableId) {
      router.push(`/table/${tableId}`);
      return;
    }
    router.back();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background pb-24">
      <main className="flex-1 w-full max-w-[560px] mx-auto px-margin-mobile py-md flex flex-col gap-md">
        {/* Title */}
        <header>
          <button
            type="button"
            onClick={goBack}
            aria-label="Back to menu"
            className="-ml-1 mb-xs grid h-9 w-9 place-items-center rounded-full text-on-surface-variant transition-opacity hover:opacity-70 active:scale-95 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
          <h1 className="text-headline-md md:text-headline-lg font-semibold text-on-surface">
            One last look
          </h1>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Quick review before we send it to the kitchen
          </p>
        </header>

        {/* Who it's for */}
        {savedCustomerName && (
          <div className="flex items-center gap-md rounded-2xl bg-accent-mint-container px-md py-md">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-on-surface font-semibold"
            >
              {savedCustomerName.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-body-lg font-semibold text-on-surface truncate">
                {savedCustomerName}
              </p>
              {savedCustomerEmail && (
                <p className="flex items-center gap-1 text-body-sm text-on-surface-variant truncate">
                  <span className="material-symbols-outlined text-[14px] text-success">check</span>
                  {savedCustomerEmail}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Seating */}
        <div className="flex items-center gap-md rounded-2xl bg-success-container px-md py-md">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-container-lowest"
          >
            <span className="material-symbols-outlined text-[20px] text-success">location_on</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-wider font-semibold text-on-success-container">
              Dine-in
            </p>
            <p className="text-body-lg font-semibold text-on-surface">
              {tableNumber !== null && tableNumber !== 0 ? `T-${tableNumber}` : "Your table"}
            </p>
          </div>
          <span className="material-symbols-outlined text-[20px] text-success">check</span>
        </div>

        {/* Order lines */}
        <section className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
          <h2 className="mb-sm text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Your order · {itemCount} {itemCount === 1 ? "item" : "items"}
          </h2>

          <div className="flex flex-col gap-md">
            {items.map((item) => {
              const isVeg = item.menuItem.dietaryTags?.[0] === "veg";
              return (
                <div key={cartLineKey(item)} className="flex items-start gap-sm">
                  <span aria-hidden="true" className="mt-1 shrink-0 grid h-3 w-3 place-items-center">
                    <span
                      className={`block h-2.5 w-2.5 border-[1.5px] ${
                        isVeg ? "border-success rounded-[2px]" : "border-error"
                      }`}
                    >
                      {isVeg ? (
                        <span className="block m-auto h-1 w-1 rounded-full bg-success" />
                      ) : (
                        <span className="block m-auto h-0 w-0 border-x-[3px] border-x-transparent border-b-[5px] border-b-error" />
                      )}
                    </span>
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-body-md font-semibold text-on-surface leading-snug">
                      {item.menuItem.name}
                    </p>
                    {[item.variantName, (item.modifiers || []).map((m) => m.optionName).join(", ")]
                      .filter(Boolean)
                      .map((line) => (
                        <p key={line} className="text-body-sm text-on-surface-variant">
                          {line}
                        </p>
                      ))}
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-body-sm text-on-surface-variant tabular-nums">
                      × {item.quantity}
                    </p>
                    <p className="text-body-md font-semibold text-on-surface tabular-nums">
                      {formatCurrency(
                        Number(item.unitPrice ?? item.menuItem.price) * item.quantity
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Cooking instructions */}
        <section className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
          <div className="flex items-center justify-between mb-sm">
            <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px]">chat</span>
              Cooking instructions
            </h2>
            <span className="text-[11px] text-on-surface-variant">Optional</span>
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. less spicy, no onion, jain style…"
            aria-label="Cooking instructions"
            className="w-full resize-none bg-transparent text-body-md text-on-surface placeholder:text-on-surface-variant/60 outline-none"
          />
        </section>

        {/* Coupon */}
        <section className="rounded-2xl border border-primary bg-surface-container-lowest p-md">
          <button
            type="button"
            onClick={() => setShowCoupon((v) => !v)}
            aria-expanded={showCoupon}
            className="flex w-full items-center gap-md text-left"
          >
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-container"
            >
              <span className="material-symbols-outlined text-[18px] text-primary">sell</span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-md font-semibold text-on-surface">
                Have a code?
              </span>
              <span className="block text-body-sm text-on-surface-variant">
                Coupons and reward codes both go here
              </span>
            </span>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
              chevron_right
            </span>
          </button>

          {showCoupon && (
            <div className="mt-sm flex flex-col gap-sm">
              <div className="flex gap-sm">
                <input
                  value={promoInput}
                  onChange={(e) => {
                    setPromoInput(e.target.value.toUpperCase());
                    // Editing after applying invalidates the applied offer — the
                    // saving on screen must always describe the code in the box.
                    if (appliedPromo) setAppliedPromo(null);
                    setPromoError("");
                  }}
                  placeholder="e.g. FIRST50 or RWD-9F2C11"
                  aria-label="Coupon or reward code"
                  className="flex-1 h-11 rounded-xl bg-surface-container-low px-sm text-body-md uppercase text-on-surface outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleApplyPromo}
                  disabled={applyingPromo || !promoInput.trim()}
                  className="h-11 shrink-0 rounded-xl bg-primary px-md text-body-sm font-semibold text-on-primary disabled:opacity-40"
                >
                  {applyingPromo ? "Checking…" : "Apply"}
                </button>
              </div>

              {promoError && (
                <p className="text-[11px] leading-snug text-error">{promoError}</p>
              )}

              {appliedPromo && (
                <div className="flex items-start justify-between gap-sm rounded-xl bg-surface-container-low px-sm py-xs">
                  <div className="min-w-0">
                    <span className="block text-body-sm font-semibold text-on-surface">
                      {appliedPromo.title} applied
                    </span>
                    <span className="block text-[11px] leading-snug text-on-surface-variant">
                      {appliedPromo.message}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearPromo}
                    aria-label="Remove code"
                    className="shrink-0 text-on-surface-variant hover:text-on-surface"
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </div>
              )}

              {!appliedPromo && !promoError && (
                <p className="text-[11px] leading-snug text-on-surface-variant">
                  One code per order. We will tell you what it saves before you
                  place it.
                </p>
              )}
            </div>
          )}
        </section>

        {/* Bill summary */}
        <section className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
          <h2 className="mb-sm text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
            Bill summary
          </h2>

          <div className="flex items-center justify-between text-body-md text-on-surface">
            <span>Item total</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>

          {appliedPromo && promoSaving > 0 && (
            <div className="mt-1 flex items-center justify-between text-body-sm text-primary">
              <span className="truncate pr-sm">
                {appliedPromo.title} · {appliedPromo.code}
              </span>
              <span className="tabular-nums">−{formatCurrency(promoSaving)}</span>
            </div>
          )}

          {totalGST > 0 && (
            <div className="mt-1 flex items-center justify-between text-body-sm text-on-surface-variant">
              <span>GST</span>
              <span className="tabular-nums">{formatCurrency(totalGST)}</span>
            </div>
          )}

          <div className="my-sm border-t border-dashed border-surface-container-high" />

          <div className="flex items-center justify-between">
            <span className="text-body-lg font-semibold text-on-surface">Grand total</span>
            <span className="text-body-lg font-semibold text-on-surface tabular-nums">
              {formatCurrency(appliedPromo ? payableTotal : total)}
            </span>
          </div>

          {appliedPromo && promoSaving > 0 && (
            <p className="mt-xs text-[11px] leading-snug text-on-surface-variant">
              You save {formatCurrency(promoSaving)} on this order.
            </p>
          )}
        </section>

        {isSessionLocked && (
          <div className="flex items-start gap-2 rounded-xl bg-warning-container px-md py-sm text-body-sm text-on-warning-container">
            <span className="material-symbols-outlined text-[18px]">lock</span>
            <span>This table is settling the bill. Additional orders can&apos;t be placed.</span>
          </div>
        )}

        {locationNote && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-error-container px-md py-sm text-body-sm text-on-error-container"
          >
            <span className="material-symbols-outlined text-[18px]">error</span>
            <span>{locationNote}</span>
          </div>
        )}
      </main>

      {/* Pinned action — stays in thumb reach on mobile */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-surface-container bg-surface-container-lowest pb-safe">
        <div className="max-w-[560px] mx-auto px-margin-mobile py-sm">
          <button
            type="button"
            onClick={handlePlaceOrder}
            disabled={disabled}
            className="flex h-14 w-full items-center justify-between rounded-xl bg-primary px-md text-on-primary active:scale-[0.99] transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="flex items-center gap-2 text-body-md font-semibold">
              <span className="material-symbols-outlined text-[18px]">check</span>
              {isSessionLocked
                ? "Table locked"
                : isLoading
                  ? "Placing order…"
                  : "Place order"}
            </span>
            <span className="flex items-center gap-1 text-body-md font-semibold">
              {formatCurrency(total)}
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </span>
          </button>

          <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-on-surface-variant">
            <span className="material-symbols-outlined text-[12px]">lock</span>
            Secure checkout
          </p>
        </div>
      </div>
    </div>
  );
}