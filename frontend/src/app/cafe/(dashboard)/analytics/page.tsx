import React from "react";
import { AnalyticsDashboardClient } from "@/components/admin/analytics/AnalyticsDashboardClient";
import { LiveTelemetry } from "@/components/admin/analytics/LiveTelemetry";
import { getCurrentUserAction } from "@/actions/auth";
import { requirePathAccess } from "@/lib/session";
import { FeatureGate } from "@/components/subscription/FeatureGate";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/analytics");
  let cafeId = "";
  try {
    const userRes = await getCurrentUserAction();
    if (userRes.success && userRes.user) cafeId = userRes.user.cafeId || "";
  } catch (error) {
    console.error("Failed to fetch user details:", error);
  }

  return (
    // Plan gate in front of the widgets themselves, not just the sidebar link.
    // Without it a Starter cafe that navigated here directly would render two
    // client dashboards that each fire a request the backend now refuses, and the
    // user would see console errors instead of an explanation. (`analytics` is
    // enforced on `GET /api/analytics/*` regardless — this is the UX half.)
    <FeatureGate feature="analytics" label="Sales analytics">
      <div className="p-md">
        <LiveTelemetry cafeId={cafeId} />
        <AnalyticsDashboardClient />
      </div>
    </FeatureGate>
  );
}