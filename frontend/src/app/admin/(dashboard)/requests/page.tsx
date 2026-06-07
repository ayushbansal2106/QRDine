import React from "react";
import { RequestsClient } from "./RequestsClient";
import { WaiterRequest } from "@/types";
import { apiClient } from "@/lib/apiClient";
import { getCurrentUserAction } from "@/actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminRequestsPage() {
  let dbRequests: any[] = [];
  let cafeId = "";

  try {
    const [reqsRes, userRes] = await Promise.all([
      apiClient.get("/requests", { params: { status: "pending" } }),
      getCurrentUserAction(),
    ]);

    dbRequests = reqsRes.data.requests || [];
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch admin waiter requests or user details:", error);
  }

  // Transform MongoDB waiter requests to frontend structure
  const requests: WaiterRequest[] = dbRequests.map((req: any) => ({
    id: req._id,
    tableId: req.tableId?._id || "",
    table: req.tableId ? {
      id: req.tableId._id,
      tableNumber: parseInt(req.tableId.tableNumber, 10) || 0,
      qrCodeUrl: req.tableId.qrCodeUrl || `/table/${req.tableId.tableNumber}`,
      status: req.tableId.isActive ? "FREE" : "ASSISTANCE_REQUIRED" as any,
      createdAt: new Date(req.tableId.createdAt),
    } : undefined,
    requestType: req.requestType || "Assistance Requested",
    status: (req.status || "PENDING").toUpperCase() as any,
    createdAt: new Date(req.createdAt),
  }));

  return <RequestsClient initialRequests={requests} cafeId={cafeId} />;
}
