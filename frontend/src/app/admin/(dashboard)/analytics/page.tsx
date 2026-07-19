import React from "react";
import { AnalyticsDashboardClient } from "@/components/admin/analytics/AnalyticsDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  return <AnalyticsDashboardClient />;
}
