"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSessionStore } from "@/store/sessionStore";
import { useCartStore } from "@/store/cartStore";
import { useSocketStore } from "@/store/socketStore";
import { createSession, getActiveSession, joinSession, getActivityFeed, clearGuestTokenCookie } from "@/actions/sessions";
import { ToastManager } from "@/components/ui/ToastManager";

interface SessionGateProps {
  tableId: string;
  cafeId: string;
  children: React.ReactNode;
}

type GateView = "loading" | "welcome-back" | "form" | "session-active" | "different-device" | "session-locked";

export const SessionGate: React.FC<SessionGateProps> = ({
  tableId,
  cafeId,
  children,
}) => {
  const {
    savedCustomerName,
    savedCustomerEmail,
    deviceId,
    activeSessionId,
    activeTableId,
    saveCustomerIdentity,
    setActiveSession,
    clearActiveSession,
    setSessionStatus,
    setActivityFeed,
    addActivity,
  } = useSessionStore();

  const { setSessionId } = useCartStore();

  const [view, setView] = useState<GateView>("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [startedAtTime, setStartedAtTime] = useState<string>("");

  const checkAndSetSession = useCallback(async () => {
    try {
      // Check backend for an active session on this table
      const result = await getActiveSession(tableId, deviceId);

      if (result.success) {
        if (result.sessionLocked) {
          setView("session-locked");
          return;
        }

        if (result.activeSession && result.session) {
          const s = result.session;
          if (!result.sameDevice) {
            setView("different-device");
            return;
          }

          // Active session exists on this table
          const me = s.participants?.find((p: any) => p.deviceId === deviceId && p.status === 'active');
          if (me) {
            setActiveSession(s.id, tableId, me.participantId, me.role);
            saveCustomerIdentity(me.name, me.email || savedCustomerEmail);
            setSessionId(s.id);
            setSessionStatus(s.status);
            setView("session-active");
            return;
          }

          // Not a participant yet, but session exists
          setView("different-device");
          return;
        }
      }

      // No active session on this table
      // Clear any stale session for this device
      if (activeSessionId) {
        clearActiveSession();
      }

      // Check if we have saved customer identity (returning customer)
      if (savedCustomerName && savedCustomerEmail) {
        setName(savedCustomerName);
        setEmail(savedCustomerEmail);
        setView("welcome-back");
      } else {
        setView("form");
      }
    } catch (err) {
      console.error("Session check failed:", err);
      // Fallback to form
      if (savedCustomerName && savedCustomerEmail) {
        setName(savedCustomerName);
        setEmail(savedCustomerEmail);
        setView("welcome-back");
      } else {
        setView("form");
      }
    }
  }, [
    tableId,
    activeSessionId,
    activeTableId,
    savedCustomerName,
    savedCustomerEmail,
    setActiveSession,
    saveCustomerIdentity,
    setSessionId,
    clearActiveSession,
    setSessionStatus,
  ]);

  const { socket, connect, joinRoom, leaveRoom } = useSocketStore();

  useEffect(() => {
    checkAndSetSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId]);

  useEffect(() => {
    if (activeSessionId) {
      connect();
      const room = `session-${activeSessionId}`;
      joinRoom(room);

      return () => {
        leaveRoom(room);
      };
    }
  }, [activeSessionId, connect, joinRoom, leaveRoom]);

  useEffect(() => {
    if (!socket || !activeSessionId) return;

    const handleBillRequested = (data: any) => {
      if (data && data.sessionId === activeSessionId) {
        setSessionStatus('bill_requested');
        checkAndSetSession();
      }
    };

    const handleBillCancelled = (data: any) => {
      if (data && data.sessionId === activeSessionId) {
        setSessionStatus('active');
        checkAndSetSession();
      }
    };

    const handleSessionActivity = (data: any) => {
      if (data) {
        addActivity(data);
      }
    };

    const handleSessionEnded = () => {
      clearGuestTokenCookie();
      clearActiveSession();
      useCartStore.getState().clearCart();
      leaveRoom(`session-${activeSessionId}`);
      checkAndSetSession();
    };

    const handleConnect = async () => {
      console.log('Socket reconnected, refetching activity feed');
      const result = await getActivityFeed(activeSessionId);
      if (result.success) {
        setActivityFeed(result.activityFeed);
      }
      checkAndSetSession();
    };

    socket.on('connect', handleConnect);
    socket.on('session-bill-requested', handleBillRequested);
    socket.on('bill-cancelled', handleBillCancelled);
    socket.on('session-activity', handleSessionActivity);
    socket.on('session-paid', handleSessionEnded);
    socket.on('session-closed', handleSessionEnded);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('session-bill-requested', handleBillRequested);
      socket.off('bill-cancelled', handleBillCancelled);
      socket.off('session-activity', handleSessionActivity);
      socket.off('session-paid', handleSessionEnded);
      socket.off('session-closed', handleSessionEnded);
    };
  }, [socket, activeSessionId, setSessionStatus, checkAndSetSession, addActivity, clearActiveSession, leaveRoom]);

  // Fetch activity feed once when session becomes active
  useEffect(() => {
    if (activeSessionId) {
      const fetchFeed = async () => {
        const result = await getActivityFeed(activeSessionId);
        if (result.success) {
          setActivityFeed(result.activityFeed);
        }
      };
      fetchFeed();
    }
  }, [activeSessionId, setActivityFeed]);

  const handleCreateSession = async (
    customerName: string,
    customerEmail: string,
    forceNew: boolean = false
  ) => {
    setIsSubmitting(true);
    setError("");

    try {
      const result = await createSession(tableId, customerName, customerEmail, deviceId, forceNew);

      if (result.success && result.session) {
        saveCustomerIdentity(customerName, customerEmail);
        const me = result.session.participants?.find((p: any) => p.deviceId === deviceId);
        setActiveSession(result.session.id, tableId, me?.participantId, me?.role);
        setSessionId(result.session.id);
        setSessionStatus("active");
        setView("session-active");
      }
    } catch (err: any) {
      setError(err.message || "Failed to start session. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleJoinSession = async (customerName: string) => {
    setIsSubmitting(true);
    setError("");

    try {
      const result = await joinSession(tableId, customerName, deviceId);

      if (result.success && result.session) {
        saveCustomerIdentity(customerName, ""); // email not required to join
        setActiveSession(result.session.id, tableId, result.session.participantId, result.session.role);
        setSessionId(result.session.id);
        setSessionStatus("active");
        setView("session-active");
      }
    } catch (err: any) {
      setError(err.message || "Failed to join session. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────
  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-md">
          <div className="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="font-inter text-body-md text-on-surface-variant">
            Setting up your table...
          </span>
        </div>
      </div>
    );
  }

  // ── Session Active → Render Menu ─────
  if (view === "session-active") {
    return (
      <>
        <ToastManager />
        {children}
      </>
    );
  }

  // ── Welcome Back ─────────────────────
  if (view === "welcome-back") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile">
        <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.08)] p-lg">
          {/* Header */}
          <div className="text-center mb-lg">
            <span className="material-symbols-outlined text-primary text-[48px] mb-sm block">
              restaurant
            </span>
            <h2 className="font-inter font-bold text-headline-md text-on-surface">
              Welcome back!
            </h2>
          </div>

          {/* Customer Info */}
          <div className="bg-surface-container-low rounded-xl p-md mb-md">
            <div className="flex items-center gap-sm mb-xs">
              <span className="material-symbols-outlined text-primary text-[20px]">
                person
              </span>
              <span className="font-inter font-semibold text-body-lg text-on-surface">
                {savedCustomerName}
              </span>
            </div>
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-on-surface-variant text-[20px]">
                email
              </span>
              <span className="font-inter text-body-md text-on-surface-variant">
                {savedCustomerEmail}
              </span>
            </div>
          </div>

          {error && (
            <div className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm mb-md">
              {error}
            </div>
          )}

          {/* Actions */}
          <button
            onClick={() =>
              handleCreateSession(savedCustomerName, savedCustomerEmail)
            }
            disabled={isSubmitting}
            className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mb-sm"
          >
            {isSubmitting ? "Starting..." : "Continue Dining"}
          </button>

          <button
            onClick={() => {
              setName("");
              setEmail("");
              setView("form");
            }}
            className="w-full h-10 text-primary font-inter font-semibold text-body-md cursor-pointer hover:bg-surface-container-low rounded-lg transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  // ── Different Device ─────────────────
  if (view === "different-device") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile">
        <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.08)] p-lg">
          <div className="text-center mb-lg">
            <span className="material-symbols-outlined text-warning text-[48px] mb-sm block">
              group_add
            </span>
            <h2 className="font-inter font-bold text-headline-md text-on-surface">
              Join Table
            </h2>
          </div>

          <div className="bg-surface-container-low rounded-xl p-md mb-md text-center">
            <p className="font-inter text-body-md text-on-surface">
              This table already has an active dining session.
            </p>
            <p className="font-inter text-body-md text-on-surface-variant mt-2">
              Enter your name to join the table.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                handleJoinSession(name.trim());
              }
            }}
            className="flex flex-col gap-md"
          >
            <div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                required
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
              />
            </div>

            {error && (
              <div className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mb-sm"
            >
              {isSubmitting ? "Joining..." : "Join Table"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Session Locked ───────────────────
  if (view === "session-locked") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile">
        <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.08)] p-lg text-center">
          <span className="material-symbols-outlined text-warning text-[48px] mb-sm block">
            lock
          </span>
          <h2 className="font-inter font-bold text-headline-md text-on-surface mb-sm">
            Table Locked
          </h2>
          <p className="font-inter text-body-md text-on-surface-variant">
            This table is currently settling a bill. Please contact staff if you need assistance.
          </p>
        </div>
      </div>
    );
  }

  // ── New Customer Form ────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-margin-mobile">
      <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.08)] p-lg">
        {/* Header */}
        <div className="text-center mb-lg">
          <span className="material-symbols-outlined text-primary text-[48px] mb-sm block">
            restaurant
          </span>
          <h1 className="font-inter font-bold text-headline-md text-on-surface mb-xs">
            Start Dining
          </h1>
          <p className="font-inter text-body-md text-on-surface-variant">
            Enter your details to begin ordering
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && email.trim()) {
              handleCreateSession(name.trim(), email.trim(), true);
            }
          }}
          className="flex flex-col gap-md"
        >
          <div>
            <label
              htmlFor="customer-name"
              className="font-inter font-semibold text-label-md text-on-surface mb-xs block"
            >
              Your Name
            </label>
            <input
              id="customer-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              required
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          <div>
            <label
              htmlFor="customer-email"
              className="font-inter font-semibold text-label-md text-on-surface mb-xs block"
            >
              Email Address
            </label>
            <input
              id="customer-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. rahul@gmail.com"
              required
              className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 border-none focus:ring-2 focus:ring-primary outline-none transition-all"
            />
          </div>

          {error && (
            <div className="bg-error/10 text-error text-body-sm font-inter rounded-lg p-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !name.trim() || !email.trim()}
            className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg cursor-pointer transition-all hover:bg-primary-container active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed mt-sm"
          >
            {isSubmitting ? "Setting up..." : "Start Dining"}
          </button>
        </form>
      </div>
    </div>
  );
};
