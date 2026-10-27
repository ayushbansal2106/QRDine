"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useTransition } from "react";
import { Customer, ScratchCampaign, ScratchCard, ScratchPrize } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { fetchScratchCards, revealScratchCard, saveScratchCampaign } from "@/actions/scratch";

interface ScratchClientProps {
  initialCampaign: ScratchCampaign | null;
  initialCards: ScratchCard[];
}

const defaultCampaign: ScratchCampaign = {
  name: "Scratch & Win",
  isActive: false,
  prizes: [
    { label: "Better luck next time", type: "none", value: 0, weight: 70, stock: 0, claimed: 0 },
    { label: "₹50 off", type: "flat_off", value: 50, weight: 20, stock: 0, claimed: 0 },
    { label: "Free coffee", type: "free_item", value: 0, weight: 10, stock: 5, claimed: 0 },
  ],
  eligibleMinSpend: 0,
  maxCardsPerDay: 0,
  maxCardsPerCustomer: 0,
  voucherValidDays: 15,
};

const customerOf = (card: ScratchCard): Customer | null =>
  typeof card.customerId === "object" && card.customerId !== null ? (card.customerId as Customer) : null;

const PRIZE_LABEL: Record<string, string> = {
  flat_off: "Flat ₹ off",
  percent_off: "% off",
  free_item: "Free item",
  none: "No win",
};

