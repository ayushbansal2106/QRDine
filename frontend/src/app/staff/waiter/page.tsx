import React from "react";
import { WaiterClient } from "./WaiterClient";

export const dynamic = "force-dynamic";

export default async function WaiterHandheldPage() {
  return <WaiterClient />;
}
