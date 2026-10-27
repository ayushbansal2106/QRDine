import axios from "axios";
import { apiErrorBody, apiErrorStatus } from "@/lib/errorMessage";

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
  // Client-side fallback: read from document.cookie
  if (typeof document !== "undefined") {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    if (match) return match[1];
    return null;
  }

  // Server-side: use Next.js cookies() dynamically to avoid Client Component static import errors
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const cookie = cookieStore.get(name);
    if (cookie?.value) return cookie.value;
  } catch {
    // cookies() throws in non-request contexts (build, client-side)
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
// 4. Customer token from customer_token cookie (signed-in profile requests)
apiClient.interceptors.request.use(
  async (config) => {
    try {
      // 1. Attach JWT Bearer token (admin authentication or superadmin authentication)
      const adminToken = await getCookieValue("admin_token");
      const superAdminToken = await getCookieValue("superadmin_token");
      
      let token = adminToken || superAdminToken;
      if (config.url?.startsWith("/superadmin") || config.url?.startsWith("superadmin")) {
        token = superAdminToken || adminToken;
      }
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // 2. Attach CSRF token on state-changing requests (admin protection).
      //    The backend validates the double-submit pattern by comparing the
      //    `x-csrf-token` header against its own `csrf_token` cookie, so the
      //    cookie has to travel with the request too. Server-side axios does not
      //    forward cookies on its own, hence the explicit Cookie header.
      if (isStateChangingMethod(config.method)) {
        const csrfToken = await getCookieValue("csrf_token");
        if (csrfToken) {
          config.headers["x-csrf-token"] = csrfToken;

          // Only a server process may set the Cookie header. In the browser the
          // fetch spec forbids it outright — Chrome logs "Refused to set unsafe
          // header "Cookie"" and drops it — and the backend's double-submit
          // check then fails with "CSRF token missing", because the frontend
          // origin's cookie is not attached to a cross-origin API request
          // either. Client-side mutations therefore cannot pass CSRF by design:
          // they must go through a Server Action, where this header is legal.
          // See `src/actions/superadmin.ts` for the pattern.
          if (typeof window === "undefined") {
            config.headers.Cookie = `csrf_token=${csrfToken}`;
          }
        }
      }

      // 3. Attach guest session token for customer API calls
      //    (order creation, waiter requests, bill operations, etc.)
      const guestToken = await getCookieValue("guest_token");
      if (guestToken) {
        config.headers["x-guest-token"] = guestToken;
      }

      // 4. Attach the signed-in customer token. The cookie is httpOnly (so it
      //    cannot be exfiltrated by script) but the frontend and backend are
      //    cross-origin, so Next reads it and forwards it as a header — the
      //    same pattern used for the guest token above.
      const customerToken = await getCookieValue("customer_token");
      if (customerToken) {
        config.headers["x-customer-token"] = customerToken;
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
    if (apiErrorStatus(error) === 403) {
      const message = apiErrorBody(error)?.message;
      if (
        typeof message === "string" &&
        (message.includes("CSRF token missing") ||
          message.includes("CSRF token mismatch"))
      ) {
        console.warn("CSRF validation failed. Consider refreshing the page.");
      }
    }
    return Promise.reject(error);
  }
);
