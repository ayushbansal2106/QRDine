"use client";

import React, { useState, useEffect, useRef } from "react";
import { useSessionStore } from "@/store/sessionStore";

interface Toast {
  id: string;
  message: string;
  type: string;
}

export const ToastManager: React.FC = () => {
  const { activityFeed } = useSessionStore();
  const [toasts, setToasts] = useState<Toast[]>([]);
  /**
   * The watermark for "have I already toasted this?", in a ref rather than
   * state: it is bookkeeping, not something to render, and reading the clock
   * to seed it in a `useState` argument is an impure call in the render body.
   *
   * `null` means "nothing seen yet", so the first effect run adopts the current
   * head of the feed as its starting point without showing a toast for the
   * activities that were already on screen when the component mounted.
   */
  const lastProcessedTimestamp = useRef<number | null>(null);

  useEffect(() => {
    if (activityFeed.length === 0) return;

    const latestActivity = activityFeed[activityFeed.length - 1];
    const activityTimestamp = new Date(latestActivity.timestamp).getTime();

    if (lastProcessedTimestamp.current === null) {
      // First run: treat everything currently in the feed as already seen.
      lastProcessedTimestamp.current = activityTimestamp;
      return;
    }

    // Only show toast for new activities that happened after component mounted or last processed
    if (activityTimestamp > lastProcessedTimestamp.current) {
      const newToast: Toast = {
        id: Math.random().toString(36).substring(7),
        message: latestActivity.message,
        type: latestActivity.type,
      };

      setToasts((prev) => [...prev, newToast]);
      lastProcessedTimestamp.current = activityTimestamp;

      // Auto dismiss after 4 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== newToast.id));
      }, 4000);
    }
  }, [activityFeed]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 pointer-events-none w-full max-w-[24rem] px-4">
      {toasts.map((toast) => {
        let icon = "info";
        switch (toast.type) {
          case "participant_joined":
            icon = "person_add";
            break;
          case "participant_left":
            icon = "person_remove";
            break;
          case "order_created":
            icon = "shopping_cart";
            break;
          case "item_cancelled":
          case "bill_cancelled":
            icon = "cancel";
            break;
          case "bill_requested":
            icon = "receipt";
            break;
          case "bill_adjusted":
            icon = "price_change";
            break;
          case "ownership_transferred":
            icon = "admin_panel_settings";
            break;
          case "session_paid":
            icon = "check_circle";
            break;
        }

        return (
          <div
            key={toast.id}
            className="flex items-center gap-3 bg-surface-container-highest/95 backdrop-blur-md text-on-surface shadow-[0_4px_24px_rgba(0,0,0,0.12)] px-4 py-3 rounded-xl animate-[slideDown_0.3s_ease-out]"
          >
            <span className="material-symbols-outlined text-primary text-[20px] shrink-0">
              {icon}
            </span>
            <p className="font-inter text-body-sm font-medium leading-tight">
              {toast.message}
            </p>
          </div>
        );
      })}
    </div>
  );
};
