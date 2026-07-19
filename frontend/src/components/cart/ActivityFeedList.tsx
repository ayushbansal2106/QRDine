"use client";

import React from "react";
import { useSessionStore } from "@/store/sessionStore";

export const ActivityFeedList: React.FC = () => {
  const { activityFeed } = useSessionStore();

  if (!activityFeed || activityFeed.length === 0) {
    return null;
  }

  // Show the last 10 activities, reversed so newest is first
  const recentActivities = [...activityFeed].reverse().slice(0, 10);

  return (
    <div className="bg-surface-container-lowest rounded-xl p-md shadow-[0px_4px_20px_rgba(0,0,0,0.04)] flex flex-col gap-sm mb-md">
      <h3 className="font-inter font-semibold text-title-md text-on-surface mb-xs">
        Recent Table Activity
      </h3>
      <div className="flex flex-col gap-3">
        {recentActivities.map((activity, index) => {
          const date = new Date(activity.timestamp);
          const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          let icon = "info";
          switch (activity.type) {
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
            <div key={index} className="flex gap-3 items-start border-b border-surface-container-low last:border-0 pb-3 last:pb-0">
              <span className="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">
                {icon}
              </span>
              <div className="flex flex-col">
                <span className="font-inter text-label-sm text-on-surface-variant mb-0.5">
                  {timeString}
                </span>
                <span className="font-inter text-body-md text-on-surface">
                  {activity.message}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
