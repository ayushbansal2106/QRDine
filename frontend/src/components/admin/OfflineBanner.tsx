"use client";

import React, { useState } from "react";
import { useSocketStore } from "@/store/socketStore";

interface OfflineBannerProps {
  onSync: () => void | Promise<void>;
  className?: string;
}

export const OfflineBanner: React.FC<OfflineBannerProps> = ({ onSync, className = "" }) => {
  const { isConnected, isReconnecting, reconnectCount } = useSocketStore();
  const [isSyncing, setIsSyncing] = useState(false);

  if (isConnected) {
    return null;
  }

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await onSync();
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  return (
    <div
      role="alert"
      className={`w-full bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex items-center justify-between text-amber-900 dark:text-amber-200 transition-all duration-200 animate-fadeIn ${className}`}
    >
      <div className="flex items-center gap-2.5 text-xs sm:text-sm font-medium">
        <span className="material-symbols-outlined text-[18px] text-amber-600 animate-pulse">
          wifi_off
        </span>
        <span>
          Offline Mode: Polling active every 15s. Real-time updates paused.
          {isReconnecting && reconnectCount > 0 && (
            <span className="ml-1.5 opacity-80 text-xs">
              (Reconnecting attempt #{reconnectCount}...)
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={handleManualSync}
        disabled={isSyncing}
        className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-semibold rounded-md shadow-sm transition-all disabled:opacity-50 cursor-pointer"
      >
        <span
          className={`material-symbols-outlined text-[14px] ${isSyncing ? "animate-spin" : ""}`}
        >
          sync
        </span>
        {isSyncing ? "Syncing..." : "Sync Now"}
      </button>
    </div>
  );
};
