import React from "react";
import { WelcomeClient } from "@/components/customer/WelcomeClient";

/**
 * Neutral guest landing page. See `WelcomeClient` for why `/` cannot serve this
 * role — that path is the staff entry point.
 */
export default function WelcomePage() {
  return <WelcomeClient />;
}