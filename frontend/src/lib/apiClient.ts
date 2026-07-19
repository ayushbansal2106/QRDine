import axios from "axios";
import { cookies } from "next/headers";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

/**
 * Read a cookie value from the Next.js request context.
 * Works in both server (via cookies()) and client (via document.cookie) contexts.
 */
async function getCookieValue(name: string): Promise<string | null> {
  // Server-side: use Next.js cookies()
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get(name);
    if (cookie?.value) return cookie.value;
  } catch {
    // cookies() throws in non-request contexts (build, client-side)
  }

  // Client-side fallback: read from document.cookie
  if (typeof document !== "undefined") {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (match) return match[1];
  }

  return null;
}

/**
 * State-changing HTTP methods that require CSRF protection.
 */
function isStateChangingMethod(method?: string): boolean {
  if (!method) return false;
  const upper = method.toUpperCase();
  return ["POST", "PUT", "PATCH", "DELETE"].includes(upper);
}

// Request interceptor to attach:
// 1. Bearer token from admin_token cookie
// 2. CSRF token from csrf_token cookie (state-changing requests only)
// 3. Guest token from guest_token cookie (customer session requests)
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const cookieStore = await cookies();

      // 1. Attach JWT Bearer token (admin authentication)
      const token = cookieStore.get("admin_token")?.value;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // 2. Attach CSRF token on state-changing requests (admin protection)
      if (isStateChangingMethod(config.method)) {
        const csrfToken = await getCookieValue("csrf_token");
        if (csrfToken) {
          config.headers["x-csrf-token"] = csrfToken;
        }
      }

      // 3. Attach guest session token for customer API calls
      //    (order creation, waiter requests, bill operations, etc.)
      const guestToken = await getCookieValue("guest_token");
      if (guestToken) {
        config.headers["x-guest-token"] = guestToken;
      }
    } catch {
      // cookies() can throw in non-request contexts like next build
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor — handle CSRF errors globally
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      const data = error.response.data;
      if (
        data?.message &&
        (data.message.includes("CSRF token missing") ||
          data.message.includes("CSRF token mismatch"))
      ) {
        console.warn("CSRF validation failed. Consider refreshing the page.");
      }
    }
    return Promise.reject(error);
  }
);
