"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { revalidatePath } from "next/cache";

export interface PosTender {
  method: "cash" | "upi_manual" | "card_manual" | "wallet";
  amount: number;
  received?: number;
  reference?: string;
}

export interface PosDiscount {
  scope?: "order" | "item";
  label?: string;
  type: "percent" | "flat";
  value: number;
  couponCode?: string;
}

export interface PosLineItem {
  menuItemId: string;
  quantity: number;
  variantId?: string;
  modifiers?: { groupId: string; optionId: string }[];
  seat?: string;
  notes?: string;
}

export type PosPromoPreview = {
  kind: "coupon" | "voucher";
  code: string;
  label: string;
  type: string;
  value: number;
  amount: number;
  title: string;
  message: string;
};

/**
 * Price a code against the running till cart, without taking money.
 *
 * The cashier is handed `FIRST50` or `RWD-9F2C11` and has no way to tell which
 * is which from the shape alone, so they are not asked: one field, one Apply
 * button, and the server answers with the offer and the exact saving.
 *
 * `customerId` is needed only for a reward voucher — it belongs to one profile,
 * so the till cannot price somebody else's reward.
 */
export async function previewPosCode({
  code,
  subtotal,
  customerId,
}: {
  code: string;
  subtotal: number;
  customerId?: string | null;
}) {
  try {
    const response = await apiClient.post("/pos/preview-code", {
      code,
      subtotal,
      customerId: customerId || undefined,
    });
    return {
      success: true as const,
      promo: response.data.promo as PosPromoPreview,
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      promo: null,
      message: apiErrorMessage(error, "That code could not be applied."),
    };
  }
}

/**
 * The POS catalog — categories, sellable items, tables, and what this operator
 * is permitted to do at the till.
 *
 * Declared here and imported by the till, rather than the other way round: this
 * is the function that knows what the endpoint returns. Previously the success
 * branch spread `response.data` (typed `any` by Axios), so the whole result was
 * `any` and every consumer re-guessed the shape.
 */
export interface PosCatalogResponse {
  categories: { _id: string; name: string }[];
  menuItems: {
    _id: string;
    name: string;
    price: number;
    categoryId: string;
    gstPercentage?: number;
    variants?: { _id?: string; name: string; price: number; isDefault?: boolean }[];
    modifierGroups?: {
      _id?: string;
      name: string;
      selectionType: "single" | "multi";
      isRequired?: boolean;
      min?: number;
      max?: number;
      options: { _id?: string; name: string; price: number }[];
    }[];
  }[];
  tables: { _id: string; tableNumber: number | string }[];
  canDiscount: boolean;
  canRefund: boolean;
}

export async function fetchPosCatalog() {
  try {
    const response = await apiClient.get<PosCatalogResponse>("/pos/catalog");
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to load POS catalog:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Failed to load POS catalog."),
    };
  }
}

/**
 * Create *and* settle a counter sale in one call.
 *
 * The POS deliberately has no "place order, then take payment" step any more.
 * Splitting it left a real failure mode: if the cashier abandoned the payment
 * popup, or mistyped a tender, the order still existed as an unpaid ticket on
 * the orders board and the kitchen — belonging to no session and counted as no
 * revenue. Now the till has two outcomes only: a settled order, or nothing.
 */
export async function checkoutPosOrder(payload: {
  orderType: "dine_in" | "takeaway" | "delivery";
  tableId?: string;
  items: PosLineItem[];
  notes?: string;
  customerPhone?: string;
  customerName?: string;
  discounts?: PosDiscount[];
  couponCode?: string;
  voucherCode?: string;
  tenders: PosTender[];
  clientRequestId?: string;
}) {
  try {
    const response = await apiClient.post("/pos/checkout", payload);
    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/sales");
    return {
      success: true as const,
      order: response.data.order,
      couponApplied: response.data.couponApplied ?? null,
      voucher: response.data.voucher ?? null,
    };
  } catch (error: unknown) {
    console.error("Failed to complete POS checkout:", error);
    throw new Error(apiErrorMessage(error, "Failed to complete the sale."));
  }
}

export async function createPosOrder(payload: {
  orderType: "dine_in" | "takeaway" | "delivery";
  tableId?: string;
  items: PosLineItem[];
  notes?: string;
  customerPhone?: string;
  customerName?: string;
  discounts?: PosDiscount[];
  couponCode?: string;
  clientRequestId?: string;
}) {
  try {
    const response = await apiClient.post("/pos/orders", payload);
    revalidatePath("/cafe/orders");
    return { success: true as const, order: response.data.order };
  } catch (error: unknown) {
    console.error("Failed to create POS order:", error);
    throw new Error(apiErrorMessage(error, "Failed to create counter order."));
  }
}

export async function recordPosPayment(orderId: string, tenders: PosTender[]) {
  try {
    const response = await apiClient.post(`/pos/orders/${orderId}/payments`, { tenders });
    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/bills");
    return { success: true as const, order: response.data.order };
  } catch (error: unknown) {
    console.error("Failed to record payment:", error);
    throw new Error(apiErrorMessage(error, "Failed to record payment."));
  }
}

export async function applyPosDiscount(orderId: string, discounts: PosDiscount[]) {
  try {
    const response = await apiClient.post(`/pos/orders/${orderId}/discounts`, { discounts });
    return { success: true as const, order: response.data.order };
  } catch (error: unknown) {
    console.error("Failed to apply discount:", error);
    throw new Error(apiErrorMessage(error, "Failed to apply discount."));
  }
}

export async function applyPosVoucher(orderId: string, code: string) {
  try {
    const response = await apiClient.post(`/pos/orders/${orderId}/voucher`, { code });
    return { success: true as const, order: response.data.order, voucher: response.data.voucher };
  } catch (error: unknown) {
    console.error("Failed to apply voucher:", error);
    throw new Error(apiErrorMessage(error, "Failed to apply voucher."));
  }
}

export interface PosCustomerLookup {
  found: boolean;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string;
    visitCount: number;
    lifetimeSpend: number;
  } | null;
}

/**
 * Exact phone lookup for the till.
 *
 * The CRM search endpoint is a substring match across name/phone/email, so
 * typing five digits into the till would match a dozen customers and leave the
 * cashier guessing. This is an exact match, and a miss is the signal to create
 * a new profile — the same call decides whether the sale links to a known
 * customer or starts a fresh one.
 */
export async function lookupCustomerByPhone(phone: string) {
  try {
    const response = await apiClient.get("/customers/lookup", { params: { phone } });
    return { success: true as const, ...response.data } as PosCustomerLookup;
  } catch (error: unknown) {
    console.error("Failed to look up customer:", error);
    throw new Error(apiErrorMessage(error, "Failed to look up that number."));
  }
}

export async function fetchReceipt(orderId: string, reprint = false) {
  try {
    const response = await apiClient.get(`/pos/orders/${orderId}/receipt`, {
      params: { reprint: reprint ? "true" : "false" },
    });
    return { success: true as const, ...response.data };
  } catch (error: unknown) {
    console.error("Failed to build receipt:", error);
    throw new Error(apiErrorMessage(error, "Failed to build receipt."));
  }
}
