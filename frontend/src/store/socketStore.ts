import { create } from "zustand";
import { getSocket } from "@/lib/socket";
import { Socket } from "socket.io-client";

interface SocketState {
  socket: Socket | null;
  isConnected: boolean;
  isReconnecting: boolean;
  lastDisconnectedAt: number | null;
  reconnectCount: number;
  joinedRooms: Set<string>;
  connect: () => void;
  disconnect: () => void;
  joinRoom: (room: string) => void;
  leaveRoom: (room: string) => void;
  emit: (event: string, data?: unknown) => void;
}

let listenersAdded = false;

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  isConnected: false,
  isReconnecting: false,
  lastDisconnectedAt: null,
  reconnectCount: 0,
  joinedRooms: new Set<string>(),
  connect: () => {
    const s = getSocket();

    if (!listenersAdded) {
      s.on("connect", () => {
        set({ isConnected: true, isReconnecting: false, reconnectCount: 0 });
        console.log("Connected to socket server");

        // Automatically rejoin all rooms from store state on connect/reconnect
        const rooms = get().joinedRooms;
        rooms.forEach((room) => {
          if (room.startsWith("cafe-")) {
            const cafeId = room.replace("cafe-", "");
            s.emit("join-cafe", cafeId);
            console.log(`Re-joined cafe room: ${room}`);
          } else if (room.startsWith("order-")) {
            const orderId = room.replace("order-", "");
            s.emit("join-order", orderId);
            console.log(`Re-joined order room: ${room}`);
          } else if (room.startsWith("session-")) {
            const sessionId = room.replace("session-", "");
            s.emit("join-session", sessionId);
            console.log(`Re-joined session room: ${room}`);
          }
        });
      });

      s.on("disconnect", (reason) => {
        console.log("Disconnected from socket server:", reason);
        set({
          isConnected: false,
          isReconnecting: reason !== "io client disconnect",
          lastDisconnectedAt: Date.now(),
        });
      });

      s.on("connect_error", (error) => {
        console.warn("Socket connect error:", error.message);
        set((state) => ({
          isConnected: false,
          isReconnecting: true,
          reconnectCount: state.reconnectCount + 1,
        }));
      });

      s.io?.on("reconnect_attempt", (attempt) => {
        console.log(`Socket reconnect attempt #${attempt}`);
        set({ isConnected: false, isReconnecting: true, reconnectCount: attempt });
      });

      s.io?.on("reconnect", () => {
        console.log("Socket successfully reconnected");
        set({ isConnected: true, isReconnecting: false, reconnectCount: 0 });
      });

      s.io?.on("reconnect_failed", () => {
        console.error("Socket reconnection failed after maximum attempts");
        set({ isConnected: false, isReconnecting: false });
      });

      listenersAdded = true;
    }

    if (!s.connected) {
      s.connect();
    }
    set({ socket: s, isConnected: s.connected });
  },
  disconnect: () => {
    const s = get().socket;
    if (s) {
      s.disconnect();
      set({ isConnected: false });
    }
  },
  joinRoom: (room) => {
    const s = get().socket;
    const rooms = new Set(get().joinedRooms);
    rooms.add(room);
    set({ joinedRooms: rooms });

    if (s && s.connected) {
      if (room.startsWith("cafe-")) {
        const cafeId = room.replace("cafe-", "");
        s.emit("join-cafe", cafeId);
        console.log(`Joined cafe room: ${room}`);
      } else if (room.startsWith("order-")) {
        const orderId = room.replace("order-", "");
        s.emit("join-order", orderId);
        console.log(`Joined order room: ${room}`);
      } else if (room.startsWith("session-")) {
        const sessionId = room.replace("session-", "");
        s.emit("join-session", sessionId);
        console.log(`Joined session room: ${room}`);
      }
    }
  },
  leaveRoom: (room) => {
    const rooms = new Set(get().joinedRooms);
    rooms.delete(room);
    set({ joinedRooms: rooms });
  },
  emit: (event, data) => {
    const s = get().socket;
    if (s) {
      s.emit(event, data);
    }
  },
}));
