"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";

export async function getSubscriptionPlans() {
  try {
    const { data } = await apiClient.get("/subscription/plans");
    return { success: true, plans: data.plans };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to load plans.") };
  }
}

export async function getMySubscription() {
  try {
    const { data } = await apiClient.get("/subscription/");
    return {
      success: true,
      subscription: data.subscription,
      access: data.access,
      limits: data.limits,
    };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to load subscription.") };
  }
}

/**
 * Server-resolved entitlements for the signed-in tenant, plus live usage.
 *
 * Fetched on the server and handed to the client provider so the first paint
 * already knows what the plan includes — a client-side fetch would flash
 * premium navigation for a Starter cafe on every page load.
 */
export async function getMyEntitlements() {
  try {
    const { data } = await apiClient.get("/subscription/entitlements");
    return {
      success: true as const,
      entitlements: data.entitlements,
      usage: data.usage,
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to load plan entitlements."),
    };
  }
}

export async function startCheckout(planKey: string, cycle: "monthly" | "annual", outlets: number) {
  try {
    const { data } = await apiClient.post("/subscription/checkout", { planKey, cycle, outlets });
    return { success: true, message: data.message, subscription: data.subscription };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Checkout failed.") };
  }
}

export async function cancelSubscription(reason?: string) {
  try {
    const { data } = await apiClient.post("/subscription/cancel", { reason });
    return { success: true, message: data.message, subscription: data.subscription };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to cancel subscription.") };
  }
}

export async function resumeSubscription() {
  try {
    const { data } = await apiClient.post("/subscription/resume");
    return { success: true, message: data.message, subscription: data.subscription };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to resume subscription.") };
  }
}

export async function getMyInvoices() {
  try {
    const { data } = await apiClient.get("/subscription/invoices");
    return { success: true, invoices: data.invoices };
  } catch (error: unknown) {
    return { success: false, message: apiErrorMessage(error, "Failed to load subscription invoices.") };
  }
}

