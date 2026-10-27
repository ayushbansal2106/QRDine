"use client";

import React, { useCallback, useState } from "react";
import {
  getGeofenceConfig,
  getGeofenceFlags,
  resolveGeofenceFlag,
  updateGeofenceConfig,
} from "@/actions/geofence";
import type { GeofenceConfig, GeofenceFlag, GeofenceStats } from "@/types";

interface Props {
  initialConfig: GeofenceConfig | null;
  initialStats: GeofenceStats | null;
  initialFlags: GeofenceFlag[];
  loadError: string | null;
}

const REASON_LABELS: Record<string, string> = {
  outside_radius: "Outside the delivery radius",
  location_missing_or_invalid: "No usable GPS fix",
  geofence_disabled: "Geofence was off — no check ran",
  accuracy_missing: "Device sent no accuracy value",
  accuracy_implausibly_precise: "Accuracy impossibly precise (spoofed?)",
  accuracy_too_low: "GPS too coarse to verify",
  velocity_limit_exceeded: "Order burst from this table",
  impossible_travel: "Impossible travel since the last order",
  unknown_cafe: "Tenant could not be resolved",
};

const reasonLabel = (reason: string) => REASON_LABELS[reason] || reason;

const RiskBadge: React.FC<{ score: number }> = ({ score }) => {
  const tone =
    score >= 60 ? "bg-error/10 text-error" : score >= 30 ? "bg-warning/10 text-warning" : "bg-surface-container text-on-surface-variant";
  return <span className={`px-sm py-xs rounded-full text-label-sm font-semibold ${tone}`}>risk {score}</span>;
};

