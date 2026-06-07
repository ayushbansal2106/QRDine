import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionState {
  // Layer 1: Customer identity (persists across visits / sessions)
  savedCustomerName: string;
  savedCustomerEmail: string;

  // Layer 2: Active dining session (cleared when session closes)
  activeSessionId: string | null;
  activeTableId: string | null;
  sessionStatus: string | null;

  // Actions
  saveCustomerIdentity: (name: string, email: string) => void;
  setActiveSession: (sessionId: string, tableId: string) => void;
  setSessionStatus: (status: string) => void;
  clearActiveSession: () => void;
  clearAll: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      // Layer 1
      savedCustomerName: "",
      savedCustomerEmail: "",

      // Layer 2
      activeSessionId: null,
      activeTableId: null,
      sessionStatus: null,

      saveCustomerIdentity: (name, email) =>
        set({
          savedCustomerName: name,
          savedCustomerEmail: email,
        }),

      setActiveSession: (sessionId, tableId) =>
        set({
          activeSessionId: sessionId,
          activeTableId: tableId,
          sessionStatus: "active",
        }),

      setSessionStatus: (status) =>
        set({
          sessionStatus: status,
        }),

      clearActiveSession: () =>
        set({
          activeSessionId: null,
          activeTableId: null,
          sessionStatus: null,
        }),

      clearAll: () =>
        set({
          savedCustomerName: "",
          savedCustomerEmail: "",
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
        activeSessionId: state.activeSessionId,
        activeTableId: state.activeTableId,
        sessionStatus: state.sessionStatus,
      }),
    }
  )
);
