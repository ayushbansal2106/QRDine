import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionState {
  // Layer 1: Customer identity (persists across visits / sessions)
  savedCustomerName: string;
  savedCustomerEmail: string;
  /** Module #09 — the phone the OTP sign-in verified; identity for the profile. */
  savedCustomerPhone: string;
  deviceId: string;

  // Layer 2: Active dining session (cleared when session closes)
  activeSessionId: string | null;
  activeTableId: string | null;
  sessionStatus: string | null;
  participantId: string | null;
  role: 'owner' | 'member' | null;
  activityFeed: Array<{ type: string; message: string; timestamp: Date | string }>;

  // Actions
  saveCustomerIdentity: (name: string, email: string, phone?: string) => void;
  setActiveSession: (sessionId: string, tableId: string, participantId?: string | null, role?: 'owner' | 'member' | null) => void;
  setSessionStatus: (status: string | null) => void;
  setActivityFeed: (feed: Array<{ type: string; message: string; timestamp: Date | string }>) => void;
  addActivity: (activity: { type: string; message: string; timestamp: Date | string }) => void;
  clearActiveSession: () => void;
  clearAll: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      // Layer 1
      savedCustomerName: "",
      savedCustomerEmail: "",
      savedCustomerPhone: "",
      deviceId: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),

      // Layer 2
      activeSessionId: null,
      activeTableId: null,
      sessionStatus: null,
      participantId: null,
      role: null,
      activityFeed: [],

      saveCustomerIdentity: (name, email, phone) =>
        set((state) => ({
          savedCustomerName: name,
          savedCustomerEmail: email,
          // Keep the verified number rather than blanking it when a caller
          // that does not know it re-saves the rest of the identity.
          savedCustomerPhone: phone ?? state.savedCustomerPhone,
        })),

      setActiveSession: (sessionId, tableId, participantId = null, role = null) =>
        set({
          activeSessionId: sessionId,
          activeTableId: tableId,
          sessionStatus: "active",
          participantId,
          role,
        }),

      setSessionStatus: (status) =>
        set({
          sessionStatus: status,
        }),

      setActivityFeed: (feed) =>
        set({
          activityFeed: feed.slice(-50),
        }),

      addActivity: (activity) =>
        set((state) => {
          const updated = [...state.activityFeed, activity];
          return { activityFeed: updated.slice(-50) };
        }),

      clearActiveSession: () =>
        set({
          activeSessionId: null,
          activeTableId: null,
          sessionStatus: null,
          participantId: null,
          role: null,
          activityFeed: [],
        }),

      clearAll: () =>
        set({
          savedCustomerName: "",
          savedCustomerEmail: "",
          savedCustomerPhone: "",
          activeSessionId: null,
          activeTableId: null,
          sessionStatus: null,
        }),
    }),
    {
      name: "qrdine-session-storage",
      partialize: (state) => ({
        savedCustomerName: state.savedCustomerName,
        savedCustomerEmail: state.savedCustomerEmail,
        savedCustomerPhone: state.savedCustomerPhone,
        deviceId: state.deviceId,
        activeSessionId: state.activeSessionId,
        activeTableId: state.activeTableId,
        sessionStatus: state.sessionStatus,
        participantId: state.participantId,
        role: state.role,
        activityFeed: state.activityFeed,
      }),
    }
  )
);
