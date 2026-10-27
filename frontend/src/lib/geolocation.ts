"use client";

/**
 * Module #10 — customer-side location capture.
 *
 * Coordinates are advisory: the server re-derives distance, accuracy sanity and
 * travel speed from them. If the guest denies permission or the browser has no
 * GPS, we return `null` and the order is simply flagged for staff review rather
 * than being blocked — a refused permission prompt must never stop a table from
 * ordering coffee.
 */

export interface CustomerLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

export type LocationOutcome =
  | { status: "granted"; location: CustomerLocation }
  | { status: "denied" | "unavailable" | "timeout"; location: null; reason: string };

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 60000,
};

export const requestCustomerLocation = (): Promise<LocationOutcome> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ status: "unavailable", location: null, reason: "This device has no location services." });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          status: "granted",
          location: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
      },
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was declined."
            : error.code === error.TIMEOUT
              ? "Location lookup timed out."
              : "Your position could not be determined.";
        resolve({ status: error.code === error.PERMISSION_DENIED ? "denied" : "timeout", location: null, reason });
      },
      OPTIONS
    );
  });