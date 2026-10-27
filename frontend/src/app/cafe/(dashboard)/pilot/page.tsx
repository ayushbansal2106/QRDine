import React from "react";
import { Metadata } from "next";
import { PilotClient } from "./PilotClient";

export const metadata: Metadata = {
  title: "14-Day Physical Pilot Rollout | QRDine Operations",
  description: "Track the 3-phase physical restaurant pilot rollout, daily shift reconciliation, and General Availability sign-off.",
};

export default function PilotPage() {
  return <PilotClient />;
}
