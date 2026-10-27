"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { OrderStatus, type SelectedModifier } from "@/types";
import type { RawOrder } from "@/lib/mappers";
import { revalidatePath } from "next/cache";

export type PromoPreview = {
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
 * Price a code the guest pasted, without placing the order.
 *
 * One field for both kinds of code — the server decides whether `FIRST50` is a
 * coupon or `RWD-9F2C11` is a reward voucher — and answers with the offer and
 * the exact amount that will come off, so the guest knows what they are getting
 * before they commit to the order.
 */
export async function previewOrderCode({
  code,
  subtotal,
  tableId,
}: {
  code: string;
  subtotal: number;
  tableId: string;
}) {
  try {
    const response = await apiClient.post("/orders/preview-code", {
      code,
      subtotal,
      tableId,
    });
    return { success: true as const, promo: response.data.promo as PromoPreview };
  } catch (error: unknown) {
    return {
      success: false as const,
      promo: null,
      message: apiErrorMessage(error, "That code could not be applied."),
    };
  }
}

export async function createOrder(
  tableId: string,
  items: {
    menuItemId: string;
    quantity: number;
    variantId?: string;
    modifiers?: { groupId?: string; optionId?: string }[];
    notes?: string;
  }[],
  notes?: string,
  sessionId?: string | null,
  participantId?: string | null,
  clientRequestId?: string | null,
  location?: { lat: number; lng: number; accuracy?: number } | null,
  couponCode?: string | null,
  voucherCode?: string | null
) {
  try {
    const response = await apiClient.post("/orders", {
      tableId,
      items,
      notes,
      sessionId: sessionId || undefined,
      participantId: participantId || undefined,
      clientRequestId: clientRequestId || undefined,
      // Module #10 — advisory coordinates; the server decides the verdict.
      location: location || undefined,
      couponCode: couponCode || undefined,
      // A redeemed loyalty reward. Validated server-side against the ordering
      // customer, and spent only once the order exists.
      voucherCode: voucherCode || undefined,
    });
    
    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/kitchen");
    
    return {
      success: true,
      orderId: response.data.orderId,
      orderNumber: response.data.orderNumber,
      couponApplied: response.data.couponApplied || null,
      // The server downgrades an unusable guest coupon to a warning so the
      // order still succeeds; surface it rather than dropping it silently.
      couponNotice: response.data.couponNotice || null,
      voucherApplied: response.data.voucherApplied || null,
      voucherNotice: response.data.voucherNotice || null,
      order: response.data.order,
    };
  } catch (error: unknown) {
    console.error("Failed to create order:", error);
    throw new Error(apiErrorMessage(error, "Failed to create order."));
  }
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  try {
    const response = await apiClient.put(`/orders/${id}/status`, {
      status,
    });

    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/kitchen");
    revalidatePath(`/cafe/orders/${id}`);
    revalidatePath(`/order/${id}`);
    
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: unknown) {
    console.error("Failed to update order status:", error);
    throw new Error(apiErrorMessage(error, "Failed to update order status."));
  }
}

export async function cancelOrderItem(orderId: string, itemId: string, reason: string) {
  try {
    const response = await apiClient.post(`/orders/${orderId}/items/${itemId}/cancel`, {
      cancellationReason: reason,
    });

    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/kitchen");
    revalidatePath(`/cafe/orders/${orderId}`);
    revalidatePath(`/order/${orderId}`);
    
    return {
      success: true,
      order: response.data.order,
    };
  } catch (error: unknown) {
    console.error("Failed to cancel order item:", error);
    throw new Error(apiErrorMessage(error, "Failed to cancel item."));
  }
}

export async function getOrderAction(id: string): Promise<{ success: true; order: RawOrder }> {
  try {
    const response = await apiClient.get(`/orders/${id}`);
    return {
      success: true,
      order: response.data.order as RawOrder,
    };
  } catch (error: unknown) {
    console.error("Failed to get order:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch order details."));
  }
}

export async function getPublicOrderAction(id: string): Promise<{ success: true; order: RawOrder }> {
  try {
    const response = await apiClient.get(`/orders/public/${id}`);
    return {
      success: true,
      order: response.data.order as RawOrder,
    };
  } catch (error: unknown) {
    console.error("Failed to get public order:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch order details."));
  }
}

export async function getPublicOrderStatusAction(id: string) {
  try {
    const response = await apiClient.get(`/orders/public/${id}/status`);
    return {
      success: true,
      status: response.data.status as OrderStatus,
    };
  } catch (error: unknown) {
    console.error("Failed to get public order status:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch order status."));
  }
}

// --- Module #03 — omnichannel pipeline actions --------------------------------

/** Add items to an open tab (prices are re-resolved server-side). */
export async function addItemsToOrder(
  orderId: string,
  items: {
    menuItemId: string;
    quantity: number;
    variantId?: string;
    modifiers?: SelectedModifier[];
    notes?: string;
  }[]
) {
  try {
    const response = await apiClient.post(`/orders/${orderId}/items`, { items });
    revalidatePath("/cafe/orders");
    return { success: true, order: response.data.order };
  } catch (error: unknown) {
    console.error("Failed to add items to order:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to add items to this tab."),
    };
  }
}

/** Move an open tab (and its dining session) to another table. */
export async function reassignOrderTable(orderId: string, tableNumber: string, reason = "") {
  try {
    const response = await apiClient.patch(`/orders/${orderId}/reassign-table`, {
      tableNumber,
      reason,
    });
    revalidatePath("/cafe/orders");
    return {
      success: true,
      order: response.data.order,
      table: response.data.table,
      sessionMoved: response.data.sessionMoved,
    };
  } catch (error: unknown) {
    console.error("Failed to reassign order table:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to move this order."),
    };
  }
}

/** Coin/credit reconciliation: refund what was collected, to the right place. */
export async function refundOrder(
  orderId: string,
  payload: { amount?: number; method: string; reason: string }
) {
  try {
    const response = await apiClient.post(`/orders/${orderId}/refund`, payload);
    revalidatePath("/cafe/orders");
    revalidatePath("/cafe/bills");
    return {
      success: true,
      order: response.data.order,
      refund: response.data.refund,
      walletReconciliation: response.data.walletReconciliation,
    };
  } catch (error: unknown) {
    console.error("Failed to refund order:", error);
    return {
      success: false,
      message: apiErrorMessage(error, "Failed to record the refund."),
    };
  }
}
