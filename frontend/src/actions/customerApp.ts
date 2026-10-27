"use server";

import { cookies } from "next/headers";
import { apiClient } from "@/lib/apiClient";

/**
 * Mirror the customer token onto the Next origin.
 *
 * The backend sets `customer_token` on the API origin, and the browser never
 * presents an API cookie to the Next origin — so `/profile` (a server component)
 * could not see it, redirected back to `/signin`, and the guest was trapped in a
 * loop. Writing it here as httpOnly is the same fix `createSession` already uses
 * for the guest token, and keeps the value out of reach of client JavaScript.
 */
async function setCustomerTokenCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("customer_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
  });
}

/**
 * Pull a human-readable message out of an axios rejection without repeating an
 * `any` cast in every action.
 */
const errorMessage = (error: unknown, fallback: string): string => {
  const err = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return err.response?.data?.message || err.message || fallback;
};

/**
 * Guest customer app (Module #09).
 *
 * Authentication is an httpOnly `customer_token` cookie set by the backend.
 * `apiClient` forwards it as `x-customer-token`, so no token is ever handled in
 * component state or exposed to the browser's JS.
 */

export interface CustomerPreferences {
  vegOnly: boolean;
  notifications: boolean;
  language: string;
}

export interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  preferences: CustomerPreferences;
}

export interface CustomerStats {
  orders: number;
  spent: number;
  saved: number;
  visits: number;
  averageSpend: number;
  memberSince: string;
  lastVisitAt: string | null;
}

export interface HistoryOrder {
  id: string;
  orderNumber: string;
  status: string;
  orderType: string;
  /** `qr` is a table order; `pos` is a counter sale. */
  channel?: string;
  placedAt: string;
  itemCount: number;
  items: { name: string; quantity: number; amount: number }[];
  totalAmount: number;
  discountTotal: number;
  tableNumber: number | null;
  /** Set on orders still in front of the guest — not yet paid, not cancelled. */
  isLive?: boolean;
}

/** True when this browser holds a valid customer session cookie. */
export async function isCustomerSignedIn(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    return Boolean(cookieStore.get("customer_token")?.value);
  } catch {
    return false;
  }
}

export async function requestLoginOtp(
  phone: string,
  cafeId: string
): Promise<{ success: boolean; message: string; devCode?: string }> {
  try {
    const response = await apiClient.post("/customer/auth/request-otp", { phone, cafeId });
    return {
      success: true,
      message: response.data.message || "We sent you a code",
      // Populated only outside production, when no SMS provider is configured.
      devCode: response.data.devCode,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "Could not send a code. Try again."),
    };
  }
}

export async function verifyLoginOtp(
  phone: string,
  code: string,
  cafeId: string
): Promise<{ success: boolean; message: string; customer?: CustomerProfile }> {
  try {
    const response = await apiClient.post("/customer/auth/verify-otp", { phone, code, cafeId });
    // Must happen before returning: the caller navigates to a server component
    // that reads this cookie on its very next render.
    if (response.data?.token) {
      await setCustomerTokenCookie(response.data.token);
    }
    return { success: true, message: "Signed in", customer: response.data.customer };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "That code did not work."),
    };
  }
}

