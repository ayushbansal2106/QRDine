"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { ScratchCampaign, ScratchCard } from "@/types";
import { revalidatePath } from "next/cache";

export async function fetchScratchCampaign() {
  try {
    const response = await apiClient.get("/scratch/campaign");
    return { success: true as const, campaign: (response.data.campaign as ScratchCampaign) || null };
  } catch (error: unknown) {
    console.error("Failed to fetch scratch campaign:", error);
    return {
      success: false as const,
      campaign: null,
      message: apiErrorMessage(error, "Failed to load campaign."),
    };
  }
}

export async function saveScratchCampaign(data: Partial<ScratchCampaign>) {
  try {
    const response = await apiClient.put("/scratch/campaign", data);
    revalidatePath("/cafe/scratch");
    return { success: true as const, campaign: response.data.campaign as ScratchCampaign };
  } catch (error: unknown) {
    console.error("Failed to save scratch campaign:", error);
    throw new Error(apiErrorMessage(error, "Failed to save campaign."));
  }
}

export async function fetchScratchCards(params: { status?: string; page?: number; limit?: number } = {}) {
  try {
    const response = await apiClient.get("/scratch/cards", { params });
    return {
      success: true as const,
      cards: response.data.cards as ScratchCard[],
      totalCount: response.data.totalCount as number,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch scratch cards:", error);
    return {
      success: false as const,
      cards: [] as ScratchCard[],
      totalCount: 0,
      message: apiErrorMessage(error, "Failed to load cards."),
    };
  }
}

export async function revealScratchCard(cardId: string) {
  try {
    const response = await apiClient.post(`/scratch/cards/${cardId}/reveal`);
    revalidatePath("/cafe/scratch");
    return { success: true as const, card: response.data.card as ScratchCard, voucher: response.data.voucher };
  } catch (error: unknown) {
    console.error("Failed to reveal card:", error);
    throw new Error(apiErrorMessage(error, "Failed to reveal card."));
  }
}

// ─── Customer-facing (guest token scoped) ───────────────

export async function fetchMyScratchCards() {
  try {
    const response = await apiClient.get("/scratch/me");
    return {
      success: true as const,
      cards: response.data.cards as ScratchCard[],
      pending: response.data.pending as { id: string; issuedAt: string; expiresAt: string | null }[],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      cards: [] as ScratchCard[],
      pending: [],
      message: apiErrorMessage(error, "Failed to load scratch cards."),
    };
  }
}

export async function revealMyScratchCard(cardId: string) {
  try {
    const response = await apiClient.post(`/scratch/${cardId}/reveal`, {});
    return {
      success: true as const,
      prize: response.data.prize,
      voucher: response.data.voucher,
    };
  } catch (error: unknown) {
    console.error("Failed to reveal scratch card:", error);
    throw new Error(apiErrorMessage(error, "Failed to reveal card."));
  }
}
