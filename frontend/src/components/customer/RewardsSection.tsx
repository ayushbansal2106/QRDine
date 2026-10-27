"use client";

import React, { useEffect, useState } from "react";
import {
  fetchMyLoyalty,
  claimMyReward,
  fetchMyWallet,
  fetchMyWallets,
  fetchMyScratchCards,
  revealMyScratchCard,
  fetchMyCoupons,
  type LoyaltySummary,
  type CustomerWalletCard,
} from "@/actions/customerApp";
import { formatCurrency } from "@/utils/currency";
import { toast } from "@/components/ui/Toast";
import { Modal } from "@/components/common/Modal";

type ScratchCardItem = {
  id: string;
  status: string;
  createdAt: string;
  revealedAt: string | null;
  prize: { label: string; type: string; value: number } | null;
};

type CouponItem = {
  code: string;
  label: string;
  description: string;
  type: string;
  value: number;
  minOrderValue: number;
  validUntil: string | null;
  used: number;
  usageLimit: number | null;
  /** A code sent to this customer alone, rather than a shared campaign code. */
  personal?: boolean;
};

const Card: React.FC<{
  title: string;
  icon: string;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className="rounded-2xl border border-surface-container bg-surface-container-lowest p-md">
    <div className="flex items-center gap-xs mb-sm">
      <span className="material-symbols-outlined text-primary text-[18px]">{icon}</span>
      <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant/80">
        {title}
      </span>
    </div>
    {children}
  </div>
);

/**
 * Stamps, wallet, scratch cards and offers, inline on the profile.
 *
 * Each card states what it would show even when it is empty. A café with a
 * loyalty program that has not been switched on is a *different* situation from
 * a customer who has earned nothing, and a bare "—" would read as the second —
 * which is how a customer concludes they are being short-changed when the
 * program simply is not running.
 */
