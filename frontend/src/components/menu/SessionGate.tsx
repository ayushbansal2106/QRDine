"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSessionStore } from "@/store/sessionStore";
import { useCartStore } from "@/store/cartStore";
import { useSocketStore } from "@/store/socketStore";
import {
  createSession,
  getActiveSession,
  joinSession,
  getActivityFeed,
  clearGuestTokenCookie,
} from "@/actions/sessions";
import { ToastManager } from "@/components/ui/ToastManager";
import { PhoneOtpField } from "@/components/customer/PhoneOtpField";
import {
  fetchMyProfile,
  isCustomerSignedIn,
  updateProfileName,
} from "@/actions/customerApp";

interface SessionGateProps {
  tableId: string;
  cafeId: string;
  children: React.ReactNode;
}

type GateView = "idle" | "loading" | "form" | "different-device" | "session-locked";

export interface EnsuredSession {
  sessionId: string;
  participantId?: string | null;
}

/**
 * Non-blocking dining-session gate.
 *
 * Scanning a QR code must land the guest straight on the menu — browsing and
 * filling a cart need no identity at all. The session itself is still required
 * to *place* an order (it carries the guest token), so it is created lazily by
 * `ensureSession()` at the moment it is actually needed: checkout, a waiter
 * request, or the bill. Nothing renders over the menu until then.
 */
const SessionGateContext = createContext<{
  ensureSession: () => Promise<EnsuredSession | null>;
  hasSession: boolean;
  isBusy: boolean;
}>({ ensureSession: async () => null, hasSession: false, isBusy: false });

export const useSessionGate = () => useContext(SessionGateContext);

