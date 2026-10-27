"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { Coupon } from "@/types";
import { revalidatePath } from "next/cache";

export async function fetchCoupons(params: { search?: string; active?: boolean } = {}) {
  try {
    const response = await apiClient.get("/coupons", { params });
    return { success: true as const, coupons: response.data.coupons as Coupon[] };
  } catch (error: unknown) {
    console.error("Failed to fetch coupons:", error);
    return {
      success: false as const,
      coupons: [] as Coupon[],
      message: apiErrorMessage(error, "Failed to load coupons."),
    };
  }
}

export type AudienceRule = { field: string; op: string; value: string | number | boolean };

export type AudienceCatalogue = {
  fields: {
    field: string;
    label: string;
    type: "number" | "date" | "array";
    ops: { op: string; label: string }[];
  }[];
  presets: { key: string; label: string; hint: string }[];
};

/**
 * What the audience rule builder may offer.
 *
 * Fetched from the engine's own whitelist rather than duplicated in the UI, so
 * the picker can never present a rule that redemption would refuse.
 */
export async function fetchAudienceCatalogue() {
  try {
    const response = await apiClient.get("/coupons/audience/catalogue");
    return {
      success: true as const,
      catalogue: response.data as AudienceCatalogue,
    };
  } catch (error: unknown) {
    console.error("Failed to load audience catalogue:", error);
    return {
      success: false as const,
      catalogue: { fields: [], presets: [] } as AudienceCatalogue,
      message: apiErrorMessage(error, "Failed to load audience options."),
    };
  }
}

/**
 * How many profiles an unsaved audience would reach right now.
 *
 * "Inactive for 30 days" is not a number anyone can picture, and publishing an
 * offer to nobody — or to the entire customer base — is the kind of mistake that
 * only shows up afterwards.
 */
export async function previewAudience(
  audience: { mode: string; rules: AudienceRule[] },
  customerIds: string[] = []
) {
  try {
    const response = await apiClient.post("/coupons/audience/preview", { audience, customerIds });
    return {
      success: true as const,
      totalCount: response.data.totalCount as number,
      sample: (response.data.sample || []) as { name: string; phone: string }[],
      description: response.data.description as string,
    };
  } catch (error: unknown) {
    console.error("Failed to preview audience:", error);
    return {
      success: false as const,
      totalCount: 0,
      sample: [] as { name: string; phone: string }[],
      description: "",
      message: apiErrorMessage(error, "Failed to preview this audience."),
    };
  }
}

export async function fetchCouponGrants(id: string) {
  try {
    const response = await apiClient.get(`/coupons/${id}/grants`);
    return {
      success: true as const,
      totalCount: response.data.totalCount as number,
      grants: response.data.grants as {
        id: string;
        code: string;
        customer: { name: string; phone: string } | null;
        status: string;
        issuedAt: string;
        expiresAt: string | null;
        redeemedAt: string | null;
      }[],
    };
  } catch (error: unknown) {
    console.error("Failed to load coupon grants:", error);
    return { success: false as const, totalCount: 0, grants: [], message: "Failed to load recipients." };
  }
}

export async function createCoupon(data: Partial<Coupon>) {
  try {
    const response = await apiClient.post("/coupons", data);
    revalidatePath("/cafe/coupons");
    return { success: true as const, coupon: response.data.coupon as Coupon };
  } catch (error: unknown) {
    console.error("Failed to create coupon:", error);
    throw new Error(apiErrorMessage(error, "Failed to create coupon."));
  }
}

export async function updateCoupon(id: string, data: Partial<Coupon>) {
  try {
    const response = await apiClient.patch(`/coupons/${id}`, data);
    revalidatePath("/cafe/coupons");
    return { success: true as const, coupon: response.data.coupon as Coupon };
  } catch (error: unknown) {
    console.error("Failed to update coupon:", error);
    throw new Error(apiErrorMessage(error, "Failed to update coupon."));
  }
}

export async function deleteCoupon(id: string) {
  try {
    await apiClient.delete(`/coupons/${id}`);
    revalidatePath("/cafe/coupons");
    return { success: true as const };
  } catch (error: unknown) {
    console.error("Failed to delete coupon:", error);
    throw new Error(apiErrorMessage(error, "Failed to delete coupon."));
  }
}

export async function validateCoupon(code: string, subtotal: number, customerId?: string) {
  try {
    const response = await apiClient.post("/coupons/validate", { code, subtotal, customerId });
    return {
      success: true as const,
      code: response.data.code as string,
      label: response.data.label as string,
      discount: response.data.discount as number,
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      message: apiErrorMessage(error, "Invalid coupon code."),
    };
  }
}
