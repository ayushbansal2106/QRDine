"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorBody, apiErrorMessage, apiErrorStatus } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";

/** Shapes returned by the digitisation API (see menuDigitizationController). */
export interface DigitizedVariant {
  name: string;
  price: number;
}

export interface DigitizedItem {
  name: string;
  description: string;
  price: number | null;
  variants: DigitizedVariant[];
  modifierGroups: { name: string; isRequired: boolean; options: { name: string; price: number }[] }[];
  dietaryTags: string[];
  gstPercentage: number;
  suggestedCategory: string;
  imageKey: string | null;
  imageMatchMethod: string | null;
  /** True when no price could be read — the owner must fill this in. */
  needsPrice: boolean;
}

export interface DigitizedCategory {
  name: string;
  items: DigitizedItem[];
}

export interface DigitizeJob {
  id: string;
  status: "pending" | "processing" | "awaiting_review" | "published" | "failed";
  stats: {
    imageCount?: number;
    categoryCount?: number;
    itemCount?: number;
    variantCount?: number;
    unpricedCount?: number;
    imageMatchedCount?: number;
  };
  error: { code: string | null; message: string | null };
  sourceImages: { url: string }[];
  draft: { categories: DigitizedCategory[] } | null;
  publishedResult?: {
    createdCategories: string[];
    createdItems: number;
    skippedItems: number;
    publishedAt: string | null;
  };
}

export interface DigitizeResult {
  success: boolean;
  message: string;
  code?: string;
  job: DigitizeJob;
}

/**
 * Narrow a 422 body's `job` field to the real `DigitizeJob`.
 *
 * The error body is `Record<string, unknown>`, so this checks the one field the
 * UI actually reads (`error.message`) plus the discriminator `status`, rather
 * than casting the blob and hoping the backend sent what we expected.
 */
function isDigitizeJob(value: unknown): value is DigitizeJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Partial<DigitizeJob>;
  return (
    typeof job.id === "string" &&
    typeof job.status === "string" &&
    typeof job.error === "object" &&
    job.error !== null
  );
}

/** Run extraction over already-uploaded menu photo URLs. */
export async function runMenuDigitization(images: { url: string }[]): Promise<DigitizeResult> {
  try {
    const response = await apiClient.post("/menu/digitize", { images });
    return { success: true, message: response.data.message, job: response.data.job };
  } catch (error: unknown) {
    // A 422 is a *result*, not a fault: the AI ran but could not read the menu.
    // The controller still returns the job so the UI can show the reason.
    const body = apiErrorBody(error);
    const job = body?.job;
    if (apiErrorStatus(error) === 422 && job && isDigitizeJob(job)) {
      return {
        success: false,
        message: typeof body.message === "string" ? body.message : job.error.message ?? "The menu could not be read.",
        code: typeof body.code === "string" ? body.code : undefined,
        job,
      };
    }
    console.error("Menu digitisation failed:", error);
    throw new Error(apiErrorMessage(error, "Menu scanning failed. Please try again."));
  }
}

/** Recent digitisation jobs for this café. */
export async function listDigitizeJobs(): Promise<DigitizeJob[]> {
  try {
    const response = await apiClient.get("/menu/digitize/jobs");
    return response.data.jobs || [];
  } catch {
    return [];
  }
}

/** Persist the owner's review edits. */
export async function saveDigitizeDraft(
  jobId: string,
  draft: { categories: DigitizedCategory[] }
): Promise<DigitizeJob> {
  try {
    const response = await apiClient.put(`/menu/digitize/jobs/${jobId}/draft`, { draft });
    return response.data.job;
  } catch (error: unknown) {
    console.error("Failed to save draft:", error);
    throw new Error(apiErrorMessage(error, "Failed to save your edits."));
  }
}

/**
 * Publish a reviewed draft into the live menu.
 * Both list pages are revalidated so the new dishes appear immediately.
 */
export async function publishDigitizedMenu(
  jobId: string,
  draft?: { categories: DigitizedCategory[] }
): Promise<{
  alreadyPublished: boolean;
  message: string;
  result: DigitizeJob["publishedResult"];
}> {
  try {
    const response = await apiClient.post(`/menu/digitize/jobs/${jobId}/publish`, { draft });
    revalidatePath("/cafe/menu");
    revalidatePath("/cafe/dashboard");
    return {
      alreadyPublished: response.data.alreadyPublished,
      message: response.data.message,
      result: response.data.result,
    };
  } catch (error: unknown) {
    console.error("Failed to publish digitized menu:", error);
    throw new Error(apiErrorMessage(error, "Failed to publish the menu."));
  }
}