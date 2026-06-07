import React from "react";
import { BillsClient } from "@/components/admin/BillsClient";
import { getCurrentUserAction } from "@/actions/auth";

export const dynamic = "force-dynamic";

export default async function AdminBillsPage() {
  let cafeId = "";

  try {
    const userRes = await getCurrentUserAction();
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch user details:", error);
  }

  return <BillsClient cafeId={cafeId} />;
}