export const RewardsSection: React.FC = () => {
  const [loyalty, setLoyalty] = useState<LoyaltySummary | null>(null);
  const [loyaltyLoaded, setLoyaltyLoaded] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  const [wallets, setWallets] = useState<CustomerWalletCard[]>([]);
  const [cards, setCards] = useState<ScratchCardItem[]>([]);
  const [campaignLive, setCampaignLive] = useState(false);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimedVoucher, setClaimedVoucher] = useState<LoyaltySummary["vouchers"][number] | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const [loyaltyError, setLoyaltyError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [scratchError, setScratchError] = useState("");
  const [couponsError, setCouponsError] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Each card is independent — one failing endpoint must not blank the rest.
    fetchMyLoyalty().then((res) => {
      if (cancelled) return;
      setLoyaltyLoaded(true);
      setLoyaltyError(res.success ? "" : res.message || "");
      setLoyalty(res.loyalty);
    });

    fetchMyWallets().then((res) => {
      if (cancelled) return;
      setWalletError(res.success ? "" : res.message || "");
      if (res.success && res.wallets.length > 0) {
        setWallets(res.wallets);
        const active = res.wallets.find((w) => w.isActiveHere);
        setBalance(active ? active.balance : res.wallets[0].balance);
      }
    });

    fetchMyScratchCards().then((res) => {
      if (cancelled) return;
      setScratchError(res.success ? "" : res.message || "");
      setCards(res.cards);
      setCampaignLive(res.campaignLive);
    });

    fetchMyCoupons().then((res) => {
      if (cancelled) return;
      setCouponsError(res.success ? "" : res.message || "");
      setCoupons(res.coupons);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Trade the completed stamp set for a code.
   *
   * The dialog is the receipt: the code is the only thing the customer can act
   * on afterwards, so it is shown in full with a copy button rather than left on
   * the profile where it would have to be remembered.
   */
  const handleClaim = async () => {
    setClaiming(true);
    const res = await claimMyReward();
    setClaiming(false);

    if (!res.success || !res.voucher) {
      toast(res.message || "Could not claim this reward.", "error");
      // The card may have moved underneath the button (a stamp posted while the
      // screen was open), so re-read rather than leaving a stale count.
      const fresh = await fetchMyLoyalty();
      if (fresh.success) setLoyalty(fresh.loyalty);
      return;
    }

    setClaimedVoucher(res.voucher);
    const fresh = await fetchMyLoyalty();
    if (fresh.success) setLoyalty(fresh.loyalty);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Could not copy — write the code down instead.", "neutral");
    }
  };

  const handleReveal = async (card: ScratchCardItem) => {
    setRevealingId(card.id);
    const res = await revealMyScratchCard(card.id);
    setRevealingId(null);

    if (!res.success) {
      toast(res.message || "Could not reveal that card.", "error");
      return;
    }

    const label = res.prize?.label || "Better luck next time";
    toast(
      res.voucher ? `${label} — code ${res.voucher.code}` : label,
      res.voucher ? "success" : "neutral"
    );

    // Re-read rather than patching locally: revealing can also issue a voucher
    // onto the loyalty card, so the prizes list is no longer the whole story.
    const [scratch, loyaltyRes] = await Promise.all([fetchMyScratchCards(), fetchMyLoyalty()]);
    setCards(scratch.cards);
    setCampaignLive(scratch.campaignLive);
    if (loyaltyRes.success) setLoyalty(loyaltyRes.loyalty);
  };

  return (
    <div className="flex flex-col gap-sm">
      {/* Loyalty stamps */}
      <Card title="Loyalty" icon="workspace_premium">
        {loyaltyError ? (
          <p className="text-body-sm text-error">{loyaltyError}</p>
        ) : !loyaltyLoaded ? (
          <p className="text-body-sm text-on-surface-variant">Loading…</p>
        ) : !loyalty ? (
          <p className="text-body-sm text-on-surface-variant">
            This café has no loyalty programme yet.
          </p>
        ) : !loyalty.isActive ? (
          <p className="text-body-sm text-on-surface-variant">
            The loyalty programme is not running right now, so stamps are not
            being collected.
          </p>
        ) : (
          <>
            <p className="font-mono text-headline-md font-semibold text-on-surface">
              {loyalty.stamps}
              <span className="text-body-md font-normal text-on-surface-variant">
                {" "}
                / {loyalty.stampsRequired} stamps
              </span>
            </p>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {loyalty.stampsToNextReward === 0
                ? "You have a reward ready to use at checkout."
                : `${loyalty.stampsToNextReward} more stamp${
                    loyalty.stampsToNextReward === 1 ? "" : "s"
                  } to your next reward · ${
                    loyalty.stampsPerOrder
                  } per order`}
            </p>
            {loyalty.stampsToNextReward === 0 && (
              <button
                type="button"
                onClick={handleClaim}
                disabled={claiming}
                className="mt-sm inline-flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-body-sm font-semibold text-on-primary disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">redeem</span>
                {claiming ? "Claiming…" : "Redeem reward"}
              </button>
            )}
            {loyalty.vouchers.length > 0 && (
              <ul className="mt-sm flex flex-col gap-xs">
                {loyalty.vouchers.map((v) => (
                  <li
                    key={v.code}
                    className="flex items-center justify-between gap-sm rounded-lg bg-surface-container px-sm py-xs"
                  >
                    <span className="min-w-0 text-body-sm text-on-surface truncate">
                      {v.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyCode(v.code)}
                      className="shrink-0 font-mono text-body-sm font-semibold text-primary underline-offset-2 hover:underline"
                      title="Copy code"
                    >
                      {v.code}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {loyalty.vouchers.length > 0 && (
              <p className="mt-xs text-label-sm text-on-surface-variant">
                Use a code at checkout, or show it at the counter.
              </p>
            )}
          </>
        )}
      </Card>

      {/* The claim receipt — the code, and where it can be spent. */}
      {claimedVoucher && (
        <Modal
          isOpen={true}
          onClose={() => setClaimedVoucher(null)}
          title="Reward unlocked"
        >
          <div className="flex flex-col gap-md">
            <p className="text-body-md text-on-surface">
              {claimedVoucher.label} has been added to your account.
            </p>

            <div className="flex flex-col items-center gap-sm p-md rounded-xl bg-surface-container-low">
              <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">
                Your code
              </span>
              <code className="font-mono text-headline-md font-semibold text-primary">
                {claimedVoucher.code}
              </code>
              <button
                type="button"
                onClick={() => copyCode(claimedVoucher.code)}
                className="inline-flex items-center gap-xs rounded-lg border border-surface-container bg-surface-container-lowest px-md py-sm text-body-sm font-semibold text-on-surface"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {copied ? "check" : "content_copy"}
                </span>
                {copied ? "Copied" : "Copy code"}
              </button>
              {claimedVoucher.expiresAt && (
                <span className="text-label-sm text-on-surface-variant">
                  Valid until{" "}
                  {new Date(claimedVoucher.expiresAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              )}
            </div>

            <p className="text-body-sm text-on-surface-variant">
              Type this code when you check out at the table, or show it at the
              counter. Your {claimedVoucher.type === "percent_off"
                ? `${claimedVoucher.value}% off`
                : claimedVoucher.type === "free_item"
                  ? claimedVoucher.label
                  : formatCurrency(claimedVoucher.value)}{" "}
              reward comes off that bill.
            </p>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setClaimedVoucher(null)}
                className="rounded-lg bg-primary px-md py-sm text-body-sm font-semibold text-on-primary"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Wallet — Task 2.5 Multi-Tenant Discovery */}
      <Card title="Wallet" icon="account_balance_wallet">
        {walletError ? (
          <p className="text-body-sm text-error">{walletError}</p>
        ) : (
          <div className="flex flex-col gap-sm">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-headline-md font-semibold text-on-surface">
                  {formatCurrency(balance)}
                </p>
                <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-label-sm font-semibold">
                  Active Here
                </span>
              </div>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                Prepaid balance for this café. Ask staff at the counter to top up.
              </p>
            </div>

            {/* Other Cafe Wallets */}
            {wallets.filter((w) => !w.isActiveHere).length > 0 && (
              <div className="mt-xs pt-sm border-t border-surface-container flex flex-col gap-xs">
                <span className="text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant/70">
                  Other Restaurant Wallets
                </span>
                {wallets
                  .filter((w) => !w.isActiveHere)
                  .map((w) => (
                    <div
                      key={w.cafeId}
                      className="flex items-center justify-between p-sm rounded-xl bg-surface-container-low"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-body-sm text-on-surface">
                          {w.cafeName}
                        </span>
                        <span className="text-label-sm text-on-surface-variant">
                          Redeemable only at {w.cafeName}
                        </span>
                      </div>
                      <span className="font-mono font-semibold text-body-md text-on-surface">
                        {formatCurrency(w.balance)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Scratch cards */}
      <Card title="Scratch cards" icon="card_giftcard">
        {scratchError ? (
          <p className="text-body-sm text-error">{scratchError}</p>
        ) : cards.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            {campaignLive
              ? "No cards yet — one is issued when you settle an order."
              : "This café has no scratch card campaign running."}
          </p>
        ) : (
          <ul className="flex flex-col gap-xs">
            {cards.slice(0, 4).map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-sm rounded-lg bg-surface-container px-sm py-xs"
              >
                <span className="min-w-0 text-body-sm text-on-surface truncate">
                  {card.status === "issued"
                    ? "Tap to scratch"
                    : card.prize?.label || "Revealed"}
                </span>
                {card.status === "issued" ? (
                  <button
                    type="button"
                    onClick={() => handleReveal(card)}
                    disabled={revealingId === card.id}
                    className="shrink-0 rounded-lg bg-primary px-sm py-xs text-body-sm font-semibold text-on-primary disabled:opacity-50"
                  >
                    {revealingId === card.id ? "Revealing…" : "Reveal"}
                  </button>
                ) : (
                  <span className="shrink-0 text-label-sm text-on-surface-variant">
                    {card.revealedAt
                      ? new Date(card.revealedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })
                      : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Coupons */}
      <Card title="Offers" icon="sell">
        {couponsError ? (
          <p className="text-body-sm text-error">{couponsError}</p>
        ) : coupons.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            No offers for you right now. Codes you are sent land here, ready to
            use at the table or at the counter.
          </p>
        ) : (
          <ul className="flex flex-col gap-xs">
            {coupons.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between gap-sm rounded-lg bg-surface-container px-sm py-xs"
              >
                <span className="min-w-0 text-body-sm text-on-surface truncate">
                  {c.label}
                  {c.personal && (
                    <span className="ml-xs text-label-sm text-primary">Just for you</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => copyCode(c.code)}
                  className="shrink-0 font-mono text-body-sm font-semibold text-primary underline-offset-2 hover:underline"
                  title="Copy code"
                >
                  {c.code}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default RewardsSection;
