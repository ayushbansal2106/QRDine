import React from "react";
import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { Review, ReviewSettings, ReviewSummary } from "@/types";
import { ReviewsClient } from "./ReviewsClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/reviews");

  // Plan gate before the fetch — the review engine (AI drafts, Google routing)
  // is Pro-only. The public rating capture path is not affected.
  const gate = await planGate("reviews", "Reviews & AI");
  if (gate) return gate;

  let settings: ReviewSettings | null = null;
  let summary: ReviewSummary | null = null;
  let reviews: Review[] = [];
  let aiConfigured = false;
  let loadError: string | null = null;

  try {
    const [settingsRes, summaryRes, reviewsRes] = await Promise.all([
      apiClient.get("/reviews/settings"),
      apiClient.get("/reviews/summary"),
      apiClient.get("/reviews/all", { params: { limit: 50 } }),
    ]);
    settings = settingsRes.data.settings || null;
    aiConfigured = settingsRes.data.ai?.configured ?? false;
    summary = summaryRes.data.summary || null;
    reviews = reviewsRes.data.reviews || [];
  } catch (error: unknown) {
    console.error("Failed to load reviews:", error);
    loadError =
      apiErrorMessage(error, "Could not load reviews. Make sure your role has the Reviews & AI permission.");
  }

  return (
    <ReviewsClient
      initialSettings={settings}
      initialSummary={summary}
      initialReviews={reviews}
      aiConfigured={aiConfigured}
      loadError={loadError}
    />
  );
}