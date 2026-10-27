"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { Wallet, WalletTransaction } from "@/types";
import { revalidatePath } from "next/cache";

// ─── Admin ──────────────────────────────────────────────

export async function fetchWallets(params: { search?: string; page?: number; limit?: number } = {}) {
  try {
    const response = await apiClient.get("/wallets", { params });
    return {
      success: true as const,
      wallets: response.data.wallets as Wallet[],
      totalCount: response.data.totalCount as number,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch wallets:", error);
    return {
      success: false as const,
      wallets: [] as Wallet[],
      totalCount: 0,
      message: apiErrorMessage(error, "Failed to load wallets."),
    };
  }
}

export async function fetchWalletDetail(customerId: string) {
  try {
    const response = await apiClient.get(`/wallets/${customerId}`);
    return {
      success: true as const,
      wallet: (response.data.wallet as Wallet) || null,
      transactions: (response.data.transactions as WalletTransaction[]) || [],
    };
  } catch (error: unknown) {
    console.error("Failed to fetch wallet detail:", error);
    return {
      success: false as const,
      wallet: null,
      transactions: [] as WalletTransaction[],
      message: apiErrorMessage(error, "Failed to load wallet."),
    };
  }
}

export async function topUpWallet(customerId: string, amount: number, bonus = 0, note = "") {
  try {
    const response = await apiClient.post(`/wallets/${customerId}/topup`, { amount, bonus, note });
    revalidatePath("/cafe/wallets");
    return { success: true as const, balance: response.data.wallet?.balance as number };
  } catch (error: unknown) {
    console.error("Failed to top up wallet:", error);
    throw new Error(apiErrorMessage(error, "Failed to top up wallet."));
  }
}

export async function refundToWallet(customerId: string, amount: number, note = "") {
  try {
    const response = await apiClient.post(`/wallets/${customerId}/refund`, { amount, note });
    revalidatePath("/cafe/wallets");
    return { success: true as const, balance: response.data.wallet?.balance as number };
  } catch (error: unknown) {
    console.error("Failed to refund to wallet:", error);
    throw new Error(apiErrorMessage(error, "Failed to refund to wallet."));
  }
}

// ─── Customer-facing (guest token scoped) ───────────────

export async function fetchMyWallet(sessionId?: string) {
  try {
    const response = await apiClient.get("/wallet/me", { params: sessionId ? { sessionId } : {} });
    return {
      success: true as const,
      wallet: (response.data.wallet as Wallet) || null,
      transactions: (response.data.transactions as WalletTransaction[]) || [],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      wallet: null,
      transactions: [] as WalletTransaction[],
      message: apiErrorMessage(error, "Failed to load wallet."),
    };
  }
}

export async function payWithWallet(sessionId: string, orderId: string, clientRequestId?: string) {
  try {
    const response = await apiClient.post("/wallet/pay", {
      sessionId,
      orderId,
      clientRequestId: clientRequestId || `wallet-${orderId}`,
    });
    return { success: true as const, balance: response.data.wallet?.balance as number };
  } catch (error: unknown) {
    console.error("Wallet payment failed:", error);
    throw new Error(apiErrorMessage(error, "Wallet payment failed."));
  }
}
