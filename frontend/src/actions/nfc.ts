"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";
import type { NfcTag, NfcTagCard, NfcStats, NfcDestination } from "@/types";

/** Module #11 — social NFC tap tag management. */

export async function getNfcTags(): Promise<{
  success: boolean;
  tags?: NfcTag[];
  stats?: NfcStats;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/nfc/manage");
    return { success: true, tags: response.data.tags, stats: response.data.stats };
  } catch (error: unknown) {
    console.error("Failed to fetch NFC tags:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load NFC tags."),
      tags: [],
    };
  }
}

export async function createNfcTag(payload: {
  label: string;
  destination: NfcDestination;
  targetUrl?: string;
  tableId?: string | null;
  notes?: string;
}): Promise<{ success: boolean; tag?: NfcTag; card?: NfcTagCard; message?: string }> {
  try {
    const response = await apiClient.post("/nfc/manage", payload);
    revalidatePath("/cafe/nfc");
    return { success: true, tag: response.data.tag, card: response.data.card };
  } catch (error: unknown) {
    console.error("Failed to create NFC tag:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to create the NFC tag."),
    };
  }
}

export async function updateNfcTag(
  id: string,
  payload: Partial<{
    label: string;
    destination: NfcDestination;
    targetUrl: string;
    tableId: string | null;
    isActive: boolean;
    notes: string;
  }>
) {
  try {
    await apiClient.put(`/nfc/manage/${id}`, payload);
    revalidatePath("/cafe/nfc");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to update NFC tag:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to update the NFC tag."),
    };
  }
}

export async function deleteNfcTag(id: string) {
  try {
    await apiClient.delete(`/nfc/manage/${id}`);
    revalidatePath("/cafe/nfc");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to delete NFC tag:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to delete the NFC tag."),
    };
  }
}

/** Printable sticker assets: resolver URL, NDEF payload and the fallback QR. */
export async function getNfcTagCard(id: string): Promise<{
  success: boolean;
  card?: NfcTagCard;
  message?: string;
}> {
  try {
    const response = await apiClient.get(`/nfc/manage/${id}/card`);
    return { success: true, card: response.data.card };
  } catch (error: unknown) {
    console.error("Failed to load NFC tag card:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to build the tag card."),
    };
  }
}