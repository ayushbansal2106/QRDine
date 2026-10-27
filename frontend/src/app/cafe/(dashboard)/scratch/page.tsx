import React from "react";
import { apiClient } from "@/lib/apiClient";
import { ScratchCampaign, ScratchCard } from "@/types";
import { ScratchClient } from "./ScratchClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminScratchPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/scratch");

  // Plan gate before the fetch — scratch cards are a paid marketing module.
  const gate = await planGate("scratch", "Scratch cards");
  if (gate) return gate;

  let campaign: ScratchCampaign | null = null;
  let cards: ScratchCard[] = [];

  try {
    const [campaignRes, cardsRes] = await Promise.all([
      apiClient.get("/scratch/campaign"),
      apiClient.get("/scratch/cards", { params: { limit: 50 } }),
    ]);
    campaign = campaignRes.data.campaign || null;
    cards = cardsRes.data.cards || [];
  } catch (error) {
    console.error("Failed to load scratch data:", error);
  }

  return <ScratchClient initialCampaign={campaign} initialCards={cards} />;
}
