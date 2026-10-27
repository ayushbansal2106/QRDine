import React from "react";
import { getDashboardData } from "@/actions/dashboard";
import { requirePathAccess } from "@/lib/session";
import { LOCALE } from "@/lib/format";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  // Guard before any fetch so an unauthorised operator is redirected instead
  // of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/dashboard");

  const data = await getDashboardData();

  // Formatted here, on the server, with a pinned locale. Doing this inside the
  // client component meant the browser re-evaluated the locale during hydration
  // and rendered different text than the server had sent.
  const todayLabel = new Date().toLocaleDateString(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return <DashboardClient data={data} todayLabel={todayLabel} />;
}