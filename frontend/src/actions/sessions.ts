"use server";

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
    const { guestToken, ...session } = rawSession || {};

    return {
      success: true,
      session,
    };
  } catch (error: any) {
    console.error("Failed to create session:", error);
    const message =
      error.response?.data?.message || "Failed to create dining session.";
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
    const { guestToken, ...session } = rawSession || {};

    return {
      success: true,
      session,
      sessionLocked: response.data.sessionLocked,
      activeSession: response.data.activeSession,
      sameDevice: response.data.sameDevice,
    };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { success: false, session: null };
    }
    console.error("Failed to check active session:", error);
    throw new Error(
      error.response?.data?.message || "Failed to check session."
    );
  }
}

export async function getBillPreview(sessionId: string) {
  try {
    const response = await apiClient.get(
      `/sessions/${sessionId}/bill-preview`
    );
    return {
      success: true,
      bill: response.data.bill,
    };
  } catch (error: any) {
    console.error("Failed to get bill preview:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch bill preview."
    );
  }
}

export async function submitPaymentPreference(
  sessionId: string,
  paymentMethod: "paid_counter" | "paid_online"
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/submit-payment`,
      { paymentMethod }
    );

    revalidatePath("/admin/bills");

    return {
      success: true,
      message: response.data.message,
      session: response.data.session,
    };
  } catch (error: any) {
    console.error("Failed to submit payment preference:", error);
    throw new Error(
      error.response?.data?.message || "Failed to submit payment preference."
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
  } catch (error: any) {
    console.error("Failed to get sessions:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch sessions."
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
  } catch (error: any) {
    console.error("Failed to get session details:", error);
    throw new Error(
      error.response?.data?.message || "Failed to fetch session details."
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

    revalidatePath("/admin/bills");
    revalidatePath("/admin/sales");

    return {
      success: true,
      session: response.data.session,
      invoice: response.data.invoice,
      message: response.data.message,
    };
  } catch (error: any) {
    console.error("Failed to mark session paid:", error);
    throw new Error(
      error.response?.data?.message || "Failed to process payment."
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

    revalidatePath("/admin/bills");

    return {
      success: true,
      session: response.data.session,
    };
  } catch (error: any) {
    console.error("Failed to add bill adjustment:", error);
    throw new Error(
      error.response?.data?.message || "Failed to add bill adjustment."
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
    const { guestToken, ...session } = rawSession || {};

    return {
      success: true,
      session,
    };
  } catch (error: any) {
    console.error("Failed to join session:", error);
    throw new Error(
      error.response?.data?.message || "Failed to join dining session."
    );
  }
}

export async function leaveSession(
  sessionId: string,
  participantId: string
) {
  try {
    const response = await apiClient.post(
      `/sessions/${sessionId}/leave`,
      { participantId }
    );
    return { success: true };
  } catch (error: any) {
    console.error("Failed to leave session:", error);
    throw new Error(
      error.response?.data?.message || "Failed to leave session."
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
    
    revalidatePath("/admin/bills");
    return {
      success: true,
      session: response.data.session,
    };
    } catch (error: any) {
    console.error("Failed to transfer ownership:", error);
    throw new Error(
      error.response?.data?.message || "Failed to transfer ownership."
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
  } catch (error: any) {
    console.error("Failed to fetch activity feed:", error);
    return { success: false, activityFeed: [] };
  }
}