export async function signOutCustomer(): Promise<{ success: boolean }> {
  try {
    await apiClient.post("/customer/auth/sign-out");
    // Clear the Next-origin copy too, or the guest stays signed in here even
    // though the API has forgotten them.
    const cookieStore = await cookies();
    cookieStore.delete("customer_token");
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function fetchMyProfile(): Promise<{
  success: boolean;
  customer: CustomerProfile | null;
  stats: CustomerStats | null;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/customer/me");
    return { success: true, customer: response.data.customer, stats: response.data.stats };
  } catch (error: unknown) {
    return {
      success: false,
      customer: null,
      stats: null,
      message: errorMessage(error, "Could not load your profile."),
    };
  }
}

export type OrderHistoryRange = "3m" | "6m" | "1y" | "all";

export async function fetchMyOrders(params: {
  range?: OrderHistoryRange;
  page?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  orders: HistoryOrder[];
  /** Placed and unpaid — what the guest is still sitting at the table for. */
  active: HistoryOrder[];
  total: number;
  hasMore: boolean;
  page: number;
  message?: string;
}> {
  try {
    const response = await apiClient.get("/customer/me/orders", {
      params: {
        range: params.range || "3m",
        page: params.page || 1,
        limit: params.limit || 10,
      },
    });
    return {
      success: true,
      orders: response.data.orders || [],
      active: response.data.active || [],
      total: response.data.total || 0,
      hasMore: Boolean(response.data.hasMore),
      page: response.data.page || 1,
    };
  } catch (error: unknown) {
    return {
      success: false,
      orders: [],
      active: [],
      total: 0,
      hasMore: false,
      page: 1,
      message: errorMessage(error, "Could not load your orders."),
    };
  }
}

// ── Rewards ────────────────────────────────────────────
// Loyalty stamps, prepaid wallet, scratch cards and personal coupons. All read
// through the signed-in profile, so the guest never sees anyone else's.

export interface LoyaltySummary {
  programName: string;
  /** False when the café has configured a program but not switched it on. */
  isActive: boolean;
  stamps: number;
  lifetimeStamps: number;
  stampsRequired: number;
  stampsToNextReward: number;
  stampsPerOrder: number;
  lastStampAt: string | null;
  vouchers: {
    code: string;
    label: string;
    type: string;
    value: number;
    expiresAt: string | null;
  }[];
}

export async function fetchMyLoyalty() {
  try {
    const response = await apiClient.get("/customer/me/loyalty");
    return { success: true as const, loyalty: (response.data.loyalty as LoyaltySummary | null) ?? null };
  } catch (error: unknown) {
    return {
      success: false as const,
      loyalty: null,
      message: errorMessage(error, "Could not load your stamps."),
    };
  }
}

/**
 * Trade a completed stamp set for its voucher code.
 *
 * The stamps are spent server-side in the same call, so the button reflects what
 * actually happened rather than an optimistic local decrement. A refusal (not
 * enough stamps, no programme running) is a message, not an exception — the
 * customer did nothing wrong.
 */
export async function claimMyReward() {
  try {
    const response = await apiClient.post("/customer/me/loyalty/reward");
    return {
      success: true as const,
      voucher: response.data.voucher as LoyaltySummary["vouchers"][number],
      stamps: response.data.stamps as number,
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      voucher: null,
      stamps: null,
      message: errorMessage(error, "Could not claim this reward."),
    };
  }
}

export async function fetchMyWallet() {
  try {
    const response = await apiClient.get("/customer/me/wallet");
    return {
      success: true as const,
      wallet: response.data.wallet as { balance: number; currency: string; hasWallet: boolean },
      transactions: (response.data.transactions ?? []) as {
        id: string;
        type: string;
        amount: number;
        balanceAfter: number;
        note: string;
        createdAt: string;
      }[],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      wallet: { balance: 0, currency: "INR", hasWallet: false },
      transactions: [],
      message: errorMessage(error, "Could not load your wallet."),
    };
  }
}

export interface CustomerWalletCard {
  walletId: string | null;
  cafeId: string;
  cafeName: string;
  cafeLogo: string;
  cafeAddress: string;
  balance: number;
  currency: string;
  isActiveHere: boolean;
  lastTransactionAt: string | null;
}

export async function fetchMyWallets() {
  try {
    const response = await apiClient.get("/customer/me/wallets");
    return {
      success: true as const,
      currentCafeId: response.data.currentCafeId as string,
      wallets: (response.data.wallets ?? []) as CustomerWalletCard[],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      currentCafeId: "",
      wallets: [],
      message: errorMessage(error, "Could not load your cafe wallets."),
    };
  }
}

export async function fetchMyScratchCards() {
  try {
    const response = await apiClient.get("/customer/me/scratch");
    return {
      success: true as const,
      campaignLive: Boolean(response.data.campaignLive),
      cards: (response.data.cards ?? []) as {
        id: string;
        status: string;
        createdAt: string;
        revealedAt: string | null;
        prize: { label: string; type: string; value: number } | null;
      }[],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      campaignLive: false,
      cards: [],
      message: errorMessage(error, "Could not load your scratch cards."),
    };
  }
}

export async function revealMyScratchCard(cardId: string) {
  try {
    const response = await apiClient.post(`/customer/me/scratch/${cardId}/reveal`);
    return {
      success: true as const,
      prize: response.data.prize,
      voucher: response.data.voucher ?? null,
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      message: errorMessage(error, "Could not reveal that card."),
    };
  }
}

export async function fetchMyCoupons() {
  try {
    const response = await apiClient.get("/customer/me/coupons");
    return {
      success: true as const,
      coupons: (response.data.coupons ?? []) as {
        code: string;
        label: string;
        description: string;
        type: string;
        value: number;
        minOrderValue: number;
        validUntil: string | null;
        used: number;
        usageLimit: number | null;
      }[],
    };
  } catch (error: unknown) {
    return {
      success: false as const,
      coupons: [],
      message: errorMessage(error, "Could not load your offers."),
    };
  }
}

export async function updatePreferences(
  preferences: Partial<CustomerPreferences>
): Promise<{ success: boolean; customer?: CustomerProfile; message?: string }> {
  try {
    const response = await apiClient.patch("/customer/me/preferences", preferences);
    return { success: true, customer: response.data.customer };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "Could not save that preference."),
    };
  }
}

