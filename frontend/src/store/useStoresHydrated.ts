"use client";

import { useEffect, useState } from "react";
import { useCartStore } from "./cartStore";
import { useSessionStore } from "./sessionStore";

/**
 * True once both persisted stores have rehydrated from `localStorage`.
 *
 * The cart and session are Zustand stores wrapped in `persist`, so on the server
 * they are always empty and statusless — while the client rehydrates them from
 * browser storage. Any markup derived from them (a cart badge, a "live" pill)
 * therefore differs between the two renders and React discards the server HTML
 * with a hydration error.
 *
 * TWO ZUSTAND TRAPS THIS EXISTS TO AVOID
 * ---------------------------------------
 * 1. `store.persist` DOES NOT EXIST DURING SERVER RENDERING.
 *    `persist` attaches `api.persist` only when a storage backend resolves. On
 *    the server there is no `window.localStorage`, so `createJSONStorage` yields
 *    nothing and `persistImpl` returns early — *before* the `api.persist`
 *    assignment. Reading `store.persist.hasHydrated()` there throws
 *    "Cannot read properties of undefined", which takes the whole page down
 *    rather than degrading.
 *
 * 2. The initial state must NOT read the stores at all.
 *    `localStorage` is synchronous, so on the client the stores are already
 *    rehydrated by the time the first render runs. Seeding the state from them
 *    would make the first client render *differ* from the server render — the
 *    very mismatch this hook exists to prevent. Starting at `false` and
 *    flipping inside an effect guarantees both renders agree, at the cost of
 *    one extra paint before real values appear.
 */

interface PersistApi {
  hasHydrated: () => boolean;
  onFinishHydration: (callback: () => void) => () => void;
}

const persistApi = (store: unknown): PersistApi | undefined =>
  (store as { persist?: PersistApi }).persist;

/** Both stores rehydrated? False whenever the persist API is absent (SSR). */
const allHydrated = (): boolean => {
  const cart = persistApi(useCartStore);
  const session = persistApi(useSessionStore);
  if (!cart || !session) return false;
  return cart.hasHydrated() && session.hasHydrated();
};

export const useStoresHydrated = (): boolean => {
  // Always false on the first pass, on the server and on the client alike.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const markHydrated = () => setHydrated(true);

    // Storage is synchronous, so by the time this effect runs the stores have
    // usually finished already and the listener would never fire.
    if (allHydrated()) {
      markHydrated();
      return;
    }

    const unsubscribeCart = persistApi(useCartStore)?.onFinishHydration(markHydrated);
    const unsubscribeSession = persistApi(useSessionStore)?.onFinishHydration(markHydrated);

    return () => {
      unsubscribeCart?.();
      unsubscribeSession?.();
    };
  }, []);

  return hydrated;
};