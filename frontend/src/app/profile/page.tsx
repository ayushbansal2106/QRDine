import React from "react";
import { redirect } from "next/navigation";
import { ProfileClient } from "@/components/customer/ProfileClient";
import { fetchMyProfile, isCustomerSignedIn } from "@/actions/customerApp";

/**
 * Guest profile (Module #09).
 *
 * Everything is read server-side through the httpOnly `customer_token` cookie,
 * so the counters are correct on first paint and no profile data is handed to
 * the browser bundle before the customer asked for it.
 *
 * The café's phone is resolved client-side instead: the table lives in a
 * persisted browser store, which a server component cannot read.
 */
export default async function ProfilePage() {
  if (!(await isCustomerSignedIn())) {
    // Sign-in, never `/`. The root route redirects to the staff portal, so a
    // guest without a profile was being dropped into the admin dashboard.
    redirect("/signin?next=%2Fprofile");
  }

  const { customer, stats } = await fetchMyProfile();

  if (!customer || !stats) {
    // The cookie outlived its profile (deleted, or a blocked account). Clear
    // the way through sign-in rather than into the staff portal.
    redirect("/signin?next=%2Fprofile");
  }

  return (
    <ProfileClient
      initialProfile={customer}
      initialStats={stats}
      backHref="/welcome"
    />
  );
}