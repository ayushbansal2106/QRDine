import React from "react";
import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage } from "@/lib/errorMessage";
import { GeofenceConfig, GeofenceStats, GeofenceFlag } from "@/types";
import { GeofenceClient } from "./GeofenceClient";
import { requirePathAccess } from "@/lib/session";
import { planGate } from "@/lib/planGate";

export const dynamic = "force-dynamic";

export default async function AdminGeofencePage() {

  // Guard before any data fetch so an unauthorised operator is redirected
  // instead of triggering a 403 that surfaces as a console error.
  await requirePathAccess("/cafe/geofence");

  // Plan gate before the fetch — Fraud Watch is Pro-only. Server-side geofence
  // enforcement itself keeps running for every cafe; this is the admin console.
  const gate = await planGate("geofence", "Fraud watch");
  if (gate) return gate;

  let config: GeofenceConfig | null = null;
  let stats: GeofenceStats | null = null;
  let flags: GeofenceFlag[] = [];
  let loadError: string | null = null;

  try {
    const [configRes, flagsRes] = await Promise.all([
      apiClient.get("/geofence/config"),
      apiClient.get("/geofence/flags", { params: { limit: 50 } }),
    ]);
    config = configRes.data.config || null;
    stats = configRes.data.stats || null;
    flags = flagsRes.data.flags || [];
  } catch (error: unknown) {
    console.error("Failed to load geofence data:", error);
    loadError =
      apiErrorMessage(error, "Could not load the geofence settings. Make sure your role has the Fraud Watch permission.");
  }

  return (
    <GeofenceClient
      initialConfig={config}
      initialStats={stats}
      initialFlags={flags}
      loadError={loadError}
    />
  );
}