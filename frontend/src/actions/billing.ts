"use server";
import { apiErrorMessage, apiErrorStatus } from "@/lib/errorMessage";

import { apiClient } from "@/lib/apiClient";

export async function getBills(filters?: { status?: string }) {
  try {
    const response = await apiClient.get("/billing/bills", {
      params: filters,
    });
    return {
      success: true,
      bills: response.data.bills,
    };
  } catch (error: unknown) {
    console.error("Failed to get bills:", error);
    throw new Error(apiErrorMessage(error, "Failed to fetch bills."));
  }
}

/**
 * One table, in full — the staff-side view behind a bills card.
 *
 * Carries the guest's loyalty card alongside the orders, because taking payment
 * is what moves it: a stamp is earned when the bill settles, and a voucher on the
 * card is money the cafe already promised.
 */
export async function getBillDetail(sessionId: string) {
  try {
    const response = await apiClient.get(`/billing/bills/${sessionId}`);
    return {
      success: true as const,
      bill: response.data.bill,
    };
  } catch (error: unknown) {
    console.error("Failed to get bill detail:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch bill details.")
    );
  }
}

export async function getSalesHistory(filters?: {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/billing/sales-history", {
      params: filters,
    });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get sales history:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch sales history.")
    );
  }
}

export async function getAnalytics(filters?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/billing/analytics", {
      params: filters,
    });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get analytics:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch analytics.")
    );
  }
}

export async function downloadInvoice(invoiceId: string) {
  try {
    const response = await apiClient.get(`/invoices/${invoiceId}/pdf`, {
      responseType: "blob",
    });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to download invoice:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to download invoice.")
    );
  }
}

/**
 * Email an invoice to the guest.
 *
 * `email` is supplied the first time only, when staff are prompted to link an
 * address to the customer's profile — the backend persists it, so subsequent
 * resends need no prompt.
 *
 * A 409 means "nobody to send it to", which is a prompt, not a failure. It is
 * surfaced as `needsEmail` so the caller can open the link-email dialog rather
 * than showing an error the staff cannot act on.
 */
export async function resendInvoiceEmail(invoiceId: string, email?: string) {
  try {
    const response = await apiClient.post(`/invoices/${invoiceId}/resend-email`, {
      email,
    });
    return {
      success: true as const,
      message: response.data.message,
      emailSent: response.data.emailSent,
      email: response.data.email ?? null,
      reason: response.data.reason ?? null,
      needsEmail: false,
    };
  } catch (error: unknown) {
    if (apiErrorStatus(error) === 409) {
      return {
        success: false as const,
        needsEmail: true as const,
        message: apiErrorMessage(error, "No email is linked to this bill."),
        emailSent: false,
        email: null,
        reason: null,
      };
    }
    console.error("Failed to resend invoice email:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to resend invoice email.")
    );
  }
}
