import { useSyncExternalStore } from "react";

/**
 * `true` once the client has taken over, `false` during SSR and the very first
 * client render.
 *
 * Why this exists: components backed by a `persist`-ed Zustand store read
 * different values on the server (empty) and on the client (rehydrated), so
 * rendering the rehydrated value directly would be a hydration mismatch. The
 * codebase's previous answer was a `mounted` flag flipped by a mount effect —
 * which forces a second render pass on *every* page and trips
 * `react-hooks/set-state-in-effect`, because the state write happens
 * synchronously inside the effect body.
 *
 * `useSyncExternalStore` gives the same guarantee with no extra render and no
 * effect: the server snapshot is a constant `false`, and the client snapshot
 * is `true`. React re-renders the component itself when the store changes.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    // The client is hydrated from the first subscription onward — there is no
    // later transition to wait for, so there is nothing to notify and nothing
    // to unsubscribe from.
    () => () => {},
    () => true,
    () => false
  );
}