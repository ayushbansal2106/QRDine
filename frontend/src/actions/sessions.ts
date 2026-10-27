"use server";
import { apiErrorMessage, apiErrorStatus } from "@/lib/errorMessage";

import { apiClient } from "@/lib/apiClient";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * Sets the guest token as an httpOnly cookie on the Next.js domain.
 * This prevents XSS from reading the token while making it available
 * to Server Actions via the apiClient interceptor (which reads cookies()
 * and forwards as x-guest-token header).
 */
async function setGuestTokenCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set("guest_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24, // 24 hours
    path: "/",
    sameSite: "lax",
  });
}

/**
 * Drop `guestToken` from a session document before it crosses to the client.
 *
 * The token is the guest's capability to act on their session, so it must
 * never serialise into an RSC payload — it lives in the httpOnly cookie only.
 * Three call sites needed this, so it is one typed function rather than three
 * `const { guestToken, ...session }` discards that lint cannot verify.
 */
function withoutGuestToken<T extends { guestToken?: string }>(
  rawSession: T
): Omit<T, "guestToken"> {
  // Built by copying and deleting rather than by rest-destructuring, so there
  // is no discarded binding for the linter to flag.
  const copy: Record<string, unknown> = { ...(rawSession ?? {}) };
  delete copy.guestToken;
  return copy as Omit<T, "guestToken">;
}

export async function createSession(
  tableId: string,
  customerName: string,
  customerEmail: string,
  deviceId?: string,
  forceNew?: boolean
) {
  try {
    const response = await apiClient.post("/sessions", {
      tableId,
      customerName,
      customerEmail,
      deviceId,
      forceNew,
    });

    const { session: rawSession } = response.data;

    // Set guest token as httpOnly cookie (never exposed to client JS)
    if (rawSession?.guestToken) {
      await setGuestTokenCookie(rawSession.guestToken);
    }

    // Strip guestToken from response — cookie handles it
    const session = withoutGuestToken(rawSession);

    return {
      success: true,
      session,
    };
  } catch (error: unknown) {
    console.error("Failed to create session:", error);
    const message =
      apiErrorMessage(error, "Failed to create dining session.");
    throw new Error(message);
  }
}

export async function getActiveSession(tableId: string, deviceId?: string) {
  try {
    const response = await apiClient.get(
      `/sessions/table/${tableId}/active`,
      { params: { deviceId } }
    );

    const { session: rawSession } = response.data;

    // Set guest token cookie if session exists (for returning users)
    if (rawSession?.guestToken) {
      await setGuestTokenCookie(rawSession.guestToken);
    }

    // Strip guestToken from response — cookie handles it
    const session = withoutGuestToken(rawSession);

    return {
      success: true,
      session,
      sessionLocked: response.data.sessionLocked,
      activeSession: response.data.activeSession,
      sameDevice: response.data.sameDevice,
    };
  } catch (error: unknown) {
    if (apiErrorStatus(error) === 404) {
      return { success: false, session: null };
    }
    console.error("Failed to check active session:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to check session.")
    );
  }
}

/**
 * `GET /sessions/:id/bill-preview` — a consolidated view of every order in the
 * session, plus staff-raised adjustments (`backend/src/controllers/sessionController.js`).
 */
export interface BillPreview {
  subtotal: number;
  additions: number;
  discounts: number;
  gst: number;
  totalAmount: number;
  orderCount: number;
  adjustments: BillAdjustment[];
  items: { name: string; quantity: number; price: number }[];
}

/** One staff-raised line on the bill (`DiningSession.adjustments[]`). */
export interface BillAdjustment {
  type: "addition" | "discount";
  description: string;
  amount: number;
  addedBy?: string;
  approvedBy?: string;
  approvalReason?: string;
  createdAt?: string;
}

export async function getBillPreview(sessionId: string) {
  try {
    const response = await apiClient.get(
      `/sessions/${sessionId}/bill-preview`
    );
    return {
      success: true as const,
      bill: response.data.bill as BillPreview,
    };
  } catch (error: unknown) {
    console.error("Failed to get bill preview:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch bill preview.")
    );
  }
}

