import React from "react";
import { RequestsClient } from "./RequestsClient";
import { WaiterRequest } from "@/types";
import { apiClient } from "@/lib/apiClient";
import { getCurrentUserAction } from "@/actions/auth";
import { requirePathAccess } from "@/lib/session";
import { asRawWaiterRequests, mapRawWaiterRequest } from "@/lib/mappers";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/requests");

  let requests: WaiterRequest[] = [];
  let cafeId = "";

  try {
    const [reqsRes, userRes] = await Promise.all([
      apiClient.get("/requests", { params: { status: "pending" } }),
      getCurrentUserAction(),
    ]);

    requests = asRawWaiterRequests(reqsRes.data.requests).map(mapRawWaiterRequest);
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch admin waiter requests or user details:", error);
  }

  return <RequestsClient initialRequests={requests} cafeId={cafeId} />;
}