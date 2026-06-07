"use server";

import { apiClient } from "@/lib/apiClient";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function loginAdmin(prevState: any, formData: FormData) {
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
  } catch (error: any) {
    console.error("Login error:", error);
    const message = error.response?.data?.message || "Invalid email or password.";
    return { error: message };
  }

  redirect("/admin/orders");
}

export async function logoutAdmin() {
  const cookieStore = await cookies();
  cookieStore.delete("admin_token");
  redirect("/admin/login");
}

export async function getCurrentUserAction() {
  try {
    const response = await apiClient.get("/auth/me");
    if (response.data && response.data.user) {
      return { success: true, user: response.data.user };
    }
    return { success: false, error: "Failed to load user" };
  } catch (error: any) {
    console.error("GetCurrentUser error:", error);
    const message = error.response?.data?.message || "Failed to load user info.";
    return { success: false, error: message };
  }
}