export async function submitPaymentPreference(
  sessionId: string,
  paymentMethod: "paid_counter" | "paid_online",
  participantId?: string | null
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/submit-payment`,
      // The backend identifies *which* guest is asking for the bill and checks
      // they are the table host. Omitting it made every request fail as
      // "You are not a participant in this dining session" — the host was
      // refusing their own bill.
      { paymentMethod, participantId: participantId || undefined }
    );

    revalidatePath("/cafe/bills");

    return {
      success: true,
      message: response.data.message,
      session: response.data.session,
    };
  } catch (error: unknown) {
    console.error("Failed to submit payment preference:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to submit payment preference.")
    );
  }
}

export async function getSessionsAdmin(filters?: {
  status?: string;
  page?: number;
  limit?: number;
  tableNumber?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  try {
    const response = await apiClient.get("/sessions", { params: filters });
    return response.data;
  } catch (error: unknown) {
    console.error("Failed to get sessions:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch sessions.")
    );
  }
}

export async function getSessionDetails(sessionId: string) {
  try {
    const response = await apiClient.get(`/sessions/${sessionId}`);
    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: unknown) {
    console.error("Failed to get session details:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to fetch session details.")
    );
  }
}

/**
 * Raise a table's bill from the counter.
 *
 * The guest walked up to the till and asked for the bill instead of tapping Bill
 * in the app, so the session is still `active`. This moves it to the same
 * `awaiting_payment` state the guest's own button produces, from where the
 * board's normal Take payment flow applies unchanged.
 *
 * No served-gate on purpose — a guest is entitled to pay and leave.
 */
export async function requestBillForTable(sessionId: string) {
  try {
    const response = await apiClient.post(`/sessions/${sessionId}/request-bill`);

    revalidatePath("/cafe/bills");

    return {
      success: true,
      alreadyRequested: response.data.alreadyRequested === true,
      message: response.data.message,
      session: response.data.session,
    };
  } catch (error: unknown) {
    console.error("Failed to raise bill:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to raise the bill.")
    );
  }
}

export async function markSessionPaid(
  sessionId: string,
  paymentMethod: "paid_counter" | "paid_online"
) {
  try {
    const response = await apiClient.put(
      `/sessions/${sessionId}/mark-paid`,
      { paymentMethod }
    );

    revalidatePath("/cafe/bills");
    revalidatePath("/cafe/sales");

    return {
      success: true,
      session: response.data.session,
      invoice: response.data.invoice,
      message: response.data.message,
    };
  } catch (error: unknown) {
    console.error("Failed to mark session paid:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to process payment.")
    );
  }
}

/**
 * Close a table session without settling the bill (owner/manager).
 *
 * Paying a bill already closes the session, so this is the escape hatch for
 * what payment cannot express: a walkout, a comped table, a session stranded by
 * a crashed till. The backend refuses while orders are unpaid unless
 * `writeOff` is set, and either way it writes to the immutable ledger — so the
 * reason is not decoration, it is the only record of why a table left without
 * money.
 */
export async function closeSession(
  sessionId: string,
  reason: string,
  writeOff = false
) {
  try {
    const response = await apiClient.post(`/sessions/${sessionId}/close`, {
      reason,
      writeOff,
    });

    revalidatePath("/cafe/bills");
    revalidatePath("/cafe/sales");

    return {
      success: true,
      message: response.data.message,
      writtenOffAmount: response.data.writtenOffAmount ?? 0,
      session: response.data.session,
    };
  } catch (error: unknown) {
    console.error("Failed to close session:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to close session.")
    );
  }
}

export async function addBillAdjustment(
  sessionId: string,
  type: "addition" | "discount",
  description: string,
  amount: number,
  approvalReason?: string
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/adjustments`,
      { type, description, amount, approvalReason }
    );

    revalidatePath("/cafe/bills");

    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: unknown) {
    console.error("Failed to add bill adjustment:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to add bill adjustment.")
    );
  }
}

export async function joinSession(
  tableId: string,
  name: string,
  deviceId?: string
) {
  try {
    const response = await apiClient.post("/sessions/join", {
      tableId,
      name,
      deviceId,
    });

    const { session: rawSession } = response.data;

    // Set guest token as httpOnly cookie (never exposed to client JS)
    if (rawSession?.guestToken) {
      await setGuestTokenCookie(rawSession.guestToken);
    }

    // Strip guestToken from response — cookie handles it
    const session = withoutGuestToken(rawSession);

    return {
      success: true,
      session,
    };
  } catch (error: unknown) {
    console.error("Failed to join session:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to join dining session.")
    );
  }
}

export async function leaveSession(
  sessionId: string,
  participantId: string
) {
  try {
    await apiClient.post(
      `/sessions/${sessionId}/leave`,
      { participantId }
    );
    return { success: true };
  } catch (error: unknown) {
    console.error("Failed to leave session:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to leave session.")
    );
  }
}

export async function transferOwnership(
  sessionId: string,
  newOwnerParticipantId: string,
  email?: string
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/transfer-ownership`,
      { newOwnerParticipantId, email }
    );
    
    revalidatePath("/cafe/bills");
    return {
      success: true,
      session: response.data.session,
    };
    } catch (error: unknown) {
    console.error("Failed to transfer ownership:", error);
    throw new Error(
      apiErrorMessage(error, "Failed to transfer ownership.")
    );
  }
}

/**
 * Clear the guest token httpOnly cookie when the session ends.
 * Called from SessionGate on session-paid / session-closed socket events.
 */
export async function clearGuestTokenCookie() {
  const cookieStore = await cookies();
  cookieStore.delete("guest_token");
}

export async function getActivityFeed(sessionId: string) {
  try {
    const response = await apiClient.get(
      `/sessions/${sessionId}/activity`
    );
    return {
      success: true,
      activityFeed: response.data.activityFeed,
    };
  } catch (error: unknown) {
    console.error("Failed to fetch activity feed:", error);
    return { success: false, activityFeed: [] };
  }
}
