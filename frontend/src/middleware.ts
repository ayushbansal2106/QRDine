import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * The backend uses a double-submit CSRF cookie, but it can only set that cookie
 * on its own origin (127.0.0.1:5001) — the browser never gives it to the
 * Next.js origin, so Server Actions could never read it and every mutation came
 * back 403. The Next.js origin therefore owns the cookie: mint it here if it is
 * missing, and `apiClient` forwards it to the backend as both the
 * `x-csrf-token` header and the `Cookie` header.
 */
const CSRF_COOKIE = "csrf_token";
const CSRF_TOKEN_LENGTH = 64; // 32 random bytes, hex encoded — matches the backend

function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_LENGTH / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hasValidCsrfCookie(request: NextRequest): boolean {
  const value = request.cookies.get(CSRF_COOKIE)?.value;
  return typeof value === "string" && value.length === CSRF_TOKEN_LENGTH;
}

/** Attach a freshly minted CSRF cookie to any outgoing response that lacks one. */
function ensureCsrfCookie<T extends NextResponse>(request: NextRequest, response: T): T {
  if (!hasValidCsrfCookie(request)) {
    response.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24,
      path: "/",
    });
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("admin_token")?.value;

  // Protect /admin routes (excluding /admin/login), /staff, and the waiter handheld.
  // "/cafe" is the tenant-facing prefix used by this app's admin shell.
  // Allow /cafe/signup and /cafe/login to be accessible without authentication.
  if (
    (pathname.startsWith("/cafe") && pathname !== "/cafe/login" && pathname !== "/cafe/signup") ||
    pathname.startsWith("/staff")
  ) {
    if (!token) {
      const loginUrl = new URL("/cafe/login", request.url);
      return ensureCsrfCookie(request, NextResponse.redirect(loginUrl));
    }
  }

  // Redirect authenticated admin away from login page, unless they just failed auth
  if (pathname === "/cafe/login" && token && !request.nextUrl.searchParams.has("clear")) {
    const dashboardUrl = new URL("/cafe/dashboard", request.url);
    return ensureCsrfCookie(request, NextResponse.redirect(dashboardUrl));
  }

  return ensureCsrfCookie(request, NextResponse.next());
}

export const config = {
  // The CSRF cookie must be minted on every response that can reach a
  // state-changing backend route, including staff, admin, and guest-facing
  // pages. Restricting it to admin/staff left guests with no token and turned
  // every profile/preference save into 403.
  matcher: [
    "/admin/:path*",
    "/staff/:path*",
    "/cafe/:path*",
    "/table/:path*",
    "/cart/:path*",
    "/checkout/:path*",
    "/order/:path*",
    "/profile/:path*",
    "/signin",
    "/welcome",
  ],
};
