"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { CustomerLoyaltySummary, LoyaltyCard, LoyaltyProgram, RewardVoucher } from "@/types";
import { revalidatePath } from "next/cache";

export async function fetchLoyaltyProgram() {
  try {
    const response = await apiClient.get("/loyalty/program");
    return { success: true as const, program: (response.data.program as LoyaltyProgram) || null };
  } catch (error: unknown) {
    console.error("Failed to fetch loyalty program:", error);
    return {
      success: false as const,
      program: null,
      message: apiErrorMessage(error, "Failed to load loyalty program."),
    };
  }
}

export async function saveLoyaltyProgram(data: Partial<LoyaltyProgram>) {
  try {
    const response = await apiClient.put("/loyalty/program", data);
    revalidatePath("/cafe/loyalty");
    return { success: true as const, program: response.data.program as LoyaltyProgram };
  } catch (error: unknown) {
    console.error("Failed to save loyalty program:", error);
    throw new Error(apiErrorMessage(error, "Failed to save loyalty program."));
  }
}

export async function fetchLoyaltyCards(params: { search?: string; page?: number; limit?: number } = {}) {
  try {
    const response = await apiClient.get("/loyalty/cards", { params });
    return {
      success: true as const,
      cards: response.data.cards as LoyaltyCard[],
      totalCount: response.data.totalCount as number,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch loyalty cards:", error);
    return {
      success: false as const,
      cards: [] as LoyaltyCard[],
      totalCount: 0,
      message: apiErrorMessage(error, "Failed to load loyalty cards."),
    };
  }
}

export async function fetchCustomerCard(customerId: string) {
  try {
    const response = await apiClient.get(`/loyalty/cards/${customerId}`);
    return { success: true as const, summary: response.data as CustomerLoyaltySummary };
  } catch (error: unknown) {
    console.error("Failed to fetch customer card:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to load customer card."),
    };
  }
}

export async function adjustCustomerStamps(customerId: string, delta: number, note = "") {
  try {
    await apiClient.post(`/loyalty/cards/${customerId}/stamps`, { delta, note });
    revalidatePath("/cafe/loyalty");
    return { success: true as const };
  } catch (error: unknown) {
    console.error("Failed to adjust stamps:", error);
    throw new Error(apiErrorMessage(error, "Failed to adjust stamps."));
  }
}

export async function validateVoucher(code: string) {
  try {
    const response = await apiClient.post("/loyalty/vouchers/validate", { code });
    return { success: true as const, voucher: response.data.voucher as RewardVoucher };
  } catch (error: unknown) {
    return {
      success: false as const,
      message: apiErrorMessage(error, "Invalid voucher."),
    };
  }
}

export async function redeemVoucher(code: string, orderId?: string) {
  try {
    const response = await apiClient.post("/loyalty/vouchers/redeem", { code, orderId });
    revalidatePath("/cafe/loyalty");
    return { success: true as const, voucher: response.data.voucher as RewardVoucher };
  } catch (error: unknown) {
    console.error("Failed to redeem voucher:", error);
    throw new Error(apiErrorMessage(error, "Failed to redeem voucher."));
  }
}

/** Customer-facing: their own card (guest token scoped). */
export async function fetchMyLoyaltyCard(sessionId?: string) {
  try {
    const response = await apiClient.get("/loyalty/me", { params: sessionId ? { sessionId } : {} });
    return { success: true as const, card: (response.data.card as CustomerLoyaltySummary) || null };
  } catch (error: unknown) {
    return {
      success: false as const,
      card: null,
      message: apiErrorMessage(error, "Failed to load loyalty card."),
    };
  }
}
