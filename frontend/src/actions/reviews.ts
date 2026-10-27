"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";
import type { Review, ReviewSettings, ReviewSummary, ReviewOutcome } from "@/types";

/** Module #18 — smart review engine. */

/** Guest-facing: post a rating for your own order. Scoped by the session cookie. */
export async function submitRating(payload: {
  orderId: string;
  rating: number;
  tags?: string[];
  comment?: string;
}): Promise<{ success: boolean; outcome?: ReviewOutcome; message?: string }> {
  try {
    const response = await apiClient.post("/reviews", payload);
    return {
      success: true,
      outcome: {
        visibility: response.data.visibility,
        googleReviewUrl: response.data.googleReviewUrl,
        draft: response.data.draft,
        message: response.data.message,
      },
    };
  } catch (error: unknown) {
    console.error("Failed to submit rating:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Could not save your rating. Please try again."),
    };
  }
}

export async function getReviews(params?: {
  page?: number;
  limit?: number;
  visibility?: string;
  status?: string;
  rating?: number;
}): Promise<{
  success: boolean;
  reviews?: Review[];
  totalCount?: number;
  totalPages?: number;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/reviews/all", { params });
    return {
      success: true,
      reviews: response.data.reviews,
      totalCount: response.data.totalCount,
      totalPages: response.data.totalPages,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch reviews:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load reviews."),
      reviews: [],
      totalCount: 0,
      totalPages: 0,
    };
  }
}

export async function getReviewSummary(params?: { from?: string; to?: string }) {
  try {
    const response = await apiClient.get("/reviews/summary", { params });
    return { success: true, summary: response.data.summary as ReviewSummary };
  } catch (error: unknown) {
    console.error("Failed to fetch review summary:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load the review summary."),
    };
  }
}

export async function generateReviewDraft(id: string) {
  try {
    const response = await apiClient.post(`/reviews/${id}/draft`);
    revalidatePath("/cafe/reviews");
    return { success: true, draft: response.data.draft, source: response.data.source };
  } catch (error: unknown) {
    console.error("Failed to generate review draft:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Could not generate a draft."),
    };
  }
}

export async function generateReplyDraft(id: string) {
  try {
    const response = await apiClient.post(`/reviews/${id}/reply-draft`);
    revalidatePath("/cafe/reviews");
    return { success: true, reply: response.data.reply, source: response.data.source };
  } catch (error: unknown) {
    console.error("Failed to generate reply draft:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Could not generate a reply."),
    };
  }
}

export async function publishReply(id: string, reply: string) {
  try {
    await apiClient.post(`/reviews/${id}/reply`, { reply });
    revalidatePath("/cafe/reviews");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to publish reply:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Could not save the reply."),
    };
  }
}

export async function updateReview(
  id: string,
  payload: Partial<{ status: string; internalNote: string; published: boolean }>
) {
  try {
    await apiClient.patch(`/reviews/${id}`, payload);
    revalidatePath("/cafe/reviews");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to update review:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Could not update the review."),
    };
  }
}

export async function getReviewSettings(): Promise<{
  success: boolean;
  settings?: ReviewSettings;
  googleReviewUrl?: string;
  availableTags?: string[];
  aiConfigured?: boolean;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/reviews/settings");
    return {
      success: true,
      settings: response.data.settings,
      googleReviewUrl: response.data.googleReviewUrl,
      availableTags: response.data.availableTags,
      aiConfigured: response.data.ai?.configured ?? false,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch review settings:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to load review settings."),
    };
  }
}

export async function updateReviewSettings(payload: Partial<ReviewSettings>) {
  try {
    await apiClient.put("/reviews/settings", payload);
    revalidatePath("/cafe/reviews");
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to update review settings:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to save review settings."),
    };
  }
}