export const SessionGate: React.FC<SessionGateProps> = ({ tableId, cafeId, children }) => {
  const {
    savedCustomerName,
    savedCustomerEmail,
    savedCustomerPhone,
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
  const { socket, connect, joinRoom, leaveRoom } = useSocketStore();

  // `idle` means the menu is fully browsable and no overlay is shown.
  const [view, setView] = useState<GateView>("idle");
  const [name, setName] = useState(savedCustomerName || "");
  const [phone, setPhone] = useState(savedCustomerPhone || "");
  const [verifiedIdentity, setVerifiedIdentity] = useState<{
    name: string;
    phone: string;
    email: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  /**
   * Whether the gate must prove identity with an OTP. False when the guest
   * already holds a valid customer token — then only a name is missing.
   */
  const [needsOtp, setNeedsOtp] = useState(true);
  const [showPhoneOtp, setShowPhoneOtp] = useState(false);

  // A pending ensureSession() call, resolved once the guest completes the flow.
  const pendingResolve = useRef<((s: EnsuredSession | null) => void) | null>(null);

  const settlePending = useCallback(
    (session: EnsuredSession | null) => {
      const resolve = pendingResolve.current;
      if (!resolve) return;
      pendingResolve.current = null;
      resolve(session);
    },
    []
  );

  /** Resolve the active session for this table, if the guest already has one. */
  const adoptExistingSession = useCallback(
    async (): Promise<EnsuredSession | null> => {
      // A remembered session id is a *claim*, not a fact. It was persisted when
      // the guest last visited, and that visit has since ended — the bill was
      // paid on another tab, or the app was closed before the `session-paid`
      // event arrived, so the stored id points at a session that no longer
      // accepts orders. Trusting it sent the returning guest to checkout with a
      // dead session and the server answered "a valid dining session is
      // required". So the server is always asked what is actually open.
      const remembered = activeSessionId && activeTableId === tableId ? activeSessionId : null;

      const result = await getActiveSession(tableId, deviceId);

      if (!result.success) {
        // The table has no open session. Drop the remembered one so the rest of
        // the app stops believing in it, and fall through to opening a new one.
        if (remembered) {
          clearActiveSession();
          setSessionId(null);
          setSessionStatus("idle");
        } else {
          // A remembered session belongs to a different table, or a stale
          // sessionStatus was persisted from a session that ended without the
          // store being notified (e.g. the bill was settled on another device).
          // Clear it so SeatingCard does not show "Bill raised" for a table
          // with no open session.
          setSessionStatus(null);
        }
        return null;
      }

      if (result.sessionLocked) {
        setView("session-locked");
        return null;
      }
      if (!result.activeSession || !result.session || !result.sameDevice) {
        if (remembered) {
          clearActiveSession();
          setSessionId(null);
          setSessionStatus("idle");
        }
        return null;
      }

      const s = result.session;
      const me = (s.participants || []).find(
        (p: { deviceId?: string; status?: string }) =>
          p.deviceId === deviceId && p.status === "active"
      );
      if (!me) return null;

      setActiveSession(s.id, tableId, me.participantId, me.role);
      saveCustomerIdentity(me.name, me.email || savedCustomerEmail);
      setSessionId(s.id);
      setSessionStatus(s.status);
      return { sessionId: s.id, participantId: me.participantId };
    },
    [
      activeSessionId,
      activeTableId,
      tableId,
      deviceId,
      savedCustomerEmail,
      setActiveSession,
      clearActiveSession,
      saveCustomerIdentity,
      setSessionId,
      setSessionStatus,
    ]
  );

  /**
   * Open a dining session for a customer we have already identified.
   * Shared by the silent fast path and the name-only prompt.
   */
  const createDiningSession = useCallback(
    async (customerName: string, customerEmail: string): Promise<EnsuredSession | null> => {
      const result = await createSession(
        tableId,
        customerName,
        customerEmail,
        deviceId,
        true
      );
      if (!result.success || !result.session) return null;

      // `createSession` returns a flat session summary — `participantId` and
      // `role` sit at the top level. Reading a `participants` array here found
      // nothing, so the guest was left with no participant id and the store
      // stored `undefined`. That identity is what the backend checks when the
      // guest asks for the bill, so the host was refused their own request.
      const me = {
        participantId: result.session.participantId ?? null,
        role: result.session.role ?? null,
      };
      saveCustomerIdentity(customerName, customerEmail, verifiedIdentity?.phone || savedCustomerPhone);
      setActiveSession(result.session.id, tableId, me.participantId, me.role);
      setSessionId(result.session.id);
      setSessionStatus("active");
      return { sessionId: result.session.id, participantId: me.participantId };
    },
    [tableId, deviceId, saveCustomerIdentity, setActiveSession, setSessionId, setSessionStatus, verifiedIdentity, savedCustomerPhone]
  );

  /**
   * Guarantee a dining session, showing sign-in only if one is genuinely needed.
   * Resolves to null when the guest declines or the table is locked.
   */
  const ensureSession = useCallback(async (): Promise<EnsuredSession | null> => {
    // Always verified, never assumed — see `adoptExistingSession`. The fast path
    // used to return the remembered id without asking the server, which is
    // exactly how a returning guest ended up holding last visit’s closed
    // session.
    const existing = await adoptExistingSession();
    if (existing) return existing;

    // Already signed in? Then there is nothing to prove again. Open the table
    // silently, or at worst ask for the one thing we genuinely lack: a name to
    // print on the bill. Re-asking an authenticated guest for an OTP on every
    // checkout was the bug this replaces.
    const signedIn = await isCustomerSignedIn();
    if (signedIn) {
      const { customer } = await fetchMyProfile();

      // A profile created by OTP has an empty name — sign-in proves *who* you
      // are, it never asked what to call you. That is the single reason this
      // prompt used to reappear on every checkout: the fast path below requires
      // a name, and there was never one to find. The locally remembered name is
      // an acceptable fallback so a returning guest is not asked again either.
      const knownName = (customer?.name || savedCustomerName || "").trim();
      if (knownName) {
        const session = await createDiningSession(knownName, customer?.email || "");
        if (session) return session;
      }

      // Signed in but still nameless: ask once for the name to print on the
      // bill. `startSession` writes it back to the profile, so this screen is
      // shown exactly once in the life of the account rather than every visit.
      setName(knownName);
      setNeedsOtp(false);
      setView("form");
      return new Promise<EnsuredSession | null>((resolve) => {
        pendingResolve.current = resolve;
      });
    }

    return new Promise<EnsuredSession | null>((resolve) => {
      pendingResolve.current = resolve;
      setView("loading");

      getActiveSession(tableId, deviceId)
        .then((result) => {
          if (result.success && result.sessionLocked) {
            setView("session-locked");
            settlePending(null);
            return;
          }
          // Another device already owns this table's session: offer to join it.
          if (result.success && result.activeSession && !result.sameDevice) {
            setView("different-device");
            return;
          }
          setNeedsOtp(true);
          if (savedCustomerPhone && savedCustomerName) {
            setName(savedCustomerName);
            setPhone(savedCustomerPhone);
            setVerifiedIdentity({
              name: savedCustomerName,
              phone: savedCustomerPhone,
              email: savedCustomerEmail,
            });
          }
          setView("form");
        })
        .catch(() => setView("form"));
    });
  }, [tableId, deviceId, adoptExistingSession, createDiningSession, savedCustomerName, savedCustomerPhone, savedCustomerEmail, settlePending]);

  // Exposed directly: `ensureSession` already raises the overlay when a session
  // is genuinely missing, and stays silent when one already exists.
  const openSignIn = useCallback(() => ensureSession(), [ensureSession]);

  // ── Session lifecycle (realtime + settlement) ─────────

  // Never leave a caller awaiting forever: if the guest navigates away while the
  // overlay is up, resolve the pending ensureSession() so checkout can recover.
  useEffect(() => {
    return () => {
      const resolve = pendingResolve.current;
      if (!resolve) return;
      pendingResolve.current = null;
      resolve(null);
    };
  }, []);

  // Sync persisted session status with the backend on mount. The store is
  // cross-session, so a "bill_requested" left over from a previous visit (whose
  // session-paid event never arrived on this device) would otherwise make
  // SeatingCard show "Bill raised" on every table — even with no orders placed.
  useEffect(() => {
    void (async () => {
      try {
        const result = await getActiveSession(tableId, deviceId);
        if (!result.success) {
          setSessionStatus(null);
        }
      } catch {
        // getActiveSession only throws for a server-side failure — the guest can
        // still browse the menu; adoptExistingSession will re-validate on checkout.
      }
    })();
  }, [tableId, deviceId, setSessionStatus]);

  useEffect(() => {
    if (activeSessionId) {
      connect();
      const room = `session-${activeSessionId}`;
      joinRoom(room);
      return () => leaveRoom(room);
    }
  }, [activeSessionId, connect, joinRoom, leaveRoom]);

  useEffect(() => {
    if (!socket || !activeSessionId) return;

    const handleBillRequested = (data: { sessionId?: string }) => {
      if (data && data.sessionId === activeSessionId) {
        setSessionStatus("bill_requested");
      }
    };
    const handleBillCancelled = (data: { sessionId?: string }) => {
      if (data && data.sessionId === activeSessionId) setSessionStatus("active");
    };
    const handleSessionActivity = (data: unknown) => {
      if (data) addActivity(data as { type: string; message: string; timestamp: string });
    };
    const handleSessionEnded = () => {
      clearGuestTokenCookie();
      clearActiveSession();
      useCartStore.getState().clearCart();
      leaveRoom(`session-${activeSessionId}`);
      setView("idle");
    };
    const handleConnect = async () => {
      const result = await getActivityFeed(activeSessionId);
      if (result.success) setActivityFeed(result.activityFeed);
    };

    socket.on("connect", handleConnect);
    socket.on("session-bill-requested", handleBillRequested);
    socket.on("bill-cancelled", handleBillCancelled);
    socket.on("session-activity", handleSessionActivity);
    socket.on("session-paid", handleSessionEnded);
    socket.on("session-closed", handleSessionEnded);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("session-bill-requested", handleBillRequested);
      socket.off("bill-cancelled", handleBillCancelled);
      socket.off("session-activity", handleSessionActivity);
      socket.off("session-paid", handleSessionEnded);
      socket.off("session-closed", handleSessionEnded);
    };
  }, [
    socket,
    activeSessionId,
    setSessionStatus,
    addActivity,
    setActivityFeed,
    clearActiveSession,
    leaveRoom,
  ]);

  useEffect(() => {
    if (!activeSessionId) return;
    getActivityFeed(activeSessionId).then((result) => {
      if (result.success) setActivityFeed(result.activityFeed);
    });
  }, [activeSessionId, setActivityFeed]);

  const startSession = async () => {
    if (!name.trim()) return;
    // Phone OTP is optional under DPDP Act data minimization: diners can order as guest with name only.

    setIsSubmitting(true);
    setError("");

    try {
      const session = await createDiningSession(name.trim(), verifiedIdentity?.email || "");
      if (session) {
        // Remember the name against the *profile*, not just the browser. The
        // fast path in `ensureSession` reads the name from the profile, so
        // without this the guest is asked for their name at every checkout —
        // the exact defect this replaced.
        if (!needsOtp && name.trim()) {
          await updateProfileName(name.trim());
        }
        setView("idle");
        settlePending(session);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start session. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const joinTableSession = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError("");

    try {
      const result = await joinSession(tableId, name.trim(), deviceId);
      if (result.success && result.session) {
        saveCustomerIdentity(name.trim(), "");
        setActiveSession(
          result.session.id,
          tableId,
          result.session.participantId,
          result.session.role
        );
        setSessionId(result.session.id);
        setSessionStatus("active");
        setView("idle");
        settlePending({
          sessionId: result.session.id,
          participantId: result.session.participantId,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join this table.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancel = () => {
    setView("idle");
    setError("");
    settlePending(null);
  };

  const contextValue = {
    ensureSession: openSignIn,
    hasSession: Boolean(activeSessionId && activeTableId === tableId),
    isBusy: isSubmitting,
  };

  return (
    <SessionGateContext.Provider value={contextValue}>
      <ToastManager />
      {children}

      {/* Nothing below renders until something actually needs a session. */}
      {view === "loading" && (
        <Overlay>
          <p className="font-inter text-body-md text-on-surface-variant">Checking your table…</p>
        </Overlay>
      )}

      {view === "session-locked" && (
        <Overlay>
          <span className="material-symbols-outlined text-warning text-[48px] mb-sm block">
            lock
          </span>
          <h2 className="font-inter font-bold text-headline-md text-on-surface mb-sm">
            Table Locked
          </h2>
          <p className="font-inter text-body-md text-on-surface-variant mb-md">
            This table is currently settling a bill. Please contact staff if you need
            assistance.
          </p>
          <button
            type="button"
            onClick={cancel}
            className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold"
          >
            Back to menu
          </button>
        </Overlay>
      )}

      {view === "different-device" && (
        <Overlay>
          <span className="material-symbols-outlined text-warning text-[48px] mb-sm block">
            group_add
          </span>
          <h2 className="font-inter font-bold text-headline-md text-on-surface mb-sm">
            Join Table
          </h2>
          <p className="font-inter text-body-md text-on-surface-variant mb-md">
            This table already has an active dining session. Enter your name to join it.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your Name"
            className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary mb-sm"
          />
          {error && (
            <p className="bg-error/10 text-error text-body-sm rounded-lg p-sm mb-sm">{error}</p>
          )}
          <div className="flex gap-sm">
            <button
              type="button"
              onClick={cancel}
              className="flex-1 h-12 rounded-xl bg-surface-container text-on-surface font-inter font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={joinTableSession}
              disabled={isSubmitting || !name.trim()}
              className="flex-1 h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold disabled:opacity-60"
            >
              {isSubmitting ? "Joining…" : "Join Table"}
            </button>
          </div>
        </Overlay>
      )}

      {view === "form" && (
        <Overlay>
          <span className="material-symbols-outlined text-primary text-[48px] mb-sm block">
            {needsOtp ? "restaurant" : "badge"}
          </span>
          <h1 className="font-inter font-bold text-headline-md text-on-surface mb-xs">
            {needsOtp ? "Who should we serve?" : "What should we call you?"}
          </h1>
          <p className="font-inter text-body-md text-on-surface-variant mb-md">
            {needsOtp
              ? "Enter your name to open the table. Phone number is optional for rewards."
              : "You're signed in. We only need a name to print on your bill."}
          </p>

          <div className="flex flex-col gap-md text-left">
            <div>
              <label
                htmlFor="session-name"
                className="font-inter font-semibold text-label-md text-on-surface mb-xs block"
              >
                Your name
              </label>
              <input
                id="session-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full h-12 bg-surface-container-low rounded-xl px-md font-inter text-body-md text-on-surface placeholder-on-surface-variant/50 outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Optional loyalty and SMS bill connection under DPDP Act */}
            {needsOtp && (
              <PhoneOtpField
                cafeId={cafeId}
                phone={phone}
                onPhoneChange={setPhone}
                onVerified={(ident) => {
                  setVerifiedIdentity(ident);
                  if (!name.trim() && ident.name) setName(ident.name);
                }}
                disabled={isSubmitting}
              />
            )}

            {error && (
              <p className="bg-error/10 text-error text-body-sm rounded-lg p-sm">{error}</p>
            )}

            <button
              type="button"
              onClick={startSession}
              disabled={isSubmitting || !name.trim() || (needsOtp && !verifiedIdentity)}
              className="w-full h-12 bg-primary text-on-primary rounded-xl font-inter font-semibold text-body-lg disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting
                ? "Setting up…"
                : verifiedIdentity
                ? "Continue with Account"
                : "Continue as Table Guest"}
            </button>

            <button
              type="button"
              onClick={cancel}
              className="w-full h-10 text-primary font-inter font-semibold text-body-md"
            >
              Keep browsing
            </button>
          </div>
        </Overlay>
      )}
    </SessionGateContext.Provider>
  );
};

/** Full-screen scrim used by every gate step. */
const Overlay: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-background px-margin-mobile overflow-y-auto">
    <div className="w-full max-w-[400px] bg-surface-container-lowest rounded-2xl shadow-[0px_8px_40px_rgba(0,0,0,0.08)] p-lg text-center my-auto">
      {children}
    </div>
  </div>
);