import React from "react";
import { BillsClient } from "@/components/admin/BillsClient";
import { getCurrentUserAction } from "@/actions/auth";
import { requirePathAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminBillsPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  // Returns the operator, whose effective permissions the board needs: a
  // cashier may take payment here but must not be offered Adjust.
  const operator = await requirePathAccess("/cafe/bills");
  let cafeId = "";

  try {
    const userRes = await getCurrentUserAction();
    if (userRes.success && userRes.user) {
      cafeId = userRes.user.cafeId || "";
    }
  } catch (error) {
    console.error("Failed to fetch user details:", error);
  }

  return <BillsClient cafeId={cafeId} permissions={operator.permissions ?? []} />;
}
