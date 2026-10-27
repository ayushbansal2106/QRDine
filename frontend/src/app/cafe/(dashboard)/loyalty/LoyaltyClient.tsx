"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useCallback, useState, useTransition } from "react";
import { Customer, LoyaltyCard, LoyaltyProgram, type RewardType } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import {
  adjustCustomerStamps,
  fetchLoyaltyCards,
  redeemVoucher,
  saveLoyaltyProgram,
  validateVoucher,
} from "@/actions/loyalty";

interface LoyaltyClientProps {
  initialProgram: LoyaltyProgram | null;
  initialCards: LoyaltyCard[];
}

const emptyProgram: LoyaltyProgram = {
  name: "Loyalty Card",
  isActive: true,
  stampsRequired: 5,
  minSpend: 0,
  qualifyingScope: "all",
  qualifyingItemIds: [],
  qualifyingCategoryIds: [],
  stampsPerOrder: 1,
  reward: { type: "flat_off", value: 50, menuItemId: null, label: "Reward unlocked" },
  voucherValidDays: 30,
};

const customerOf = (card: LoyaltyCard): Customer | null =>
  typeof card.customerId === "object" && card.customerId !== null ? (card.customerId as Customer) : null;

export const LoyaltyClient: React.FC<LoyaltyClientProps> = ({ initialProgram, initialCards }) => {
  const [program, setProgram] = useState<LoyaltyProgram>(initialProgram || emptyProgram);
  const [cards, setCards] = useState<LoyaltyCard[]>(initialCards);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Adjustment modal
  const [adjustTarget, setAdjustTarget] = useState<LoyaltyCard | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("1");
  const [adjustNote, setAdjustNote] = useState("");

  // Voucher redemption tool
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherMsg, setVoucherMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const reloadCards = useCallback((term: string) => {
    startTransition(async () => {
      const res = await fetchLoyaltyCards({ search: term, limit: 50 });
      if (res.success) setCards(res.cards);
    });
  }, []);

  const handleSaveProgram = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await saveLoyaltyProgram(program);
        setProgram(res.program);
        setMessage({ type: "success", text: "Loyalty program saved." });
      } catch (err: unknown) {
        setMessage({ type: "error", text: thrownMessage(err, "Failed to save program.") });
      }
    });
  };

  const handleAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const customer = customerOf(adjustTarget);
    if (!customer) return;

    startTransition(async () => {
      try {
        await adjustCustomerStamps(customer._id, Number(adjustDelta), adjustNote);
        setAdjustTarget(null);
        setAdjustDelta("1");
        setAdjustNote("");
        reloadCards(search);
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to adjust stamps."));
      }
    });
  };

  const handleValidateVoucher = () => {
    setVoucherMsg(null);
    startTransition(async () => {
      const res = await validateVoucher(voucherCode);
      if (res.success) {
        setVoucherMsg({
          type: "success",
          text: `${res.voucher.label} · ${res.voucher.type === "percent_off" ? `${res.voucher.value}% off` : `₹${res.voucher.value} off`}`,
        });
      } else {
        setVoucherMsg({ type: "error", text: res.message || "Invalid voucher." });
      }
    });
  };

  const handleRedeemVoucher = () => {
    setVoucherMsg(null);
    startTransition(async () => {
      try {
        const res = await redeemVoucher(voucherCode);
        setVoucherMsg({ type: "success", text: `Redeemed ${res.voucher.code}.` });
        setVoucherCode("");
        reloadCards(search);
      } catch (err: unknown) {
        setVoucherMsg({ type: "error", text: thrownMessage(err, "Failed to redeem voucher.") });
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Loyalty" iconName="loyalty" />

      <main className="flex-1 p-md lg:p-lg max-w-[1100px] w-full mx-auto flex flex-col gap-lg">
        {/* Program config */}
        <form onSubmit={handleSaveProgram} className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
          <div className="flex items-center justify-between pb-sm mb-md border-b border-surface-container">
            <div>
              <h3 className="font-inter font-semibold text-body-lg text-on-surface">Stamp Program</h3>
              <p className="font-inter text-body-sm text-on-surface-variant">
                Customers earn stamps on settled orders and unlock rewards.
              </p>
            </div>
            <label className="flex items-center gap-xs font-inter text-body-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={program.isActive}
                onChange={(e) => setProgram((p) => ({ ...p, isActive: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              Enabled
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Program name</label>
              <input
                value={program.name}
                onChange={(e) => setProgram((p) => ({ ...p, name: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Stamps required</label>
              <input
                type="number"
                min="1"
                value={program.stampsRequired}
                onChange={(e) => setProgram((p) => ({ ...p, stampsRequired: Number(e.target.value) || 1 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Stamps per order</label>
              <input
                type="number"
                min="1"
                value={program.stampsPerOrder}
                onChange={(e) => setProgram((p) => ({ ...p, stampsPerOrder: Number(e.target.value) || 1 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Min spend (₹)</label>
              <input
                type="number"
                min="0"
                value={program.minSpend}
                onChange={(e) => setProgram((p) => ({ ...p, minSpend: Number(e.target.value) || 0 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-md mt-md">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Reward type</label>
              <select
                value={program.reward.type}
                onChange={(e) =>
                  setProgram((p) => ({ ...p, reward: { ...p.reward, type: e.target.value as RewardType } }))
                }
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="flat_off">Flat amount off</option>
                <option value="percent_off">Percent off</option>
                <option value="free_item">Free item</option>
              </select>
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Reward value</label>
              <input
                type="number"
                min="0"
                value={program.reward.value}
                onChange={(e) =>
                  setProgram((p) => ({ ...p, reward: { ...p.reward, value: Number(e.target.value) || 0 } }))
                }
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Reward label</label>
              <input
                value={program.reward.label}
                onChange={(e) => setProgram((p) => ({ ...p, reward: { ...p.reward, label: e.target.value } }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Voucher valid (days)</label>
              <input
                type="number"
                min="1"
                value={program.voucherValidDays}
                onChange={(e) => setProgram((p) => ({ ...p, voucherValidDays: Number(e.target.value) || 30 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {message && (
            <div
              className={`mt-md px-md py-sm rounded-lg text-body-sm font-semibold flex items-center gap-xs ${
                message.type === "success" ? "bg-success-container text-success" : "bg-error-container text-on-error-container"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {message.type === "success" ? "check_circle" : "error"}
              </span>
              {message.text}
            </div>
          )}

          <div className="flex justify-end mt-md">
            <Button type="submit" variant="primary" disabled={isPending} className="h-10 px-lg">
              {isPending ? "Saving..." : "Save Program"}
            </Button>
          </div>
        </form>

        {/* Voucher redemption tool */}
        <div className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">Redeem Reward Voucher</h3>
          <div className="flex flex-wrap items-end gap-sm">
            <div className="flex flex-col gap-xs flex-1 min-w-[220px]">
              <label className="font-inter font-semibold text-label-md text-on-surface">Voucher code</label>
              <input
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                placeholder="RWD-XXXXXX"
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md font-mono text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <Button variant="ghost" onClick={handleValidateVoucher} disabled={isPending || !voucherCode} className="h-11 px-md">
              Validate
            </Button>
            <Button variant="primary" onClick={handleRedeemVoucher} disabled={isPending || !voucherCode} className="h-11 px-md">
              Redeem
            </Button>
          </div>
          {voucherMsg && (
            <div
              className={`mt-sm px-md py-sm rounded-lg text-body-sm font-semibold flex items-center gap-xs ${
                voucherMsg.type === "success" ? "bg-success-container text-success" : "bg-error-container text-on-error-container"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {voucherMsg.type === "success" ? "check_circle" : "error"}
              </span>
              {voucherMsg.text}
            </div>
          )}
        </div>

        {/* Cards */}
        <div>
          <div className="flex items-center justify-between gap-sm mb-sm flex-wrap">
            <h3 className="font-inter font-semibold text-body-lg text-on-surface">Loyalty Cards</h3>
            <div className="flex items-center gap-sm bg-surface-container-low rounded-xl px-md h-10 max-w-[280px] flex-1">
              <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  reloadCards(e.target.value);
                }}
                placeholder="Search member"
                className="flex-1 bg-transparent border-none outline-none font-inter text-body-sm text-on-surface placeholder-on-surface-variant/50"
              />
            </div>
          </div>

          {cards.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container py-xl text-center">
              <span className="material-symbols-outlined text-[44px] text-on-surface-variant/40">loyalty</span>
              <p className="font-inter text-body-sm text-on-surface-variant mt-xs">
                No loyalty cards yet. Stamps are issued automatically on settled orders with a linked phone number.
              </p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
              <div className="hidden md:grid grid-cols-[1.6fr_1.4fr_1fr_1.4fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
                {["Member", "Stamps", "Lifetime", "Actions"].map((h) => (
                  <span key={h} className="font-inter font-semibold text-label-sm text-on-surface-variant">
                    {h}
                  </span>
                ))}
              </div>
              {cards.map((card) => {
                const customer = customerOf(card);
                const req = program.stampsRequired || 1;
                const pct = Math.min(100, Math.round((card.stamps / req) * 100));
                const activeVouchers = (card.vouchers || []).filter((v) => v.status === "active");
                return (
                  <div
                    key={card._id}
                    className="grid grid-cols-1 md:grid-cols-[1.6fr_1.4fr_1fr_1.4fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 items-center"
                  >
                    <div className="flex flex-col">
                      <span className="font-inter text-body-sm font-semibold text-on-surface">
                        {customer?.name || "Unknown"}
                      </span>
                      <span className="font-inter text-label-sm text-on-surface-variant">{customer?.phone || ""}</span>
                    </div>
                    <div className="flex flex-col gap-xs">
                      <div className="flex items-center gap-xs">
                        <div className="flex-1 h-2 bg-surface-container rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="font-inter text-label-sm text-on-surface">
                          {card.stamps}/{req}
                        </span>
                      </div>
                      {activeVouchers.length > 0 && (
                        <span className="font-inter text-label-sm text-success">
                          {activeVouchers.length} active voucher(s)
                        </span>
                      )}
                    </div>
                    <span className="font-inter text-body-sm text-on-surface-variant">{card.lifetimeStamps}</span>
                    <div className="flex items-center gap-xs justify-end">
                      <button
                        onClick={() => {
                          setAdjustTarget(card);
                          setAdjustDelta("1");
                          setAdjustNote("");
                        }}
                        className="px-sm h-8 rounded-lg bg-surface-container-low hover:bg-surface-container font-inter text-label-sm text-on-surface cursor-pointer"
                      >
                        Adjust stamps
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Adjust stamps modal */}
      <Modal isOpen={adjustTarget !== null} onClose={() => setAdjustTarget(null)} title="Adjust Stamps">
        <form onSubmit={handleAdjust} className="flex flex-col gap-md">
          <p className="font-inter text-body-sm text-on-surface-variant">
            Manually add or remove stamps for{" "}
            <strong className="text-on-surface">{adjustTarget ? customerOf(adjustTarget)?.name : ""}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Change (use - for removal)</label>
              <input
                type="number"
                required
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Reason</label>
              <input
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="e.g. goodwill"
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-sm">
            <Button variant="ghost" onClick={() => setAdjustTarget(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : "Apply"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default LoyaltyClient;