export const ScratchClient: React.FC<ScratchClientProps> = ({ initialCampaign, initialCards }) => {
  const [campaign, setCampaign] = useState<ScratchCampaign>(initialCampaign || defaultCampaign);
  const [cards, setCards] = useState<ScratchCard[]>(initialCards);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const updatePrize = (index: number, patch: Partial<ScratchPrize>) => {
    setCampaign((p) => ({
      ...p,
      prizes: p.prizes.map((pr, i) => (i === index ? { ...pr, ...patch } : pr)),
    }));
  };

  const addPrize = () => {
    setCampaign((p) => ({
      ...p,
      prizes: [...p.prizes, { label: "New prize", type: "flat_off", value: 25, weight: 10, stock: 0, claimed: 0 }],
    }));
  };

  const removePrize = (index: number) => {
    setCampaign((p) => ({ ...p, prizes: p.prizes.filter((_, i) => i !== index) }));
  };

  const totalWeight = campaign.prizes.reduce((sum, p) => sum + (Number(p.weight) || 0), 0);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (campaign.prizes.length === 0) {
      setMessage({ type: "error", text: "Add at least one prize." });
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveScratchCampaign(campaign);
        setCampaign(res.campaign);
        setMessage({ type: "success", text: "Campaign saved." });
      } catch (err: unknown) {
        setMessage({ type: "error", text: thrownMessage(err, "Failed to save campaign.") });
      }
    });
  };

  const reloadCards = () => {
    startTransition(async () => {
      const res = await fetchScratchCards({ limit: 50 });
      if (res.success) setCards(res.cards);
    });
  };

  const handleReveal = (card: ScratchCard) => {
    if (!confirm(`Reveal this card on behalf of ${customerOf(card)?.name || "the customer"}?`)) return;
    startTransition(async () => {
      try {
        await revealScratchCard(card._id);
        reloadCards();
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to reveal card."));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Scratch Cards" iconName="casino" />

      <main className="flex-1 p-md lg:p-lg max-w-[1100px] w-full mx-auto flex flex-col gap-lg">
        {/* Campaign config */}
        <form onSubmit={handleSave} className="bg-surface-container-lowest rounded-xl p-md border border-surface-container">
          <div className="flex items-center justify-between pb-sm mb-md border-b border-surface-container">
            <div>
              <h3 className="font-inter font-semibold text-body-lg text-on-surface">Campaign & Prize Pool</h3>
              <p className="font-inter text-body-sm text-on-surface-variant">
                Odds are computed from prize weights and only applied server-side.
              </p>
            </div>
            <label className="flex items-center gap-xs font-inter text-body-sm text-on-surface cursor-pointer">
              <input
                type="checkbox"
                checked={campaign.isActive}
                onChange={(e) => setCampaign((p) => ({ ...p, isActive: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              Active
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Campaign name</label>
              <input
                value={campaign.name}
                onChange={(e) => setCampaign((p) => ({ ...p, name: e.target.value }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Min spend (₹)</label>
              <input
                type="number"
                min="0"
                value={campaign.eligibleMinSpend}
                onChange={(e) => setCampaign((p) => ({ ...p, eligibleMinSpend: Number(e.target.value) || 0 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Max cards / day (0=∞)</label>
              <input
                type="number"
                min="0"
                value={campaign.maxCardsPerDay}
                onChange={(e) => setCampaign((p) => ({ ...p, maxCardsPerDay: Number(e.target.value) || 0 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Voucher valid (days)</label>
              <input
                type="number"
                min="1"
                value={campaign.voucherValidDays}
                onChange={(e) => setCampaign((p) => ({ ...p, voucherValidDays: Number(e.target.value) || 15 }))}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {/* Prize pool */}
          <div className="mt-md pt-md border-t border-surface-container">
            <div className="flex items-center justify-between mb-sm">
              <h4 className="font-inter font-semibold text-body-md text-on-surface">Prizes</h4>
              <Button variant="ghost" onClick={addPrize} className="h-9 px-sm">
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add prize
              </Button>
            </div>

            <div className="flex flex-col gap-xs">
              {campaign.prizes.map((prize, i) => (
                <div key={i} className="grid grid-cols-1 md:grid-cols-[1.6fr_1fr_0.8fr_0.8fr_auto] gap-xs items-center">
                  <input
                    value={prize.label}
                    onChange={(e) => updatePrize(i, { label: e.target.value })}
                    placeholder="Prize label"
                    className="h-10 bg-surface-container-low rounded-lg px-sm font-inter text-body-sm text-on-surface border-none focus:ring-1 focus:ring-primary outline-none"
                  />
                  <select
                    value={prize.type}
                    onChange={(e) => updatePrize(i, { type: e.target.value as ScratchPrize["type"] })}
                    className="h-10 bg-surface-container-low rounded-lg px-sm font-inter text-body-sm text-on-surface border-none focus:ring-1 focus:ring-primary outline-none"
                  >
                    {Object.entries(PRIZE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={prize.value}
                    onChange={(e) => updatePrize(i, { value: Number(e.target.value) || 0 })}
                    placeholder="Value"
                    className="h-10 bg-surface-container-low rounded-lg px-sm font-inter text-body-sm text-on-surface border-none focus:ring-1 focus:ring-primary outline-none"
                  />
                  <input
                    type="number"
                    min="0"
                    value={prize.weight}
                    onChange={(e) => updatePrize(i, { weight: Number(e.target.value) || 0 })}
                    placeholder="Weight"
                    title="Relative weight (odds)"
                    className="h-10 bg-surface-container-low rounded-lg px-sm font-inter text-body-sm text-on-surface border-none focus:ring-1 focus:ring-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removePrize(i)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                </div>
              ))}
            </div>
            <p className="font-inter text-label-sm text-on-surface-variant mt-sm">
              Total weight {totalWeight}
              {totalWeight > 0
                ? ` · e.g. ${Math.round(((campaign.prizes[0]?.weight || 0) / totalWeight) * 100)}% for the first prize`
                : ""}
            </p>
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
              {isPending ? "Saving..." : "Save Campaign"}
            </Button>
          </div>
        </form>

        {/* Cards */}
        <div>
          <h3 className="font-inter font-semibold text-body-lg text-on-surface mb-sm">Issued Cards</h3>
          {cards.length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container py-xl text-center">
              <span className="material-symbols-outlined text-[44px] text-on-surface-variant/40">casino</span>
              <p className="font-inter text-body-sm text-on-surface-variant mt-xs">
                No cards issued yet. A card is issued automatically on settled orders that meet the minimum spend.
              </p>
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
              <div className="hidden md:grid grid-cols-[1.6fr_1.2fr_1.6fr_1fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
                {["Customer", "Status", "Prize", "Actions"].map((h) => (
                  <span key={h} className="font-inter font-semibold text-label-sm text-on-surface-variant">
                    {h}
                  </span>
                ))}
              </div>
              {cards.map((card) => {
                const customer = customerOf(card);
                return (
                  <div
                    key={card._id}
                    className="grid grid-cols-1 md:grid-cols-[1.6fr_1.2fr_1.6fr_1fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 items-center"
                  >
                    <div className="flex flex-col">
                      <span className="font-inter text-body-sm font-semibold text-on-surface">
                        {customer?.name || "Unknown"}
                      </span>
                      <span className="font-inter text-label-sm text-on-surface-variant">{customer?.phone || ""}</span>
                    </div>
                    <span
                      className={`inline-flex w-fit items-center px-sm py-0.5 rounded-full text-label-sm font-semibold ${
                        card.status === "issued"
                          ? "bg-warning-container text-warning"
                          : card.status === "revealed"
                            ? "bg-success-container text-success"
                            : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {card.status === "issued" ? "Unrevealed" : card.status}
                    </span>
                    <div className="flex flex-col">
                      <span className="font-inter text-body-sm text-on-surface">
                        {card.status === "revealed" ? card.prize?.label || "—" : "Hidden until revealed"}
                      </span>
                      {card.voucherCode && (
                        <span className="font-inter text-label-sm text-primary font-mono">{card.voucherCode}</span>
                      )}
                    </div>
                    <div className="flex justify-end">
                      {card.status === "issued" && (
                        <button
                          onClick={() => handleReveal(card)}
                          disabled={isPending}
                          className="px-sm h-8 rounded-lg bg-primary text-on-primary font-inter text-label-sm cursor-pointer disabled:opacity-40"
                        >
                          Reveal
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ScratchClient;
