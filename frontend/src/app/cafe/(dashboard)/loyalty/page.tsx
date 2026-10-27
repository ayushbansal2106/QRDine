import React from "react";
import { apiClient } from "@/lib/apiClient";
import { LoyaltyCard, LoyaltyProgram } from "@/types";
import { LoyaltyClient } from "./LoyaltyClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminLoyaltyPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/loyalty");

  // Plan gate before the fetch — loyalty is a Growth+ module.
  const gate = await planGate("loyalty", "Loyalty");
  if (gate) return gate;

  let program: LoyaltyProgram | null = null;
  let cards: LoyaltyCard[] = [];

  try {
    const [programRes, cardsRes] = await Promise.all([
      apiClient.get("/loyalty/program"),
      apiClient.get("/loyalty/cards", { params: { limit: 50 } }),
    ]);
    program = programRes.data.program || null;
    cards = cardsRes.data.cards || [];
  } catch (error) {
    console.error("Failed to load loyalty data:", error);
  }

  return <LoyaltyClient initialProgram={program} initialCards={cards} />;
}
