"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { Operator } from "@/types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * State shape for the login form's `useActionState`.
 *
 * The action never reads `prevState` — it is required by the `useActionState`
 * signature, not used. Typing it means the action and the `initialState` the
 * page passes cannot drift apart.
 */
export type LoginState = { error: string };

export async function loginAdmin(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Please enter both email and password." };
  }

  try {
    const response = await apiClient.post("/auth/login", {
      email,
      password,
    });

    const { token } = response.data;

    if (!token) {
      return { error: "Authentication failed. No token received from backend." };
    }

    const cookieStore = await cookies();
    cookieStore.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, // 1 week
      path: "/",
      sameSite: "strict",
    });
  } catch (error: unknown) {
    console.error("Login error:", error);
    const message = apiErrorMessage(error, "Invalid email or password.");
    return { error: message };
  }

  redirect("/cafe/dashboard");
}

export async function logoutAdmin() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_token");
  redirect("/cafe/login");
}

// ─── Module #08 — Shared-terminal PIN login / operator switch ───

export async function getOperators() {
  try {
    const response = await apiClient.get("/auth/operators");
    return {
      success: true as const,
      operators: response.data.operators as Operator[],
      currentUserId: response.data.currentUserId as string,
    };
  } catch (error: unknown) {
    console.error("Failed to load operators:", error);
    return {
      success: false as const,
      operators: [] as Operator[],
      currentUserId: "",
      message: apiErrorMessage(error, "Failed to load operators."),
    };
  }
}

/**
 * Verify a staff PIN and swap the device's `admin_token` to that operator.
 * The device stays authenticated; only the active identity changes.
 */
export async function switchOperator(userId: string, pin: string) {
  if (!userId || !pin) {
    return { success: false as const, message: "Select an operator and enter their PIN." };
  }

  try {
    const response = await apiClient.post("/auth/pin-login", { userId, pin });
    const { token } = response.data;

    if (!token) {
      return { success: false as const, message: "PIN login failed. No token received." };
    }

    const cookieStore = await cookies();
    cookieStore.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
      sameSite: "strict",
    });

    return { success: true as const, user: response.data.user };
  } catch (error: unknown) {
    console.error("PIN login error:", error);
    return {
      success: false as const,
      message: apiErrorMessage(error, "Incorrect PIN."),
    };
  }
}

export async function getCurrentUserAction() {
  try {
    const response = await apiClient.get("/auth/me");
    if (response.data && response.data.user) {
      return { success: true, user: response.data.user };
    }
    return { success: false, error: "Failed to load user" };
  } catch (error: unknown) {
    console.error("GetCurrentUser error:", error);
    const message = apiErrorMessage(error, "Failed to load user info.");
    return { success: false, error: message };
  }
}