export async function updateProfileName(name: string): Promise<{
  success: boolean;
  customer?: CustomerProfile;
  message?: string;
}> {
  try {
    const response = await apiClient.patch("/customer/me", { name });
    return { success: true, customer: response.data.customer };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "Could not save your name."),
    };
  }
}

/**
 * Resolve the café a table belongs to, for the "Call the restaurant" row.
 * Both endpoints are public and the lookup is non-fatal.
 */
export async function getCafeContactForTable(
  tableId: string
): Promise<{ phone?: string; name?: string }> {
  try {
    const tableRes = await apiClient.get(`/tables/public/${tableId}`);
    const cafeId = tableRes.data?.table?.cafeId;
    if (!cafeId) return {};

    const cafeRes = await apiClient.get(`/cafe/public/${cafeId}`);
    return {
      phone: cafeRes.data?.cafe?.phone || undefined,
      name: cafeRes.data?.cafe?.name || undefined,
    };
  } catch {
    return {};
  }
}

export async function requestEmailOtp(
  email: string
): Promise<{ success: boolean; message: string; devCode?: string }> {
  try {
    const response = await apiClient.post("/customer/me/email/request-otp", { email });
    return {
      success: true,
      message: response.data.message || "We sent a code to your email",
      devCode: response.data.devCode,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "Could not send a code."),
    };
  }
}

export async function verifyEmailOtp(
  email: string,
  code: string
): Promise<{ success: boolean; customer?: CustomerProfile; message?: string }> {
  try {
    const response = await apiClient.post("/customer/me/email/verify-otp", { email, code });
    return { success: true, customer: response.data.customer };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "That code did not work."),
    };
  }
}

/**
 * Request permanent account anonymization under DPDP Act 2023 Right to Erasure (Section 12).
 * Clears local next.js customer session cookie and returns outcome message.
 */
export async function anonymizeMyAccount(): Promise<{ success: boolean; message: string }> {
  try {
    const response = await apiClient.post("/customer/me/anonymize");
    const cookieStore = await cookies();
    cookieStore.delete("customer_token");
    return {
      success: true,
      message:
        response.data?.message ||
        "Your account has been permanently anonymized in accordance with DPDP Act 2023.",
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: errorMessage(error, "Could not anonymize account. Please try again."),
    };
  }
}