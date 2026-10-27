import React from "react";
import { apiClient } from "@/lib/apiClient";
import { Customer } from "@/types";
import { mapRawCustomer, type RawCustomer } from "@/lib/mappers";
import { CustomersClient } from "./CustomersClient";
import { requirePathAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/customers");
  let customers: Customer[] = [];

  try {
    const res = await apiClient.get("/customers", { params: { limit: 50, sort: "recent" } });
    customers = ((res.data.customers ?? []) as RawCustomer[]).map(mapRawCustomer);
  } catch (error) {
    console.error("Failed to load customers:", error);
  }

  return <CustomersClient initialCustomers={customers} />;
}
