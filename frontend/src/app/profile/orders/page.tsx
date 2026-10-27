import React from "react";
import { redirect } from "next/navigation";
import { OrderHistoryClient } from "@/components/customer/OrderHistoryClient";
import { isCustomerSignedIn } from "@/actions/customerApp";

/** Customer order history (Module #09), paged by time window. */
export default async function OrderHistoryPage() {
  if (!(await isCustomerSignedIn())) {
    // `/` is the staff portal entry point — never send a guest there.
    redirect("/signin?next=%2Fprofile%2Forders");
  }

  return <OrderHistoryClient />;
}