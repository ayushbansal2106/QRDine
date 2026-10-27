"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useCallback, useState, useTransition } from "react";
import { Customer, Wallet, WalletTransaction } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { fetchWalletDetail, fetchWallets, refundToWallet, topUpWallet } from "@/actions/wallet";

interface WalletsClientProps {
  initialWallets: Wallet[];
}

const customerOf = (wallet: Wallet): Customer | null =>
  typeof wallet.customerId === "object" && wallet.customerId !== null ? (wallet.customerId as Customer) : null;

const money = (value: number) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const TX_LABEL: Record<string, string> = {
  topup: "Top-up",
  bonus: "Bonus",
  payment: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
};

export const WalletsClient: React.FC<WalletsClientProps> = ({ initialWallets }) => {
  const [wallets, setWallets] = useState<Wallet[]>(initialWallets);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const [topUpTarget, setTopUpTarget] = useState<Wallet | null>(null);
  const [amount, setAmount] = useState("500");
  const [bonus, setBonus] = useState("0");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const [detailTarget, setDetailTarget] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const reload = useCallback((term: string) => {
    startTransition(async () => {
      const res = await fetchWallets({ search: term, limit: 50 });
      if (res.success) setWallets(res.wallets);
    });
  }, []);

  const openTopUp = (wallet: Wallet) => {
    setTopUpTarget(wallet);
    setAmount("500");
    setBonus("0");
    setNote("");
    setError("");
  };

  const handleTopUp = (e: React.FormEvent) => {
    e.preventDefault();
    const customer = topUpTarget ? customerOf(topUpTarget) : null;
    if (!customer) return;
    if (!(Number(amount) > 0)) {
      setError("Amount must be greater than 0.");
      return;
    }

    startTransition(async () => {
      try {
        await topUpWallet(customer._id, Number(amount), Number(bonus) || 0, note);
        setTopUpTarget(null);
        reload(search);
      } catch (err: unknown) {
        setError(thrownMessage(err, "Failed to top up wallet."));
      }
    });
  };

  const openDetail = (wallet: Wallet) => {
    const customer = customerOf(wallet);
    if (!customer) return;
    setDetailTarget(wallet);
    setDetailLoading(true);
    startTransition(async () => {
      const res = await fetchWalletDetail(customer._id);
      setTransactions(res.transactions);
      if (res.success && res.wallet) {
        setWallets((prev) => prev.map((w) => (w._id === wallet._id ? { ...w, balance: res.wallet!.balance } : w)));
      }
      setDetailLoading(false);
    });
  };

  const handleRefund = () => {
    const target = detailTarget;
    if (!target) return;
    const customer = customerOf(target);
    if (!customer) return;
    const value = prompt("Refund amount to wallet (₹):", "0");
    if (!value || !(Number(value) > 0)) return;

    startTransition(async () => {
      try {
        await refundToWallet(customer._id, Number(value), "Manager refund");
        openDetail(target);
        reload(search);
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to refund."));
      }
    });
  };

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      <TopAppBar title="Wallets" iconName="account_balance_wallet" />

      <main className="flex-1 p-md lg:p-lg max-w-[1100px] w-full mx-auto flex flex-col gap-md">
        <div className="flex items-center gap-sm bg-surface-container-low rounded-xl px-md h-11 max-w-[360px]">
          <span className="material-symbols-outlined text-[20px] text-on-surface-variant">search</span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reload(e.target.value);
            }}
            placeholder="Search by name, phone or email"
            className="flex-1 bg-transparent border-none outline-none font-inter text-body-md text-on-surface placeholder-on-surface-variant/50"
          />
        </div>

        {wallets.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container py-xl text-center">
            <span className="material-symbols-outlined text-[44px] text-on-surface-variant/40">
              account_balance_wallet
            </span>
            <h3 className="font-inter font-semibold text-body-lg text-on-surface mt-xs">No wallets yet</h3>
            <p className="font-inter text-body-sm text-on-surface-variant">
              Top up a customer&rsquo;s wallet from their profile to get started.
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-surface-container overflow-hidden">
            <div className="hidden md:grid grid-cols-[1.8fr_1fr_1fr_1.2fr] gap-sm px-md py-sm bg-surface-container-low border-b border-surface-container">
              {["Customer", "Balance", "Spent", "Actions"].map((h) => (
                <span key={h} className="font-inter font-semibold text-label-sm text-on-surface-variant">
                  {h}
                </span>
              ))}
            </div>
            {wallets.map((wallet) => {
              const customer = customerOf(wallet);
              return (
                <div
                  key={wallet._id}
                  className="grid grid-cols-1 md:grid-cols-[1.8fr_1fr_1fr_1.2fr] gap-sm px-md py-sm border-b border-surface-container last:border-b-0 items-center hover:bg-surface-container-low/50 transition-colors"
                >
                  <div className="flex flex-col">
                    <span className="font-inter text-body-sm font-semibold text-on-surface">
                      {customer?.name || "Unknown"}
                    </span>
                    <span className="font-inter text-label-sm text-on-surface-variant">{customer?.phone || ""}</span>
                  </div>
                  <span className="font-inter text-body-md font-bold text-primary">{money(wallet.balance)}</span>
                  <span className="font-inter text-body-sm text-on-surface-variant">{money(wallet.totalSpent)}</span>
                  <div className="flex items-center gap-xs justify-end">
                    <button
                      onClick={() => openTopUp(wallet)}
                      className="px-sm h-8 rounded-lg bg-primary text-on-primary font-inter text-label-sm cursor-pointer"
                    >
                      Top up
                    </button>
                    <button
                      onClick={() => openDetail(wallet)}
                      className="px-sm h-8 rounded-lg bg-surface-container-low hover:bg-surface-container font-inter text-label-sm text-on-surface cursor-pointer"
                    >
                      Passbook
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Top-up modal */}
      <Modal isOpen={topUpTarget !== null} onClose={() => setTopUpTarget(null)} title="Top Up Wallet">
        <form onSubmit={handleTopUp} className="flex flex-col gap-md">
          <p className="font-inter text-body-sm text-on-surface-variant">
            Add prepaid credit for{" "}
            <strong className="text-on-surface">{topUpTarget ? customerOf(topUpTarget)?.name : ""}</strong>. Cash /
            manual top-up (no gateway).
          </p>
          <div className="grid grid-cols-2 gap-sm">
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Amount (₹)</label>
              <input
                type="number"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="font-inter font-semibold text-label-md text-on-surface">Bonus (₹, optional)</label>
              <input
                type="number"
                min="0"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
                className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-xs">
            <label className="font-inter font-semibold text-label-md text-on-surface">Note</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
              className="w-full h-11 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface border-none focus:ring-2 focus:ring-primary outline-none"
            />
          </div>
          {error && (
            <div className="bg-error-container text-on-error-container text-body-sm font-inter font-semibold rounded-lg px-md py-sm flex items-center gap-xs">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {error}
            </div>
          )}
          <div className="flex justify-end gap-sm">
            <Button variant="ghost" onClick={() => setTopUpTarget(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Saving..." : "Top Up"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Passbook modal */}
      <Modal isOpen={detailTarget !== null} onClose={() => setDetailTarget(null)} title="Wallet Passbook">
        <div className="flex flex-col gap-md">
          <div className="flex items-center justify-between bg-surface-container-low rounded-xl px-md py-sm">
            <div>
              <p className="font-inter text-label-sm text-on-surface-variant">Balance</p>
              <p className="font-inter font-bold text-headline-lg text-primary">{money(detailTarget?.balance || 0)}</p>
            </div>
            <Button variant="ghost" onClick={handleRefund} disabled={isPending}>
              Refund
            </Button>
          </div>

          {detailLoading ? (
            <div className="flex items-center justify-center py-lg">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="font-inter text-body-sm text-on-surface-variant text-center py-md">No transactions yet.</p>
          ) : (
            <div className="flex flex-col max-h-[320px] overflow-y-auto">
              {transactions.map((tx) => (
                <div
                  key={tx._id}
                  className="flex items-center justify-between py-sm border-b border-surface-container last:border-b-0"
                >
                  <div className="flex flex-col">
                    <span className="font-inter text-body-sm text-on-surface">{TX_LABEL[tx.type] || tx.type}</span>
                    <span className="font-inter text-label-sm text-on-surface-variant">{formatDate(tx.createdAt)}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span
                      className={`font-inter font-semibold text-body-sm ${
                        tx.amount >= 0 ? "text-success" : "text-on-error-container"
                      }`}
                    >
                      {tx.amount >= 0 ? "+" : ""}
                      {money(tx.amount)}
                    </span>
                    <span className="font-inter text-label-sm text-on-surface-variant">
                      bal {money(tx.balanceAfter)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setDetailTarget(null)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default WalletsClient;