export const GeofenceClient: React.FC<Props> = ({ initialConfig, initialStats, initialFlags, loadError }) => {
  const [config, setConfig] = useState<GeofenceConfig | null>(initialConfig);
  const [stats, setStats] = useState<GeofenceStats | null>(initialStats);
  const [flags, setFlags] = useState<GeofenceFlag[]>(initialFlags);
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? false);
  const [lat, setLat] = useState(String(initialConfig?.lat ?? ""));
  const [lng, setLng] = useState(String(initialConfig?.lng ?? ""));
  const [radius, setRadius] = useState(String(initialConfig?.radiusMeters ?? 50));
  const [fallback, setFallback] = useState<"flag" | "reject">(initialConfig?.fallback ?? "flag");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const refreshFlags = useCallback(async () => {
    const [flagsRes, configRes] = await Promise.all([getGeofenceFlags({ limit: 50 }), getGeofenceConfig()]);
    if (flagsRes.success && flagsRes.flags) setFlags(flagsRes.flags);
    if (configRes.success && configRes.config) setConfig(configRes.config);
    if (configRes.success && configRes.stats) setStats(configRes.stats);
  }, []);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage({ tone: "error", text: "This device cannot report a location." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setMessage({ tone: "success", text: "Cafe coordinates filled from this device." });
      },
      () => setMessage({ tone: "error", text: "Location permission denied — enter coordinates manually." }),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const result = await updateGeofenceConfig({
      enabled,
      lat: lat === "" ? null : Number(lat),
      lng: lng === "" ? null : Number(lng),
      radiusMeters: Number(radius) || 50,
      fallback,
    });
    setSaving(false);
    if (result.success && result.config) {
      setConfig(result.config);
      setMessage({ tone: "success", text: "Geofence settings saved." });
      refreshFlags();
    } else {
      setMessage({ tone: "error", text: result.message || "Could not save settings." });
    }
  };

  const resolve = async (flag: GeofenceFlag, outcome: "confirmed_legit" | "confirmed_fraud") => {
    setResolvingId(flag.id);
    const result = await resolveGeofenceFlag(flag.id, outcome);
    setResolvingId(null);
    if (result.success) refreshFlags();
    else setMessage({ tone: "error", text: result.message || "Could not resolve this flag." });
  };

  return (
    <div className="p-lg bg-surface-container-lowest min-h-screen font-inter">
      <div className="max-w-6xl mx-auto flex flex-col gap-lg">
        <header>
          <h1 className="text-headline-lg text-on-surface font-semibold">Fraud Watch — Geo-location</h1>
          <p className="text-body-sm text-on-surface-variant mt-xs">
            Orders placed through the guest QR flow are checked against this radius on the server.
            Coordinates from a phone are advisory; the verdict is always recomputed here.
          </p>
        </header>

        {loadError && (
          <div className="bg-error/10 text-error rounded-xl p-md text-body-md">{loadError}</div>
        )}

        {message && (
          <div
            className={`rounded-xl p-md text-body-md ${
              message.tone === "success" ? "bg-primary/10 text-primary" : "bg-error/10 text-error"
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-md">
          {[
            { label: "Flagged orders", value: stats?.totalFlagged ?? 0, icon: "flag" },
            { label: "Awaiting review", value: stats?.pendingFlagged ?? 0, icon: "pending" },
            { label: "Outside radius", value: stats?.unverified ?? 0, icon: "location_off" },
            { label: "Hard rejected", value: stats?.rejected ?? 0, icon: "block" },
          ].map((card) => (
            <div key={card.label} className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md">
              <span className="material-symbols-outlined text-[26px] text-primary">{card.icon}</span>
              <div className="flex flex-col">
                <span className="text-body-sm text-on-surface-variant">{card.label}</span>
                <span className="text-headline-md font-bold text-on-surface font-mono">{card.value}</span>
              </div>
            </div>
          ))}
        </section>

        <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
          <h2 className="text-title-lg text-on-surface font-semibold mb-md">Radius configuration</h2>

          <label className="flex items-center gap-sm cursor-pointer mb-md">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-5 h-5 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              Enforce the geofence on guest QR orders
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-md">
            <div className="flex flex-col gap-xs">
              <label className="text-label-md text-on-surface-variant" htmlFor="gf-lat">
                Cafe latitude
              </label>
              <input
                id="gf-lat"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="19.076000"
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-md text-on-surface-variant" htmlFor="gf-lng">
                Cafe longitude
              </label>
              <input
                id="gf-lng"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="72.877700"
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
            <div className="flex flex-col gap-xs">
              <label className="text-label-md text-on-surface-variant" htmlFor="gf-radius">
                Radius (metres)
              </label>
              <input
                id="gf-radius"
                type="number"
                min={5}
                max={5000}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
              />
            </div>
          </div>

          <div className="flex flex-col gap-xs mt-md max-w-[28rem]">
            <label className="text-label-md text-on-surface-variant" htmlFor="gf-fallback">
              When the customer&apos;s device gives no usable fix
            </label>
            <select
              id="gf-fallback"
              value={fallback}
              onChange={(e) => setFallback(e.target.value as "flag" | "reject")}
              className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
            >
              <option value="flag">Accept but flag for review (recommended)</option>
              <option value="reject">Reject the order</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-sm mt-lg">
            <button
              onClick={useCurrentLocation}
              className="border border-surface-container rounded-full px-md py-sm text-body-md font-semibold text-on-surface hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[18px] mr-xs align-middle">my_location</span>
              Use this device&apos;s location
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-primary text-on-primary rounded-full px-lg py-sm text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {config?.enabled && config.lat !== null && (
              <span className="text-body-sm text-on-surface-variant">
                Active: {config.radiusMeters}m around {config.lat}, {config.lng}
              </span>
            )}
          </div>
        </section>

        <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
          <div className="flex items-center justify-between mb-md">
            <h2 className="text-title-lg text-on-surface font-semibold">Flagged orders</h2>
            <button
              onClick={refreshFlags}
              className="text-body-sm text-primary font-semibold hover:underline"
            >
              Refresh
            </button>
          </div>

          {flags.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">
              Nothing flagged. Orders that fail a check land here for a manager to confirm.
            </p>
          ) : (
            <ul className="flex flex-col gap-md">
              {flags.map((flag) => (
                <li key={flag.id} className="border border-surface-container rounded-xl p-md flex flex-col gap-sm">
                  <div className="flex flex-wrap items-center gap-sm">
                    <span className="font-mono text-body-md font-semibold">{flag.orderNumber}</span>
                    <span className="text-body-sm text-on-surface-variant uppercase">{flag.channel}</span>
                    {flag.tableNumber && (
                      <span className="text-body-sm text-on-surface-variant">Table {flag.tableNumber}</span>
                    )}
                    <RiskBadge score={flag.geolocation.riskScore} />
                    {flag.geolocation.distanceMeters !== null && (
                      <span className="text-body-sm text-on-surface-variant font-mono">
                        {Math.round(flag.geolocation.distanceMeters)}m from the cafe
                      </span>
                    )}
                    {flag.geolocation.reviewOutcome && flag.geolocation.reviewOutcome !== "pending" && (
                      <span className="px-sm py-xs rounded-full text-label-sm bg-primary/10 text-primary">
                        {flag.geolocation.reviewOutcome === "confirmed_legit" ? "confirmed" : "fraud"}
                      </span>
                    )}
                  </div>

                  <ul className="flex flex-wrap gap-xs">
                    {flag.geolocation.reasons.map((reason) => (
                      <li
                        key={reason}
                        className="text-label-sm bg-surface-container text-on-surface-variant rounded-full px-sm py-xs"
                      >
                        {reasonLabel(reason)}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-sm">
                    <button
                      disabled={resolvingId === flag.id}
                      onClick={() => resolve(flag, "confirmed_legit")}
                      className="border border-primary text-primary rounded-full px-md py-sm text-body-sm font-semibold hover:bg-primary/10 disabled:opacity-50"
                    >
                      Genuine customer
                    </button>
                    <button
                      disabled={resolvingId === flag.id}
                      onClick={() => resolve(flag, "confirmed_fraud")}
                      className="border border-error text-error rounded-full px-md py-sm text-body-sm font-semibold hover:bg-error/10 disabled:opacity-50"
                    >
                      Confirm abuse
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};