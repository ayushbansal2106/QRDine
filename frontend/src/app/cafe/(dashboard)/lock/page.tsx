import React from "react";
import { LockClient } from "./LockClient";

export const dynamic = "force-dynamic";

export default async function AdminLockPage() {
  return <LockClient />;
}
