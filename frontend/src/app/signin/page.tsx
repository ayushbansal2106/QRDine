import React from "react";
import { SignInClient } from "@/components/customer/SignInClient";
import { apiClient } from "@/lib/apiClient";

interface SignInPageProps {
  searchParams: Promise<{ next?: string; cafeId?: string }>;
}

/**
 * Guest sign-in (Module #09).
 *
 * `next` and `cafeId` are accepted in the query string so the guest returns to
 * wherever they came from. The destination is constrained to a path on this
 * origin — an unvalidated `next` is an open redirect.
 */
export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;

  // Only same-origin paths are honoured; `//evil.com` and absolute URLs are not.
  const rawNext = params.next || "/profile";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/profile";

  // The café name is a nicety for the screen, so a failure must not block
  // signing in — the OTP only needs the id.
  let cafeName: string | null = null;
  const cafeId = params.cafeId || null;
  try {
    if (cafeId) {
      const cafe = await apiClient.get(`/cafe/public/${cafeId}`);
      cafeName = cafe.data?.cafe?.name || null;
    }
  } catch {
    cafeName = null;
  }

  return (
    <SignInClient next={next} cafeId={cafeId} cafeName={cafeName} backHref="/welcome" />
  );
}